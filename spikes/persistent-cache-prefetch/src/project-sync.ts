import { Effect } from "effect";
import {
  type CacheStats,
  type EvictionResult,
  LocalCacheFailure,
  type ProjectLocalCache,
  type StorageEstimate,
} from "./indexeddb-cache";
import {
  issueKey,
  type IssueSnapshot,
  type IssueTitleChanged,
  makeIssueSnapshot,
  makeTimelinePage,
  PROJECT_ID,
  type QueryMembership,
} from "./project-data";
import {
  IssueFetchFailure,
  type NetworkRecord,
  type PrefetchHandle,
  type RequestCoordinator,
} from "./request-coordinator";

/** Failure value returned by the application-owned sync module. */
export class ProjectSyncFailure extends Error {
  readonly _tag = "ProjectSyncFailure" as const;

  /** Classify one cache or HTTP failure at the sync seam. */
  constructor(
    readonly operation: string,
    override readonly cause: LocalCacheFailure | IssueFetchFailure,
  ) {
    super(`Project sync failed during ${operation}`);
  }
}

/** Result of a route read through memory, IndexedDB, or HTTP. */
export type NavigationResult =
  | Readonly<{
    _tag: "NavigationReady";
    snapshot: IssueSnapshot;
    source: "memory" | "indexeddb" | "network";
    durationMs: number;
  }>
  | Readonly<{ _tag: "NavigationFailed"; error: ProjectSyncFailure }>;

/** Reconnect result after replaying a gap or replacing the Project snapshot. */
export type ReconnectResult =
  | Readonly<{ _tag: "AlreadyCurrent"; cursor: number }>
  | Readonly<{ _tag: "Replayed"; from: number; to: number; cursor: number }>
  | Readonly<{ _tag: "Resnapshotted"; cursor: number }>;

/** Evidence that malformed canonical data rebuilt without deleting drafts. */
export type RecoveryResult = Readonly<{
  recovered: boolean;
  restoredSnapshots: number;
  draftPreserved: boolean;
}>;

/** Deep sync interface used by Foldkit and by the browser evidence harness. */
export type ProjectSync = Readonly<{
  restore: () => Promise<RecoveryResult>;
  seedRepresentativeCache: () => Promise<void>;
  navigate: (issueNumber: number) => Promise<NavigationResult>;
  viewportEnter: (issueNumber: number) => void;
  viewportExit: (issueNumber: number) => void;
  intent: (issueNumber: number) => Promise<NavigationResult>;
  reconcileReconnect: (
    serverSequence: number,
    loadEvents: (from: number, to: number) => Promise<ReadonlyArray<IssueTitleChanged>>,
    loadSnapshot: () => Promise<IssueSnapshot>,
  ) => Promise<ReconnectResult>;
  seedEvictionCandidates: () => Promise<void>;
  evictUnderPressure: (
    maxCandidateBytes: number,
    estimate: StorageEstimate,
  ) => Promise<EvictionResult>;
  forceCorruptionRecovery: () => Promise<RecoveryResult>;
  stats: () => Promise<CacheStats>;
  readCursor: () => Promise<number>;
  getDraftMarkdown: () => Promise<string | undefined>;
  networkLog: () => ReadonlyArray<NetworkRecord>;
  clearNetworkLog: () => void;
  dispose: () => Promise<void>;
}>;

function percentile95(values: ReadonlyArray<number>): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
}

/** Calculate p95 without pulling a statistics package into the fixture. */
export const p95 = percentile95;

/** Construct the sole application-owned projection of server-backed Project state. */
export function makeProjectSync(
  cache: ProjectLocalCache,
  requests: RequestCoordinator,
): ProjectSync {
  const memory = new Map<number, IssueSnapshot>();
  const viewportTimers = new Map<number, number>();
  const viewportRequests = new Map<number, PrefetchHandle>();
  let cursor = 0;

  const runCache = <A>(effect: Effect.Effect<A, LocalCacheFailure>): Promise<A> =>
    Effect.runPromise(effect);

  const rememberNetworkRead = async (
    issueNumber: number,
    operation: string,
    request: Promise<import("./request-coordinator").IssueFetchResult>,
  ): Promise<NavigationResult> => {
    const startedAt = performance.now();
    const result = await request;
    if (result._tag === "FetchFailed") {
      return {
        _tag: "NavigationFailed",
        error: new ProjectSyncFailure(operation, result.error),
      };
    }
    try {
      await Promise.all([
        runCache(cache.putSnapshot(result.value.snapshot)),
        runCache(cache.putTimelinePage(result.value.timeline)),
      ]);
      memory.set(issueNumber, result.value.snapshot);
      return {
        _tag: "NavigationReady",
        snapshot: result.value.snapshot,
        source: "network",
        durationMs: performance.now() - startedAt,
      };
    } catch (cause) {
      return {
        _tag: "NavigationFailed",
        error: new ProjectSyncFailure(
          operation,
          cause instanceof LocalCacheFailure
            ? cause
            : new LocalCacheFailure(operation, cause),
        ),
      };
    }
  };

  const navigate = async (issueNumber: number): Promise<NavigationResult> => {
    const startedAt = performance.now();
    const inMemory = memory.get(issueNumber);
    if (inMemory !== undefined) {
      return {
        _tag: "NavigationReady",
        snapshot: inMemory,
        source: "memory",
        durationMs: performance.now() - startedAt,
      };
    }
    try {
      const persisted = await runCache(cache.getSnapshot(issueKey(issueNumber)));
      if (persisted !== undefined) {
        memory.set(issueNumber, persisted);
        return {
          _tag: "NavigationReady",
          snapshot: persisted,
          source: "indexeddb",
          durationMs: performance.now() - startedAt,
        };
      }
    } catch (cause) {
      return {
        _tag: "NavigationFailed",
        error: new ProjectSyncFailure(
          "cached navigation",
          cause instanceof LocalCacheFailure
            ? cause
            : new LocalCacheFailure("cached navigation", cause),
        ),
      };
    }
    return rememberNetworkRead(
      issueNumber,
      "active navigation",
      requests.requestActive(issueNumber),
    );
  };

  const restore = async (): Promise<RecoveryResult> => {
    let recovered = false;
    let restored;
    try {
      restored = await runCache(cache.restore());
    } catch {
      recovered = true;
      await runCache(cache.rebuildCanonical());
      restored = await runCache(cache.restore());
    }
    memory.clear();
    for (const snapshot of restored.snapshots) {
      memory.set(snapshot.issueNumber, snapshot);
    }
    cursor = restored.cursor;
    const draft = await runCache(cache.getDraft("draft:legacy"));
    return {
      recovered,
      restoredSnapshots: restored.snapshots.length,
      draftPreserved: draft?.markdown === "Preserve this draft",
    };
  };

  const applyEvent = async (event: IssueTitleChanged): Promise<boolean> => {
    if (event.sequence <= cursor) {
      return true;
    }
    if (event.sequence !== cursor + 1) {
      return false;
    }
    const current = memory.get(event.issueNumber)
      ?? await runCache(cache.getSnapshot(issueKey(event.issueNumber)));
    if (current === undefined) {
      return false;
    }
    const snapshot: IssueSnapshot = {
      ...current,
      title: event.title,
      version: event.version,
      eventSequence: event.sequence,
      cachedAt: Date.now(),
    };
    await runCache(cache.putSnapshotAndCursor(snapshot, event.sequence));
    memory.set(event.issueNumber, snapshot);
    cursor = event.sequence;
    return true;
  };

  return {
    restore,
    seedRepresentativeCache: async () => {
      const snapshots = Array.from({ length: 40 }, (_, index) => makeIssueSnapshot(201 + index));
      for (const snapshot of snapshots) {
        await runCache(cache.putSnapshot(snapshot));
        memory.set(snapshot.issueNumber, snapshot);
      }
      await runCache(cache.putSnapshotAndCursor(snapshots[0] ?? makeIssueSnapshot(201), 10));
      cursor = 10;
      await runCache(cache.putDraft({
        key: "draft:quota",
        projectId: PROJECT_ID,
        issueNumber: 8,
        markdown: "Drafts survive canonical eviction and rebuild",
        updatedAt: Date.now(),
      }));
    },
    navigate,
    viewportEnter: (issueNumber) => {
      if (memory.has(issueNumber) || viewportTimers.has(issueNumber) || viewportRequests.has(issueNumber)) {
        return;
      }
      const timer = window.setTimeout(() => {
        viewportTimers.delete(issueNumber);
        const handle = requests.prefetch(issueNumber);
        if (handle === undefined) {
          return;
        }
        viewportRequests.set(issueNumber, handle);
        void rememberNetworkRead(issueNumber, "viewport prefetch", handle.result)
          .finally(() => viewportRequests.delete(issueNumber));
      }, 300);
      viewportTimers.set(issueNumber, timer);
    },
    viewportExit: (issueNumber) => {
      const timer = viewportTimers.get(issueNumber);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        viewportTimers.delete(issueNumber);
      }
      viewportRequests.get(issueNumber)?.cancel();
      viewportRequests.delete(issueNumber);
    },
    intent: (issueNumber) => navigate(issueNumber),
    reconcileReconnect: async (serverSequence, loadEvents, loadSnapshot) => {
      if (serverSequence <= cursor) {
        return { _tag: "AlreadyCurrent", cursor };
      }
      const from = cursor + 1;
      const events = await loadEvents(from, serverSequence);
      let expected = from;
      let replaySucceeded = events.length === serverSequence - from + 1;
      if (replaySucceeded) {
        for (const event of events) {
          if (event.sequence !== expected || !(await applyEvent(event))) {
            replaySucceeded = false;
            break;
          }
          expected += 1;
        }
      }
      if (replaySucceeded && cursor === serverSequence) {
        return { _tag: "Replayed", from, to: serverSequence, cursor };
      }
      const replacement = await loadSnapshot();
      await runCache(cache.putSnapshotAndCursor(replacement, serverSequence));
      memory.set(replacement.issueNumber, replacement);
      cursor = serverSequence;
      return { _tag: "Resnapshotted", cursor };
    },
    seedEvictionCandidates: async () => {
      const now = Date.now() - 10_000;
      const queries: ReadonlyArray<QueryMembership> = Array.from({ length: 6 }, (_, index) => ({
        key: `query:${index + 1}`,
        issueNumbers: Array.from({ length: 40 }, (__, issueIndex) => issueIndex + 1),
        accessedAt: now + index,
        byteSize: 1_500,
      }));
      for (const query of queries) {
        await runCache(cache.putQuery(query));
      }
      for (let issueNumber = 301; issueNumber <= 306; issueNumber += 1) {
        await runCache(cache.putTimelinePage({
          ...makeTimelinePage(issueNumber, now + issueNumber),
          byteSize: 2_000,
        }));
      }
    },
    evictUnderPressure: (maxCandidateBytes, estimate) =>
      runCache(cache.evictUnderPressure(maxCandidateBytes, estimate)),
    forceCorruptionRecovery: async () => {
      await runCache(cache.corruptCanonicalForProbe());
      return restore();
    },
    stats: () => runCache(cache.stats()),
    readCursor: () => runCache(cache.readCursor()),
    getDraftMarkdown: async () =>
      (await runCache(cache.getDraft("draft:quota")))?.markdown,
    networkLog: requests.networkLog,
    clearNetworkLog: requests.clearNetworkLog,
    dispose: async () => {
      for (const timer of viewportTimers.values()) {
        window.clearTimeout(timer);
      }
      for (const handle of viewportRequests.values()) {
        handle.cancel();
      }
      requests.dispose();
      await runCache(cache.dispose());
    },
  };
}
