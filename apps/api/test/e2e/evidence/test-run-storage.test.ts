import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { TestStage } from "../overseer-test-run.ts";
import { TestArtifactRef } from "./test-artifact.ts";
import { TestArtifactId, TestExecutionId, TestId, TestRunId } from "./test-evidence-identity.ts";
import { TestRun } from "./test-run.ts";
import { TestRunStorage, testRunStorageMemoryLayer } from "./test-run-storage.ts";
import { testRunStorageLocalLayerAt } from "./test-run-storage-local.ts";

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
  artifacts: [],
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
  assert.strictEqual(summaries[0]?.status, "passed");

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
      Effect.provide(testRunStorageLocalLayerAt(rootDirectory)),
      Effect.ensuring(Effect.sync(() => rmSync(rootDirectory, { recursive: true, force: true }))),
    );
  });
});
