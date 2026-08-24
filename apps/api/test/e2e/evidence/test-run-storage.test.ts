import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { TestRunId, TestStage } from "../../../src/overseer-e2e-trace-identity.ts";
import { ConfigProvider, DateTime, Effect, Option, Schema } from "effect";
import { TestArtifactRef } from "./test-artifact.ts";
import { TestArtifactId, TestExecutionId, TestId } from "./test-evidence-identity.ts";
import { TestRun } from "./test-run.ts";
import { TestRunStorage, testRunStorageMemoryLayer } from "./test-run-storage.ts";
import {
  LocalTestRunStorageDirectory,
  localTestRunStorageDirectoryConfig,
  testRunStorageLocalLayerAt,
} from "./test-run-storage-local.ts";

const runId = TestRunId.make("test-run_storage");
const executionId = TestExecutionId.make("test-execution_storage_0");
const startedAt = DateTime.makeUnsafe("2026-08-17T14:22:31.000Z");
const run = TestRun.make({
  id: runId,
  target: "local",
  stage: TestStage.make("test-storage-01kzgwmq4054axzgw9rr1vj3jm"),
  status: "running",
  startedAt,
  timing: { _tag: "Running" },
  tests: [
    {
      id: TestId.make("test_0"),
      name: "storage behavior",
      registrationIndex: 0,
      executions: [],
    },
  ],
});
const artifactRef = TestArtifactRef.make({
  id: TestArtifactId.make("artifact_test-execution_storage_0_0"),
  runId,
  testExecutionId: executionId,
  name: "result",
  kind: "Text",
  contentType: "text/plain; charset=utf-8",
  byteLength: 6,
  createdAt: startedAt,
});

const verifyStorageCrud = Effect.gen(function* () {
  const storage = yield* TestRunStorage;

  yield* storage.createTestRun(run);
  const created = yield* storage.findTestRun(runId);
  assert.deepStrictEqual(created, Option.some(run));

  const finished = TestRun.make({
    ...run,
    status: "passed",
    timing: { _tag: "Finished", finishedAt: startedAt, durationMs: 0 },
  });
  yield* storage.updateTestRun(finished);
  const summaries = yield* storage.listTestRuns({ statuses: ["passed"], targets: [], limit: 10 });
  const excludedSummaries = yield* storage.listTestRuns({
    statuses: ["failed"],
    targets: [],
    limit: 10,
  });
  assert.strictEqual(summaries[0]?.status, "passed");
  assert.deepStrictEqual(excludedSummaries, []);

  yield* storage.createTestArtifact({ ref: artifactRef, body: new TextEncoder().encode("result") });
  const artifact = yield* storage.findTestArtifact(artifactRef.id);
  assert.strictEqual(new TextDecoder().decode(Option.getOrThrow(artifact).body), "result");
  assert.deepStrictEqual(yield* storage.listTestArtifacts(runId), [artifactRef]);

  yield* storage.deleteTestArtifact(artifactRef.id);
  assert.deepStrictEqual(yield* storage.findTestArtifact(artifactRef.id), Option.none());
  yield* storage.deleteTestRun(runId);
  assert.deepStrictEqual(yield* storage.findTestRun(runId), Option.none());
});

describe("Test run storage", () => {
  it.effect("provides faithful in-memory CRUD", () =>
    verifyStorageCrud.pipe(Effect.provide(testRunStorageMemoryLayer)),
  );

  it.effect("persists CRUD through local SQLite and artifact files", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "overseer-evidence-"));
    return verifyStorageCrud.pipe(
      Effect.provide(testRunStorageLocalLayerAt(LocalTestRunStorageDirectory.make(rootDirectory))),
      Effect.ensuring(Effect.sync(() => rmSync(rootDirectory, { recursive: true, force: true }))),
    );
  });

  it.effect("stores queryable run metadata and content-addressed artifact blobs", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "overseer-evidence-"));
    const body = new TextEncoder().encode("result");
    const expectedHash = createHash("sha256").update(body).digest("hex");
    const updatedBody = new TextEncoder().encode("updated");
    const updatedHash = createHash("sha256").update(updatedBody).digest("hex");

    const verify = Effect.gen(function* () {
      const storage = yield* TestRunStorage;
      yield* storage.createTestRun(run);
      yield* storage.createTestArtifact({ ref: artifactRef, body });

      const database = new DatabaseSync(join(rootDirectory, "test-runs.sqlite"));
      const storedRun = database
        .prepare("SELECT target, stage, status, test_count FROM test_runs WHERE id = ?")
        .get(runId);
      const storedArtifact = database
        .prepare("SELECT content_sha256, content_path FROM test_artifacts WHERE id = ?")
        .get(artifactRef.id);
      database.close();

      assert.deepStrictEqual(storedRun, {
        target: "local",
        stage: run.stage,
        status: "running",
        test_count: 1,
      });
      assert.deepStrictEqual(storedArtifact, {
        content_sha256: expectedHash,
        content_path: join(rootDirectory, "blobs", expectedHash),
      });
      assert.deepStrictEqual(readdirSync(join(rootDirectory, "blobs")), [expectedHash]);
      assert.strictEqual(existsSync(join(rootDirectory, "staging")), true);

      const updatedRef = TestArtifactRef.make({
        id: artifactRef.id,
        runId: artifactRef.runId,
        testExecutionId: artifactRef.testExecutionId,
        name: artifactRef.name,
        kind: artifactRef.kind,
        contentType: artifactRef.contentType,
        byteLength: updatedBody.byteLength,
        createdAt: artifactRef.createdAt,
      });
      yield* storage.updateTestArtifact({ ref: updatedRef, body: updatedBody });
      const updatedArtifact = Option.getOrThrow(yield* storage.findTestArtifact(artifactRef.id));

      assert.strictEqual(new TextDecoder().decode(updatedArtifact.body), "updated");
      assert.deepStrictEqual(readdirSync(join(rootDirectory, "blobs")), [updatedHash]);
    });

    return verify.pipe(
      Effect.provide(testRunStorageLocalLayerAt(LocalTestRunStorageDirectory.make(rootDirectory))),
      Effect.ensuring(Effect.sync(() => rmSync(rootDirectory, { recursive: true, force: true }))),
    );
  });

  it.effect("migrates legacy snapshot rows and artifact files", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "overseer-evidence-legacy-"));
    const legacyArtifactDirectory = join(rootDirectory, "artifacts");
    const legacyArtifactPath = join(legacyArtifactDirectory, `${artifactRef.id}.bin`);
    const body = new TextEncoder().encode("result");
    mkdirSync(legacyArtifactDirectory, { recursive: true });
    writeFileSync(legacyArtifactPath, body);

    const database = new DatabaseSync(join(rootDirectory, "test-runs.sqlite"));
    database.exec(`
      CREATE TABLE test_runs (
        id TEXT PRIMARY KEY,
        started_at_ms INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE test_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        ref_json TEXT NOT NULL,
        content_path TEXT NOT NULL
      ) STRICT;
    `);
    database
      .prepare("INSERT INTO test_runs (id, started_at_ms, snapshot_json) VALUES (?, ?, ?)")
      .run(
        run.id,
        DateTime.toEpochMillis(run.startedAt),
        Schema.encodeSync(Schema.fromJsonString(TestRun))(run),
      );
    database
      .prepare(
        "INSERT INTO test_artifacts (id, run_id, ref_json, content_path) VALUES (?, ?, ?, ?)",
      )
      .run(
        artifactRef.id,
        run.id,
        Schema.encodeSync(Schema.fromJsonString(TestArtifactRef))(artifactRef),
        legacyArtifactPath,
      );
    database.close();

    const verifyMigration = Effect.gen(function* () {
      const storage = yield* TestRunStorage;
      assert.deepStrictEqual(yield* storage.findTestRun(run.id), Option.some(run));
      const artifact = Option.getOrThrow(yield* storage.findTestArtifact(artifactRef.id));
      assert.strictEqual(new TextDecoder().decode(artifact.body), "result");
      assert.strictEqual(existsSync(legacyArtifactPath), false);
      assert.strictEqual(readdirSync(join(rootDirectory, "blobs")).length, 1);
    });

    return verifyMigration.pipe(
      Effect.provide(testRunStorageLocalLayerAt(LocalTestRunStorageDirectory.make(rootDirectory))),
      Effect.ensuring(Effect.sync(() => rmSync(rootDirectory, { recursive: true, force: true }))),
    );
  });

  it("parses the configured absolute local evidence directory", () => {
    const directory = join(tmpdir(), "overseer-evidence-configured");
    const provider = ConfigProvider.fromUnknown({ OVERSEER_EVIDENCE_DIRECTORY: directory });

    const parsed = Effect.runSync(localTestRunStorageDirectoryConfig.parse(provider));

    assert.strictEqual(parsed, directory);
  });
});
