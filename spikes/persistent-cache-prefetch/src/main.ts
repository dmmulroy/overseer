import { Effect } from "effect";
import { embedFoldkitClient } from "./foldkit-app";
import {
  makeProjectLocalCache,
  resetSpikeDatabases,
  seedLegacyDatabases,
} from "./indexeddb-cache";
import {
  issueKey,
  makeIssueSnapshot,
  PROJECT_ID,
  type IssueTitleChanged,
} from "./project-data";
import { makeProjectSync, p95 } from "./project-sync";
import {
  makeRequestCoordinator,
  type NetworkCondition,
} from "./request-coordinator";
import { attachViewportPrefetch } from "./viewport-prefetch";
import { observeLabWebVitals } from "./web-vitals";
import "./style.css";

type MutableControls = {
  condition: NetworkCondition;
  latencyMs: number;
};

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for spike evidence");
    }
    await delay(10);
  }
}

function selectedIssueNumber(renderedPage: ParentNode): number | undefined {
  const selected = renderedPage.querySelector<HTMLElement>("[data-selected-issue]")?.dataset.selectedIssue;
  if (selected === undefined || selected === "none") {
    return undefined;
  }
  return Number(selected);
}

async function bootstrap(): Promise<void> {
  const vitals = observeLabWebVitals();
  await Effect.runPromise(resetSpikeDatabases());
  await Effect.runPromise(seedLegacyDatabases());

  const cache = makeProjectLocalCache();
  const controls: MutableControls = {
    condition: { saveData: false, effectiveType: "4g" },
    latencyMs: 40,
  };
  const coordinator = makeRequestCoordinator({
    networkCondition: () => controls.condition,
    latencyMs: () => controls.latencyMs,
  });
  const sync = makeProjectSync(cache, coordinator);
  const migrationRestore = await sync.restore();
  const migratedDraft = await sync.getDraftMarkdown();
  await sync.seedRepresentativeCache();
  const persistedRestore = await sync.restore();

  const container = document.querySelector<HTMLElement>("#app");
  if (container === null) {
    throw new Error("Missing #app container");
  }
  const foldkit = embedFoldkitClient(container, sync);
  await waitFor(() => document.querySelector(".issue-list") !== null);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const renderedPage = document.body;
  const viewport = attachViewportPrefetch(renderedPage, sync);

  const measureCachedRoutePaint = async (issueNumbers: ReadonlyArray<number>) => {
    const durations: Array<number> = [];
    sync.clearNetworkLog();
    for (const issueNumber of issueNumbers) {
      const row = renderedPage.querySelector<HTMLButtonElement>(`[data-issue-number="${issueNumber}"]`);
      if (row === null) {
        throw new Error(`Missing Issue row ${issueNumber}`);
      }
      const startedAt = performance.now();
      row.click();
      await waitFor(() => selectedIssueNumber(renderedPage) === issueNumber);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      durations.push(performance.now() - startedAt);
    }
    const measuredIssues = new Set(issueNumbers);
    return {
      samples: durations,
      p95Ms: p95(durations),
      networkStarts: sync.networkLog().filter((record) =>
        record.event === "started" && measuredIssues.has(record.issueNumber)).length,
    };
  };

  const activeLatency = async (
    activeIssue: number,
    backgroundIssues: ReadonlyArray<number>,
  ) => {
    sync.clearNetworkLog();
    for (const issueNumber of backgroundIssues) {
      sync.viewportEnter(issueNumber);
    }
    if (backgroundIssues.length > 0) {
      await delay(330);
    }
    const startedAt = performance.now();
    const result = await sync.navigate(activeIssue);
    const durationMs = performance.now() - startedAt;
    for (const issueNumber of backgroundIssues) {
      sync.viewportExit(issueNumber);
    }
    return { result, durationMs, log: sync.networkLog() };
  };

  const harness = {
    migrationEvidence: {
      canonicalV1Discarded: migrationRestore.restoredSnapshots === 0,
      draftV1Migrated: migrationRestore.draftPreserved,
      migratedDraft,
      persistedSnapshotsRestored: persistedRestore.restoredSnapshots,
    },
    setNetwork(condition: NetworkCondition, latencyMs: number) {
      controls.condition = condition;
      controls.latencyMs = latencyMs;
    },
    networkLog: sync.networkLog,
    clearNetworkLog: sync.clearNetworkLog,
    waitForCompleted: async (issueNumber: number) => {
      await waitFor(() => sync.networkLog().some((record) =>
        record.issueNumber === issueNumber && record.event === "completed"));
    },
    clickIssue: async (issueNumber: number) => {
      const row = renderedPage.querySelector<HTMLButtonElement>(`[data-issue-number="${issueNumber}"]`);
      if (row === null) {
        throw new Error(`Missing Issue row ${issueNumber}`);
      }
      const startedAt = performance.now();
      row.click();
      await waitFor(() => selectedIssueNumber(renderedPage) === issueNumber);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - startedAt;
    },
    selectedIssue: () => selectedIssueNumber(renderedPage),
    measureCachedRoutePaint,
    activeLatency,
    cancellationProbe: async (issueNumber: number) => {
      sync.clearNetworkLog();
      sync.viewportEnter(issueNumber);
      await delay(330);
      sync.viewportExit(issueNumber);
      await waitFor(() => sync.networkLog().some((record) =>
        record.issueNumber === issueNumber && record.event === "aborted"));
      return sync.networkLog();
    },
    deduplicationProbe: async (issueNumber: number) => {
      sync.clearNetworkLog();
      await Promise.all([
        sync.intent(issueNumber),
        sync.intent(issueNumber),
        sync.navigate(issueNumber),
      ]);
      return sync.networkLog();
    },
    constrainedProbe: async (
      condition: NetworkCondition,
      issueNumbers: ReadonlyArray<number>,
    ) => {
      controls.condition = condition;
      sync.clearNetworkLog();
      for (const issueNumber of issueNumbers) {
        sync.viewportEnter(issueNumber);
      }
      await delay(380);
      const log = sync.networkLog();
      for (const issueNumber of issueNumbers) {
        sync.viewportExit(issueNumber);
      }
      return log;
    },
    reconnectGapProbe: async () => {
      const loadSnapshotCalls = { count: 0 };
      const result = await sync.reconcileReconnect(
        13,
        async (from, to) => Array.from({ length: to - from + 1 }, (_, index): IssueTitleChanged => {
          const sequence = from + index;
          return {
            _tag: "IssueTitleChanged",
            projectId: PROJECT_ID,
            issueNumber: 201,
            sequence,
            title: `Replayed title at ${sequence}`,
            version: sequence,
          };
        }),
        async () => {
          loadSnapshotCalls.count += 1;
          return {
            ...makeIssueSnapshot(201),
            title: "Replacement snapshot",
            eventSequence: 13,
            version: 13,
          };
        },
      );
      const persistedCursor = await sync.readCursor();
      const restored = await sync.restore();
      return { result, persistedCursor, restored, loadSnapshotCalls: loadSnapshotCalls.count };
    },
    quotaProbe: async () => {
      await sync.seedEvictionCandidates();
      const before = await sync.stats();
      const eviction = await sync.evictUnderPressure(2_500, { usage: 900_000, quota: 1_000_000 });
      const after = await sync.stats();
      const draft = await sync.getDraftMarkdown();
      return { before, eviction, after, draftPreserved: draft?.includes("survive") === true };
    },
    corruptionRecoveryProbe: async () => {
      const result = await sync.forceCorruptionRecovery();
      const draft = await sync.getDraftMarkdown();
      return { result, draftPreserved: draft?.includes("survive") === true };
    },
    webVitals: vitals.read,
    cachedIssueKey: issueKey(201),
    dispose: async () => {
      viewport.dispose();
      foldkit.dispose();
      vitals.dispose();
      await sync.dispose();
    },
  };

  Object.defineProperty(window, "__overseerSpike", {
    value: harness,
    configurable: true,
  });
  document.documentElement.dataset.spikeReady = "true";
}

void bootstrap().catch((cause: unknown) => {
  document.body.textContent = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
  document.documentElement.dataset.spikeFailed = "true";
});
