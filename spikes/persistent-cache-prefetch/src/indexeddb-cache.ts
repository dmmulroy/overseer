import {
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbTable,
  IndexedDbVersion,
} from "@effect/platform-browser";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import {
  Draft,
  type Draft as DraftValue,
  IssueSnapshot,
  type IssueSnapshot as IssueSnapshotValue,
  LegacyDraft,
  PROJECT_ID,
  ProjectCursor,
  QueryMembership,
  type QueryMembership as QueryMembershipValue,
  TimelinePage,
  type TimelinePage as TimelinePageValue,
} from "./project-data";

const CANONICAL_DATABASE = "overseer-spike-canonical";
const DRAFT_DATABASE = "overseer-spike-drafts";

const LegacySnapshotTable = IndexedDbTable.make({
  name: "snapshots",
  schema: Schema.Struct({
    key: Schema.String,
    payload: Schema.String,
  }),
  keyPath: "key",
});
const SnapshotTable = IndexedDbTable.make({
  name: "snapshots",
  schema: IssueSnapshot,
  keyPath: "key",
});
const TimelineTable = IndexedDbTable.make({
  name: "timelinePages",
  schema: TimelinePage,
  keyPath: "key",
});
const QueryTable = IndexedDbTable.make({
  name: "queries",
  schema: QueryMembership,
  keyPath: "key",
});
const CursorTable = IndexedDbTable.make({
  name: "cursors",
  schema: ProjectCursor,
  keyPath: "projectId",
});

const CanonicalV1 = IndexedDbVersion.make(LegacySnapshotTable);
const CanonicalV2 = IndexedDbVersion.make(
  SnapshotTable,
  TimelineTable,
  QueryTable,
  CursorTable,
);
const CanonicalV1Schema = IndexedDbDatabase.make(
  CanonicalV1,
  (query) => Effect.asVoid(query.createObjectStore("snapshots")),
);
const CanonicalSchema = CanonicalV1Schema.add(
  CanonicalV2,
  (fromQuery, toQuery) => Effect.gen(function* () {
    yield* fromQuery.deleteObjectStore("snapshots");
    yield* toQuery.createObjectStore("snapshots");
    yield* toQuery.createObjectStore("timelinePages");
    yield* toQuery.createObjectStore("queries");
    yield* toQuery.createObjectStore("cursors");
  }),
);

const LegacyDraftTable = IndexedDbTable.make({
  name: "drafts",
  schema: LegacyDraft,
  keyPath: "key",
});
const DraftTable = IndexedDbTable.make({
  name: "drafts",
  schema: Draft,
  keyPath: "key",
});
const DraftV1 = IndexedDbVersion.make(LegacyDraftTable);
const DraftV2 = IndexedDbVersion.make(DraftTable);
const DraftV1Schema = IndexedDbDatabase.make(
  DraftV1,
  (query) => Effect.asVoid(query.createObjectStore("drafts")),
);
const DraftSchema = DraftV1Schema.add(
  DraftV2,
  (fromQuery, toQuery) => Effect.gen(function* () {
    const legacyDrafts = yield* fromQuery.from("drafts").select();
    yield* toQuery.from("drafts").clear;
    yield* toQuery.from("drafts").upsertAll(
      legacyDrafts.map((draft) => ({ ...draft, updatedAt: 1 })),
    );
  }),
);

/** Typed local-cache failure at the IndexedDB adapter seam. */
export class LocalCacheFailure extends Error {
  readonly _tag = "LocalCacheFailure" as const;

  /** Create a classified cache failure without leaking browser records. */
  constructor(
    readonly operation: string,
    override readonly cause: unknown,
  ) {
    super(`Local cache failed during ${operation}`);
  }
}

/** Canonical data restored before the Foldkit client renders cached routes. */
export type RestoredCache = Readonly<{
  snapshots: ReadonlyArray<IssueSnapshotValue>;
  cursor: number;
}>;

/** Storage estimate used by quota-aware eviction policy. */
export type StorageEstimate = Readonly<{
  usage: number;
  quota: number;
}>;

/** Observable result of one quota-aware eviction pass. */
export type EvictionResult = Readonly<{
  evictedQueries: number;
  evictedTimelinePages: number;
  remainingCandidateBytes: number;
}>;

/** Counts exposed solely as pass/fail evidence for the throwaway fixture. */
export type CacheStats = Readonly<{
  snapshots: number;
  timelinePages: number;
  queries: number;
  drafts: number;
}>;

/** Application-owned persistent-cache capability used by the sync submodel. */
export type ProjectLocalCache = Readonly<{
  restore: () => Effect.Effect<RestoredCache, LocalCacheFailure>;
  putSnapshot: (snapshot: IssueSnapshotValue) => Effect.Effect<void, LocalCacheFailure>;
  putSnapshotAndCursor: (
    snapshot: IssueSnapshotValue,
    sequence: number,
  ) => Effect.Effect<void, LocalCacheFailure>;
  getSnapshot: (key: string) => Effect.Effect<IssueSnapshotValue | undefined, LocalCacheFailure>;
  putTimelinePage: (page: TimelinePageValue) => Effect.Effect<void, LocalCacheFailure>;
  putQuery: (query: QueryMembershipValue) => Effect.Effect<void, LocalCacheFailure>;
  putDraft: (draft: DraftValue) => Effect.Effect<void, LocalCacheFailure>;
  getDraft: (key: string) => Effect.Effect<DraftValue | undefined, LocalCacheFailure>;
  readCursor: () => Effect.Effect<number, LocalCacheFailure>;
  rebuildCanonical: () => Effect.Effect<void, LocalCacheFailure>;
  corruptCanonicalForProbe: () => Effect.Effect<void, LocalCacheFailure>;
  evictUnderPressure: (
    maxCandidateBytes: number,
    estimate: StorageEstimate,
  ) => Effect.Effect<EvictionResult, LocalCacheFailure>;
  stats: () => Effect.Effect<CacheStats, LocalCacheFailure>;
  dispose: () => Effect.Effect<void>;
}>;

function classify<A>(operation: string, run: () => Promise<A>): Effect.Effect<A, LocalCacheFailure> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new LocalCacheFailure(operation, cause),
  });
}

function first<A>(values: ReadonlyArray<A>): A | undefined {
  return values[0];
}

/** Construct the IndexedDB adapters and retain their database resources. */
export function makeProjectLocalCache(): ProjectLocalCache {
  const canonicalRuntime = ManagedRuntime.make(
    CanonicalSchema.layer(CANONICAL_DATABASE).pipe(
      Layer.provide(IndexedDb.layerWindow),
    ),
  );
  const draftRuntime = ManagedRuntime.make(
    DraftSchema.layer(DRAFT_DATABASE).pipe(
      Layer.provide(IndexedDb.layerWindow),
    ),
  );

  const runCanonical = <A, E>(operation: string, effect: Effect.Effect<A, E, IndexedDbDatabase.IndexedDbDatabase>) =>
    classify(operation, () => canonicalRuntime.runPromise(effect));
  const runDraft = <A, E>(operation: string, effect: Effect.Effect<A, E, IndexedDbDatabase.IndexedDbDatabase>) =>
    classify(operation, () => draftRuntime.runPromise(effect));

  return {
    restore: () => runCanonical("restore", Effect.gen(function* () {
      const query = yield* CanonicalSchema;
      const snapshots = yield* query.from("snapshots").select();
      const cursors = yield* query.from("cursors").select().equals(PROJECT_ID);
      return { snapshots, cursor: first(cursors)?.sequence ?? 0 };
    })),
    putSnapshot: (snapshot) => runCanonical(
      "put snapshot",
      Effect.gen(function* () {
        const query = yield* CanonicalSchema;
        yield* query.from("snapshots").upsert(snapshot);
      }),
    ),
    putSnapshotAndCursor: (snapshot, sequence) => runCanonical(
      "commit snapshot and cursor",
      Effect.gen(function* () {
        const query = yield* CanonicalSchema;
        yield* query.withTransaction({
          tables: ["snapshots", "cursors"],
          mode: "readwrite",
          durability: "strict",
        })(Effect.gen(function* () {
          yield* query.from("snapshots").upsert(snapshot);
          yield* query.from("cursors").upsert({ projectId: PROJECT_ID, sequence });
        }));
      }),
    ),
    getSnapshot: (key) => runCanonical("get snapshot", Effect.gen(function* () {
      const query = yield* CanonicalSchema;
      return first(yield* query.from("snapshots").select().equals(key));
    })),
    putTimelinePage: (page) => runCanonical("put timeline page", Effect.gen(function* () {
      const query = yield* CanonicalSchema;
      yield* query.from("timelinePages").upsert(page);
    })),
    putQuery: (queryMembership) => runCanonical("put query", Effect.gen(function* () {
      const query = yield* CanonicalSchema;
      yield* query.from("queries").upsert(queryMembership);
    })),
    putDraft: (draft) => runDraft("put draft", Effect.gen(function* () {
      const query = yield* DraftSchema;
      yield* query.from("drafts").upsert(draft);
    })),
    getDraft: (key) => runDraft("get draft", Effect.gen(function* () {
      const query = yield* DraftSchema;
      return first(yield* query.from("drafts").select().equals(key));
    })),
    readCursor: () => runCanonical("read cursor", Effect.gen(function* () {
      const query = yield* CanonicalSchema;
      const cursors = yield* query.from("cursors").select().equals(PROJECT_ID);
      return first(cursors)?.sequence ?? 0;
    })),
    rebuildCanonical: () => runCanonical("rebuild canonical cache", Effect.gen(function* () {
      const database = yield* IndexedDbDatabase.IndexedDbDatabase;
      yield* database.rebuild;
    })),
    corruptCanonicalForProbe: () => runCanonical("corrupt canonical cache probe", Effect.gen(function* () {
      const query = yield* CanonicalSchema;
      const database = yield* query.use((openDatabase) => openDatabase);
      yield* Effect.callback<void, unknown>((resume) => {
        const transaction = database.transaction("snapshots", "readwrite");
        const request = transaction.objectStore("snapshots").put({ key: "malformed" });
        request.onerror = () => resume(Effect.fail(request.error));
        transaction.oncomplete = () => resume(Effect.void);
        transaction.onerror = () => resume(Effect.fail(transaction.error));
      });
    })),
    evictUnderPressure: (maxCandidateBytes, estimate) => runCanonical(
      "quota-aware eviction",
      Effect.gen(function* () {
        const query = yield* CanonicalSchema;
        const queries = yield* query.from("queries").select();
        const timelinePages = yield* query.from("timelinePages").select();
        const candidates = [
          ...queries.map((value) => ({ _tag: "query" as const, value })),
          ...timelinePages.map((value) => ({ _tag: "timeline" as const, value })),
        ].sort((left, right) => left.value.accessedAt - right.value.accessedAt);
        let remainingCandidateBytes = candidates.reduce(
          (total, candidate) => total + candidate.value.byteSize,
          0,
        );
        const quotaPressure = estimate.quota > 0 && estimate.usage / estimate.quota >= 0.8;
        const targetBytes = quotaPressure
          ? Math.min(maxCandidateBytes, Math.max(0, estimate.quota - estimate.usage))
          : maxCandidateBytes;
        let evictedQueries = 0;
        let evictedTimelinePages = 0;
        for (const candidate of candidates) {
          if (remainingCandidateBytes <= targetBytes) {
            break;
          }
          if (candidate._tag === "query") {
            yield* query.from("queries").delete().equals(candidate.value.key);
            evictedQueries += 1;
          } else {
            yield* query.from("timelinePages").delete().equals(candidate.value.key);
            evictedTimelinePages += 1;
          }
          remainingCandidateBytes -= candidate.value.byteSize;
        }
        return { evictedQueries, evictedTimelinePages, remainingCandidateBytes };
      }),
    ),
    stats: () => classify("cache stats", async () => {
      const [canonical, drafts] = await Promise.all([
        canonicalRuntime.runPromise(Effect.gen(function* () {
          const query = yield* CanonicalSchema;
          return {
            snapshots: yield* query.from("snapshots").count(),
            timelinePages: yield* query.from("timelinePages").count(),
            queries: yield* query.from("queries").count(),
          };
        })),
        draftRuntime.runPromise(Effect.gen(function* () {
          const query = yield* DraftSchema;
          return yield* query.from("drafts").count();
        })),
      ]);
      return { ...canonical, drafts };
    }),
    dispose: () => Effect.promise(() => Promise.all([
      canonicalRuntime.dispose(),
      draftRuntime.dispose(),
    ]).then(() => undefined)),
  };
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Deletion of ${name} was blocked`));
  });
}

/** Reset both fixture databases before a reproducible browser evidence run. */
export function resetSpikeDatabases(): Effect.Effect<void, LocalCacheFailure> {
  return classify("reset databases", async () => {
    await deleteDatabase(CANONICAL_DATABASE);
    await deleteDatabase(DRAFT_DATABASE);
  });
}

/** Seed v1 records so opening the application proves rebuild-versus-migrate policy. */
export function seedLegacyDatabases(): Effect.Effect<void, LocalCacheFailure> {
  return classify("seed legacy databases", async () => {
    const canonicalRuntime = ManagedRuntime.make(
      CanonicalV1Schema.layer(CANONICAL_DATABASE).pipe(Layer.provide(IndexedDb.layerWindow)),
    );
    const draftRuntime = ManagedRuntime.make(
      DraftV1Schema.layer(DRAFT_DATABASE).pipe(Layer.provide(IndexedDb.layerWindow)),
    );
    try {
      await canonicalRuntime.runPromise(Effect.gen(function* () {
        const query = yield* CanonicalV1Schema;
        yield* query.from("snapshots").upsert({ key: "legacy", payload: "discard me" });
      }));
      await draftRuntime.runPromise(Effect.gen(function* () {
        const query = yield* DraftV1Schema;
        yield* query.from("drafts").upsert({
          key: "draft:legacy",
          projectId: PROJECT_ID,
          issueNumber: 7,
          markdown: "Preserve this draft",
        });
      }));
    } finally {
      await Promise.all([canonicalRuntime.dispose(), draftRuntime.dispose()]);
    }
  });
}
