import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DateTime, Effect, Layer, Option, Schema } from "effect";
import {
  TestArtifactRef,
  type TestArtifact,
  type TestArtifactRef as TestArtifactRefValue,
  type TestArtifactWrite,
} from "./test-artifact.ts";
import { TestArtifactId, type TestRunId } from "./test-evidence-identity.ts";
import { TestRun, type TestRun as TestRunValue } from "./test-run.ts";
import {
  TestRunStorage,
  TestRunStorageError,
  type TestRunQuery,
  type TestRunStorageOperation,
  type TestRunSummary,
} from "./test-run-storage.ts";

const StoredTestRunRow = Schema.Struct({ snapshot_json: Schema.String });
const parseStoredTestRunRow = Schema.decodeUnknownSync(StoredTestRunRow);
const StoredTestRunRows = Schema.Array(StoredTestRunRow);
const parseStoredTestRunRows = Schema.decodeUnknownSync(StoredTestRunRows);
const StoredArtifactRow = Schema.Struct({ ref_json: Schema.String, content_path: Schema.String });
const parseStoredArtifactRow = Schema.decodeUnknownSync(StoredArtifactRow);
const StoredArtifactRows = Schema.Array(StoredArtifactRow);
const parseStoredArtifactRows = Schema.decodeUnknownSync(StoredArtifactRows);
const parseStoredTestRun = Schema.decodeUnknownSync(Schema.fromJsonString(TestRun));
const parseStoredArtifactRef = Schema.decodeUnknownSync(Schema.fromJsonString(TestArtifactRef));
const encodeStoredTestRun = Schema.encodeSync(Schema.fromJsonString(TestRun));
const encodeStoredArtifactRef = Schema.encodeSync(Schema.fromJsonString(TestArtifactRef));

const storageFailure = (operation: TestRunStorageOperation, cause: unknown): TestRunStorageError =>
  new TestRunStorageError({
    operation,
    message: `Local test-run storage failed during ${operation}`,
    cause,
  });

const artifactContentPath = (artifactDirectory: string, artifactId: TestArtifactId): string =>
  join(artifactDirectory, `${artifactId}.bin`);

const makeLocalTestRunStorage = (rootDirectory: string) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        mkdirSync(rootDirectory, { recursive: true });
        const artifactDirectory = join(rootDirectory, "artifacts");
        mkdirSync(artifactDirectory, { recursive: true });
        const database = new DatabaseSync(join(rootDirectory, "test-runs.sqlite"));
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(`
          CREATE TABLE IF NOT EXISTS test_runs (
            id TEXT PRIMARY KEY,
            started_at_ms INTEGER NOT NULL,
            snapshot_json TEXT NOT NULL
          ) STRICT;
          CREATE TABLE IF NOT EXISTS test_artifacts (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            ref_json TEXT NOT NULL,
            content_path TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE
          ) STRICT;
        `);
        return { artifactDirectory, database };
      },
      catch: (cause) => storageFailure("createTestRun", cause),
    }),
    ({ database }) => Effect.sync(() => database.close()),
  ).pipe(
    Effect.map(({ artifactDirectory, database }) => {
      const runOperation = <A>(
        operation: TestRunStorageOperation,
        execute: () => A,
      ): Effect.Effect<A, TestRunStorageError> =>
        Effect.try({ try: execute, catch: (cause) => storageFailure(operation, cause) });

      const writeTestRun = (run: TestRunValue): void => {
        database
          .prepare(
            `INSERT INTO test_runs (id, started_at_ms, snapshot_json)
             VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               started_at_ms = excluded.started_at_ms,
               snapshot_json = excluded.snapshot_json`,
          )
          .run(run.id, DateTime.toEpochMillis(run.startedAt), encodeStoredTestRun(run));
      };

      const writeTestArtifact = (artifact: TestArtifactWrite): TestArtifactRefValue => {
        const contentPath = artifactContentPath(artifactDirectory, artifact.ref.id);
        writeFileSync(contentPath, artifact.body);
        database
          .prepare(
            `INSERT INTO test_artifacts (id, run_id, ref_json, content_path)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               run_id = excluded.run_id,
               ref_json = excluded.ref_json,
               content_path = excluded.content_path`,
          )
          .run(
            artifact.ref.id,
            artifact.ref.runId,
            encodeStoredArtifactRef(artifact.ref),
            contentPath,
          );
        return artifact.ref;
      };

      return TestRunStorage.of({
        createTestRun: (run) => runOperation("createTestRun", () => writeTestRun(run)),
        findTestRun: (runId) =>
          runOperation("findTestRun", () => {
            const row = database
              .prepare("SELECT snapshot_json FROM test_runs WHERE id = ?")
              .get(runId);
            return row === undefined
              ? Option.none<TestRunValue>()
              : Option.some(parseStoredTestRun(parseStoredTestRunRow(row).snapshot_json));
          }),
        listTestRuns: (query: TestRunQuery) =>
          runOperation(
            "listTestRuns",
            (): ReadonlyArray<TestRunSummary> =>
              parseStoredTestRunRows(
                database
                  .prepare("SELECT snapshot_json FROM test_runs ORDER BY started_at_ms DESC")
                  .all(),
              )
                .map((row) => parseStoredTestRun(row.snapshot_json))
                .filter(
                  (run) =>
                    (query.statuses.length === 0 || query.statuses.includes(run.status)) &&
                    (query.targets.length === 0 || query.targets.includes(run.target)),
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
        updateTestRun: (run) => runOperation("updateTestRun", () => writeTestRun(run)),
        deleteTestRun: (runId: TestRunId) =>
          runOperation("deleteTestRun", () => {
            const artifactRows = parseStoredArtifactRows(
              database
                .prepare("SELECT ref_json, content_path FROM test_artifacts WHERE run_id = ?")
                .all(runId),
            );
            database.prepare("DELETE FROM test_runs WHERE id = ?").run(runId);
            for (const row of artifactRows) rmSync(row.content_path, { force: true });
          }),
        createTestArtifact: (artifact) =>
          runOperation("createTestArtifact", () => writeTestArtifact(artifact)),
        findTestArtifact: (artifactId) =>
          runOperation("findTestArtifact", (): Option.Option<TestArtifact> => {
            const row = database
              .prepare("SELECT ref_json, content_path FROM test_artifacts WHERE id = ?")
              .get(artifactId);
            if (row === undefined) return Option.none();
            const stored = parseStoredArtifactRow(row);
            return Option.some({
              ref: parseStoredArtifactRef(stored.ref_json),
              body: readFileSync(stored.content_path),
            });
          }),
        listTestArtifacts: (runId) =>
          runOperation("listTestArtifacts", () =>
            parseStoredArtifactRows(
              database
                .prepare(
                  "SELECT ref_json, content_path FROM test_artifacts WHERE run_id = ? ORDER BY id",
                )
                .all(runId),
            ).map((row) => parseStoredArtifactRef(row.ref_json)),
          ),
        updateTestArtifact: (artifact) =>
          runOperation("updateTestArtifact", () => writeTestArtifact(artifact)),
        deleteTestArtifact: (artifactId) =>
          runOperation("deleteTestArtifact", () => {
            const row = database
              .prepare("SELECT ref_json, content_path FROM test_artifacts WHERE id = ?")
              .get(artifactId);
            database.prepare("DELETE FROM test_artifacts WHERE id = ?").run(artifactId);
            if (row !== undefined) unlinkSync(parseStoredArtifactRow(row).content_path);
          }),
      });
    }),
  );

/** Provides local SQLite metadata and local artifact files rooted at the supplied directory. */
export const testRunStorageLocalLayerAt = (
  rootDirectory: string,
): Layer.Layer<TestRunStorage, TestRunStorageError> =>
  Layer.effect(TestRunStorage, makeLocalTestRunStorage(rootDirectory));

/**
 * Provides local test evidence for both local and deployed runs from the Node/Vitest runner.
 * The backend-neutral contract may later be implemented by an authenticated evidence-service
 * client; the production Overseer API must never expose test-only evidence endpoints.
 */
export const localTestRunStorageLayer = testRunStorageLocalLayerAt(
  join(process.cwd(), ".overseer", "evidence"),
);
