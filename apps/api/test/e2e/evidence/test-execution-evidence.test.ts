import { assert, describe, it } from "@effect/vitest";
import { TestRunId } from "@overseer/test-trace-protocol";
import { Effect, Layer } from "effect";
import { TestAssert } from "./test-assert.ts";
import { TestEvidence } from "./test-evidence.ts";
import { TestEvidenceRecorder } from "./test-evidence-recorder.ts";
import { TestExecutionId } from "./test-evidence-identity.ts";
import { testExecutionEvidenceLayer } from "./test-execution-evidence.ts";
import { testRunStorageMemoryLayer } from "./test-run-storage.ts";

const runId = TestRunId.make("test-run_execution-evidence");
const testExecutionId = TestExecutionId.make("test-execution_execution-evidence_0");

describe("Test execution evidence", () => {
  it.effect("shares one fresh recorder across assertions and attachments", () =>
    Effect.gen(function* () {
      const testAssert = yield* TestAssert;
      const evidence = yield* TestEvidence;
      const recorder = yield* TestEvidenceRecorder;

      testAssert.equal("the observed state is active", "active", "active");
      const artifact = yield* evidence.attachText({ name: "state", value: "active" });

      const snapshot = recorder.snapshot();
      assert.strictEqual(snapshot.assertions.length, 1);
      assert.deepStrictEqual(snapshot.artifacts, [artifact]);
    }).pipe(
      Effect.provide(
        testExecutionEvidenceLayer({ runId, testExecutionId }).pipe(
          Layer.provide(testRunStorageMemoryLayer),
        ),
      ),
    ),
  );
});
