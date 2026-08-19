import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Config, DateTime, Effect, Layer, Option, Schema } from "effect";
import {
  TestArtifactRef,
  type TestArtifact,
  type TestArtifactRef as TestArtifactRefValue,
  type TestArtifactWrite,
} from "./test-artifact.ts";
import { OverseerTestTarget } from "../overseer-test-run.ts";
import { TestRunId, type TestRunId as TestRunIdValue } from "./test-evidence-identity.ts";
import { TestRun, TestRunStatus, type TestRun as TestRunValue } from "./test-run.ts";
import {
  TestRunStorage,
  TestRunStorageError,
  type TestRunQuery,
  type TestRunStorageOperation,
  type TestRunSummary,
} from "./test-run-storage.ts";

/** Absolute directory containing local SQLite test metadata and artifact files. */
export const LocalTestRunStorageDirectory = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((directory) =>
    isAbsolute(directory) ? undefined : "must be an absolute path",
  ),
).pipe(Schema.brand("LocalTestRunStorageDirectory"));

/** Parsed absolute directory containing local test evidence. */
export type LocalTestRunStorageDirectory = typeof LocalTestRunStorageDirectory.Type;

/** Reads the required local evidence directory selected by the E2E runner. */
export const localTestRunStorageDirectoryConfig: Config.Config<LocalTestRunStorageDirectory> =
  Config.schema(LocalTestRunStorageDirectory, "OVERSEER_EVIDENCE_DIRECTORY");

const StoredTestRunRow = Schema.Struct({ snapshot_json: Schema.String });
const parseStoredTestRunRow = Schema.decodeUnknownSync(StoredTestRunRow);
const StoredArtifactRow = Schema.Struct({
  ref_json: Schema.String,
  content_path: Schema.String,
});
const parseStoredArtifactRow = Schema.decodeUnknownSync(StoredArtifactRow);
const StoredArtifactRows = Schema.Array(StoredArtifactRow);
const parseStoredArtifactRows = Schema.decodeUnknownSync(StoredArtifactRows);
const StoredTestRunSummaryRows = Schema.Array(
  Schema.Struct({
    id: TestRunId,
    target: OverseerTestTarget,
    status: TestRunStatus,
    started_at_ms: Schema.Number,
    test_count: Schema.Number,
  }),
);
const parseStoredTestRunSummaryRows = Schema.decodeUnknownSync(StoredTestRunSummaryRows);
const SqliteTableColumns = Schema.Array(Schema.Struct({ name: Schema.String }));
const parseSqliteTableColumns = Schema.decodeUnknownSync(SqliteTableColumns);
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

const sqliteTransaction = <A>(database: DatabaseSync, execute: () => A): A => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = execute();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const ensureColumn = (
  database: DatabaseSync,
  table: "test_runs" | "test_artifacts",
  name: string,
  declaration: string,
): void => {
  const columns = new Set(
    parseSqliteTableColumns(database.prepare(`PRAGMA table_info(${table})`).all()).map(
      (column) => column.name,
    ),
  );
  if (!columns.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${declaration}`);
};

const artifactContentHash = (body: Uint8Array): string =>
  createHash("sha256").update(body).digest("hex");

const persistArtifactBlob = (
  stagingDirectory: string,
  blobDirectory: string,
  body: Uint8Array,
): { readonly contentHash: string; readonly contentPath: string } => {
  const contentHash = artifactContentHash(body);
  const contentPath = join(blobDirectory, contentHash);
  if (existsSync(contentPath)) return { contentHash, contentPath };

  const stagingPath = join(stagingDirectory, `${contentHash}-${randomUUID()}.tmp`);
  writeFileSync(stagingPath, body);
  const descriptor = openSync(stagingPath, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  if (existsSync(contentPath)) {
    rmSync(stagingPath, { force: true });
  } else {
    renameSync(stagingPath, contentPath);
  }
  return { contentHash, contentPath };
};

const removeUnreferencedBlob = (database: DatabaseSync, contentPath: string): void => {
  const reference = database
    .prepare("SELECT 1 FROM test_artifacts WHERE content_path = ? LIMIT 1")
    .get(contentPath);
  if (reference === undefined) rmSync(contentPath, { force: true });
};

const cleanupArtifactFiles = (
  database: DatabaseSync,
  stagingDirectory: string,
  blobDirectory: string,
): void => {
  for (const name of readdirSync(stagingDirectory)) {
    rmSync(join(stagingDirectory, name), { recursive: true, force: true });
  }
  const referenced = new Set(
    parseStoredArtifactRows(
      database.prepare("SELECT ref_json, content_path FROM test_artifacts").all(),
    ).map((row) => row.content_path),
  );
  for (const name of readdirSync(blobDirectory)) {
    const contentPath = join(blobDirectory, name);
    if (!referenced.has(contentPath)) rmSync(contentPath, { force: true });
  }
};

const migrateLocalTestRunStorage = (
  database: DatabaseSync,
  stagingDirectory: string,
  blobDirectory: string,
): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      finished_at_ms INTEGER,
      duration_ms INTEGER,
      test_count INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS test_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      test_execution_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL,
      ref_json TEXT NOT NULL,
      content_path TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE
    ) STRICT;
  `);

  ensureColumn(database, "test_runs", "target", "target TEXT");
  ensureColumn(database, "test_runs", "stage", "stage TEXT");
  ensureColumn(database, "test_runs", "status", "status TEXT");
  ensureColumn(database, "test_runs", "finished_at_ms", "finished_at_ms INTEGER");
  ensureColumn(database, "test_runs", "duration_ms", "duration_ms INTEGER");
  ensureColumn(database, "test_runs", "test_count", "test_count INTEGER");
  ensureColumn(database, "test_artifacts", "test_execution_id", "test_execution_id TEXT");
  ensureColumn(database, "test_artifacts", "name", "name TEXT");
  ensureColumn(database, "test_artifacts", "kind", "kind TEXT");
  ensureColumn(database, "test_artifacts", "content_type", "content_type TEXT");
  ensureColumn(database, "test_artifacts", "byte_length", "byte_length INTEGER");
  ensureColumn(database, "test_artifacts", "created_at_ms", "created_at_ms INTEGER");
  ensureColumn(database, "test_artifacts", "content_sha256", "content_sha256 TEXT");

  const legacyRuns = database.prepare("SELECT snapshot_json FROM test_runs").all();
  for (const row of legacyRuns) {
    const run = parseStoredTestRun(parseStoredTestRunRow(row).snapshot_json);
    const finishedAtMs =
      run.timing._tag === "Finished" ? DateTime.toEpochMillis(run.timing.finishedAt) : null;
    const durationMs = run.timing._tag === "Finished" ? run.timing.durationMs : null;
    database
      .prepare(
        `UPDATE test_runs SET
          target = ?, stage = ?, status = ?, finished_at_ms = ?, duration_ms = ?, test_count = ?
         WHERE id = ?`,
      )
      .run(run.target, run.stage, run.status, finishedAtMs, durationMs, run.tests.length, run.id);
  }

  const legacyArtifacts = parseStoredArtifactRows(
    database.prepare("SELECT ref_json, content_path FROM test_artifacts").all(),
  );
  for (const row of legacyArtifacts) {
    const ref = parseStoredArtifactRef(row.ref_json);
    const body = readFileSync(row.content_path);
    const blob = persistArtifactBlob(stagingDirectory, blobDirectory, body);
    database
      .prepare(
        `UPDATE test_artifacts SET
          test_execution_id = ?, name = ?, kind = ?, content_type = ?, byte_length = ?,
          created_at_ms = ?, content_sha256 = ?, content_path = ?
         WHERE id = ?`,
      )
      .run(
        ref.testExecutionId,
        ref.name,
        ref.kind,
        ref.contentType,
        ref.byteLength,
        DateTime.toEpochMillis(ref.createdAt),
        blob.contentHash,
        blob.contentPath,
        ref.id,
      );
    if (row.content_path !== blob.contentPath) rmSync(row.content_path, { force: true });
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS test_runs_status_started_at
      ON test_runs(status, started_at_ms DESC);
    CREATE INDEX IF NOT EXISTS test_runs_target_started_at
      ON test_runs(target, started_at_ms DESC);
    CREATE INDEX IF NOT EXISTS test_artifacts_run_created_at
      ON test_artifacts(run_id, created_at_ms, id);
    PRAGMA user_version = 2;
  `);
};

const makeLocalTestRunStorage = (rootDirectory: LocalTestRunStorageDirectory) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        mkdirSync(rootDirectory, { recursive: true });
        const stagingDirectory = join(rootDirectory, "staging");
        const blobDirectory = join(rootDirectory, "blobs");
        mkdirSync(stagingDirectory, { recursive: true });
        mkdirSync(blobDirectory, { recursive: true });
        const database = new DatabaseSync(join(rootDirectory, "test-runs.sqlite"));
        try {
          database.exec("PRAGMA foreign_keys = ON");
          migrateLocalTestRunStorage(database, stagingDirectory, blobDirectory);
          cleanupArtifactFiles(database, stagingDirectory, blobDirectory);
          return { blobDirectory, database, stagingDirectory };
        } catch (error) {
          database.close();
          throw error;
        }
      },
      catch: (cause) => storageFailure("createTestRun", cause),
    }),
    ({ database }) => Effect.sync(() => database.close()),
  ).pipe(
    Effect.map(({ blobDirectory, database, stagingDirectory }) => {
      const runOperation = <A>(
        operation: TestRunStorageOperation,
        execute: () => A,
      ): Effect.Effect<A, TestRunStorageError> =>
        Effect.try({ try: execute, catch: (cause) => storageFailure(operation, cause) });

      const writeTestRun = (run: TestRunValue): void => {
        const finishedAtMs =
          run.timing._tag === "Finished" ? DateTime.toEpochMillis(run.timing.finishedAt) : null;
        const durationMs = run.timing._tag === "Finished" ? run.timing.durationMs : null;
        sqliteTransaction(database, () => {
          database
            .prepare(
              `INSERT INTO test_runs (
                id, target, stage, status, started_at_ms, finished_at_ms,
                duration_ms, test_count, snapshot_json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                target = excluded.target,
                stage = excluded.stage,
                status = excluded.status,
                started_at_ms = excluded.started_at_ms,
                finished_at_ms = excluded.finished_at_ms,
                duration_ms = excluded.duration_ms,
                test_count = excluded.test_count,
                snapshot_json = excluded.snapshot_json`,
            )
            .run(
              run.id,
              run.target,
              run.stage,
              run.status,
              DateTime.toEpochMillis(run.startedAt),
              finishedAtMs,
              durationMs,
              run.tests.length,
              encodeStoredTestRun(run),
            );
        });
      };

      const writeTestArtifact = (artifact: TestArtifactWrite): TestArtifactRefValue => {
        if (artifact.ref.byteLength !== artifact.body.byteLength) {
          throw new Error(`Local test-run artifact byte length mismatch for ${artifact.ref.id}`);
        }
        const previousRow = database
          .prepare("SELECT ref_json, content_path FROM test_artifacts WHERE id = ?")
          .get(artifact.ref.id);
        const previousPath =
          previousRow === undefined ? undefined : parseStoredArtifactRow(previousRow).content_path;
        const blob = persistArtifactBlob(stagingDirectory, blobDirectory, artifact.body);
        try {
          sqliteTransaction(database, () => {
            database
              .prepare(
                `INSERT INTO test_artifacts (
                  id, run_id, test_execution_id, name, kind, content_type, byte_length,
                  created_at_ms, content_sha256, ref_json, content_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  run_id = excluded.run_id,
                  test_execution_id = excluded.test_execution_id,
                  name = excluded.name,
                  kind = excluded.kind,
                  content_type = excluded.content_type,
                  byte_length = excluded.byte_length,
                  created_at_ms = excluded.created_at_ms,
                  content_sha256 = excluded.content_sha256,
                  ref_json = excluded.ref_json,
                  content_path = excluded.content_path`,
              )
              .run(
                artifact.ref.id,
                artifact.ref.runId,
                artifact.ref.testExecutionId,
                artifact.ref.name,
                artifact.ref.kind,
                artifact.ref.contentType,
                artifact.ref.byteLength,
                DateTime.toEpochMillis(artifact.ref.createdAt),
                blob.contentHash,
                encodeStoredArtifactRef(artifact.ref),
                blob.contentPath,
              );
          });
        } catch (error) {
          removeUnreferencedBlob(database, blob.contentPath);
          throw error;
        }
        if (previousPath !== undefined && previousPath !== blob.contentPath) {
          removeUnreferencedBlob(database, previousPath);
        }
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
          runOperation("listTestRuns", (): ReadonlyArray<TestRunSummary> => {
            const statuses = JSON.stringify(query.statuses);
            const targets = JSON.stringify(query.targets);
            const rows = parseStoredTestRunSummaryRows(
              database
                .prepare(
                  `SELECT id, target, status, started_at_ms, test_count
                   FROM test_runs
                   WHERE (json_array_length(?) = 0 OR status IN (SELECT value FROM json_each(?)))
                     AND (json_array_length(?) = 0 OR target IN (SELECT value FROM json_each(?)))
                   ORDER BY started_at_ms DESC
                   LIMIT ?`,
                )
                .all(statuses, statuses, targets, targets, query.limit),
            );
            return rows.map((row) => ({
              id: row.id,
              target: row.target,
              status: row.status,
              startedAt: DateTime.makeUnsafe(row.started_at_ms),
              testCount: row.test_count,
            }));
          }),
        updateTestRun: (run) => runOperation("updateTestRun", () => writeTestRun(run)),
        deleteTestRun: (runId: TestRunIdValue) =>
          runOperation("deleteTestRun", () => {
            const artifactRows = parseStoredArtifactRows(
              database
                .prepare("SELECT ref_json, content_path FROM test_artifacts WHERE run_id = ?")
                .all(runId),
            );
            sqliteTransaction(database, () => {
              database.prepare("DELETE FROM test_runs WHERE id = ?").run(runId);
            });
            for (const row of artifactRows) removeUnreferencedBlob(database, row.content_path);
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
                  `SELECT ref_json, content_path FROM test_artifacts
                   WHERE run_id = ? ORDER BY created_at_ms, id`,
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
            sqliteTransaction(database, () => {
              database.prepare("DELETE FROM test_artifacts WHERE id = ?").run(artifactId);
            });
            if (row !== undefined) {
              removeUnreferencedBlob(database, parseStoredArtifactRow(row).content_path);
            }
          }),
      });
    }),
  );

/**
 * Provides local SQLite metadata and immutable artifact blobs rooted at an explicit directory.
 * A future centralized backend may implement the same CRUD contract through an authenticated
 * evidence-service client; the production Overseer API must not expose test-only endpoints.
 */
export const testRunStorageLocalLayerAt = (
  rootDirectory: LocalTestRunStorageDirectory,
): Layer.Layer<TestRunStorage, TestRunStorageError> =>
  Layer.effect(TestRunStorage, makeLocalTestRunStorage(rootDirectory));
