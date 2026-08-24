import { TestRunId } from "../../../src/overseer-e2e-trace-identity.ts";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import {
  type TestArtifact,
  type TestArtifactRef,
  type TestArtifactWrite,
} from "./test-artifact.ts";
import { TestArtifactId } from "./test-evidence-identity.ts";
import { TestRun, type TestRunStatus, type TestRun as TestRunValue } from "./test-run.ts";
import type { OverseerTestTarget } from "../harness/overseer-test-run.ts";

/** Operations that can fail at the test-run storage boundary. */
export const TestRunStorageOperation = Schema.Literals([
  "createTestRun",
  "findTestRun",
  "listTestRuns",
  "updateTestRun",
  "deleteTestRun",
  "createTestArtifact",
  "findTestArtifact",
  "listTestArtifacts",
  "updateTestArtifact",
  "deleteTestArtifact",
]);

/** Name of one failed test-run storage operation. */
export type TestRunStorageOperation = typeof TestRunStorageOperation.Type;

/** Expected persistence failure reported by a test-run storage backend. */
export class TestRunStorageError extends Schema.TaggedError<TestRunStorageError>()(
  "TestRunStorageError",
  {
    operation: TestRunStorageOperation,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** Filters and bounds test-run summaries returned by storage. */
export interface TestRunQuery {
  /** Included run statuses; an empty collection includes every status. */
  readonly statuses: ReadonlyArray<TestRunStatus>;
  /** Included execution targets; an empty collection includes every target. */
  readonly targets: ReadonlyArray<OverseerTestTarget>;
  /** Maximum summaries returned in newest-first order. */
  readonly limit: number;
}

/** List-oriented metadata for one persisted test run. */
export interface TestRunSummary {
  /** Stable run identity. */
  readonly id: TestRunId;
  /** Local-runtime or deployed target exercised by the run. */
  readonly target: OverseerTestTarget;
  /** Current or final run status. */
  readonly status: TestRunStatus;
  /** Time at which the run began. */
  readonly startedAt: DateTime.Utc;
  /** Number of tests registered in the run. */
  readonly testCount: number;
}

/** Backend-neutral CRUD authority for test-run snapshots and evidence artifacts. */
export interface ITestRunStorage {
  /** Create an idempotently identified test-run snapshot. */
  readonly createTestRun: (run: TestRunValue) => Effect.Effect<void, TestRunStorageError>;
  /** Find and parse one persisted test-run snapshot. */
  readonly findTestRun: (
    runId: TestRunId,
  ) => Effect.Effect<Option.Option<TestRunValue>, TestRunStorageError>;
  /** List matching test runs in newest-first order. */
  readonly listTestRuns: (
    query: TestRunQuery,
  ) => Effect.Effect<ReadonlyArray<TestRunSummary>, TestRunStorageError>;
  /** Replace one idempotently identified test-run snapshot. */
  readonly updateTestRun: (run: TestRunValue) => Effect.Effect<void, TestRunStorageError>;
  /** Delete one test run and its artifact resources. */
  readonly deleteTestRun: (runId: TestRunId) => Effect.Effect<void, TestRunStorageError>;
  /** Create an idempotently identified evidence artifact. */
  readonly createTestArtifact: (
    artifact: TestArtifactWrite,
  ) => Effect.Effect<TestArtifactRef, TestRunStorageError>;
  /** Find one artifact and copy its stored bytes. */
  readonly findTestArtifact: (
    artifactId: TestArtifactId,
  ) => Effect.Effect<Option.Option<TestArtifact>, TestRunStorageError>;
  /** List artifact references belonging to one run. */
  readonly listTestArtifacts: (
    runId: TestRunId,
  ) => Effect.Effect<ReadonlyArray<TestArtifactRef>, TestRunStorageError>;
  /** Replace one idempotently identified evidence artifact. */
  readonly updateTestArtifact: (
    artifact: TestArtifactWrite,
  ) => Effect.Effect<TestArtifactRef, TestRunStorageError>;
  /** Delete one evidence artifact and its content. */
  readonly deleteTestArtifact: (
    artifactId: TestArtifactId,
  ) => Effect.Effect<void, TestRunStorageError>;
}

/** Provides backend-neutral test-run CRUD without exposing harness lifecycle commands. */
export class TestRunStorage extends Context.Service<TestRunStorage, ITestRunStorage>()(
  "@overseer/TestRunStorage",
) {}

const cloneTestRun = (run: TestRunValue): TestRunValue =>
  Schema.decodeUnknownSync(TestRun)(Schema.encodeSync(TestRun)(run));

const cloneTestArtifact = (artifact: TestArtifactWrite): TestArtifact => ({
  ref: artifact.ref,
  body: artifact.body.slice(),
});

/** Constructs behaviorally faithful in-memory test-run CRUD for focused integration tests. */
export const makeTestRunStorage = Effect.sync(() => {
  const runs = new Map<TestRunId, TestRunValue>();
  const artifacts = new Map<TestArtifactId, TestArtifact>();

  const writeTestRun = (run: TestRunValue): void => {
    runs.set(run.id, cloneTestRun(run));
  };
  const writeTestArtifact = (artifact: TestArtifactWrite): TestArtifactRef => {
    artifacts.set(artifact.ref.id, cloneTestArtifact(artifact));
    return artifact.ref;
  };

  return TestRunStorage.of({
    createTestRun: (run) => Effect.sync(() => writeTestRun(run)),
    findTestRun: (runId) =>
      Effect.sync(() => Option.fromNullishOr(runs.get(runId)).pipe(Option.map(cloneTestRun))),
    listTestRuns: (query) =>
      Effect.sync(() =>
        [...runs.values()]
          .filter(
            (run) =>
              (query.statuses.length === 0 || query.statuses.includes(run.status)) &&
              (query.targets.length === 0 || query.targets.includes(run.target)),
          )
          .sort(
            (left, right) =>
              DateTime.toEpochMillis(right.startedAt) - DateTime.toEpochMillis(left.startedAt),
          )
          .slice(0, query.limit)
          .map((run) => ({
            id: run.id,
            target: run.target,
            status: run.status,
            startedAt: run.startedAt,
            testCount: run.tests.length,
          })),
      ),
    updateTestRun: (run) => Effect.sync(() => writeTestRun(run)),
    deleteTestRun: (runId) =>
      Effect.sync(() => {
        runs.delete(runId);
        for (const [artifactId, artifact] of artifacts) {
          if (artifact.ref.runId === runId) artifacts.delete(artifactId);
        }
      }),
    createTestArtifact: (artifact) => Effect.sync(() => writeTestArtifact(artifact)),
    findTestArtifact: (artifactId) =>
      Effect.sync(() =>
        Option.fromNullishOr(artifacts.get(artifactId)).pipe(
          Option.map((artifact) => ({ ref: artifact.ref, body: artifact.body.slice() })),
        ),
      ),
    listTestArtifacts: (runId) =>
      Effect.sync(() =>
        [...artifacts.values()]
          .filter((artifact) => artifact.ref.runId === runId)
          .map((artifact) => artifact.ref),
      ),
    updateTestArtifact: (artifact) => Effect.sync(() => writeTestArtifact(artifact)),
    deleteTestArtifact: (artifactId) =>
      Effect.sync(() => artifacts.delete(artifactId)).pipe(Effect.asVoid),
  });
});

/** Provides fresh, behaviorally faithful in-memory test-run CRUD. */
export const testRunStorageMemoryLayer = Layer.effect(TestRunStorage, makeTestRunStorage);
