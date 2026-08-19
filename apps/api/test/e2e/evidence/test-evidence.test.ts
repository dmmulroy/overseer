import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { TestEvidence, testEvidenceLayerWithoutDependencies } from "./test-evidence.ts";
import { TestEvidenceRecorder, testEvidenceRecorderLayer } from "./test-evidence-recorder.ts";
import { TestExecutionId, TestRunId } from "./test-evidence-identity.ts";
import { TestRunStorage, testRunStorageMemoryLayer } from "./test-run-storage.ts";

const runId = TestRunId.make("test-run_attachments");
const testExecutionId = TestExecutionId.make("test-execution_attachments_0");
const dependencies = Layer.mergeAll(
  testEvidenceRecorderLayer({ testExecutionId }),
  testRunStorageMemoryLayer,
);
const evidenceLayer = testEvidenceLayerWithoutDependencies({ runId, testExecutionId }).pipe(
  Layer.provideMerge(dependencies),
);

describe("Test evidence", () => {
  it.effect("persists text and best-effort JSON attachments immediately", () =>
    Effect.gen(function* () {
      const evidence = yield* TestEvidence;
      const recorder = yield* TestEvidenceRecorder;
      const storage = yield* TestRunStorage;

      const textRef = yield* evidence.attachText({ name: "response", value: "Overseer API" });
      const jsonRef = yield* evidence.attachJson({ name: "diagnostic", value: { count: 1n } });

      const storedText = Option.getOrThrow(yield* storage.findTestArtifact(textRef.id));
      const storedJson = Option.getOrThrow(yield* storage.findTestArtifact(jsonRef.id));
      assert.strictEqual(new TextDecoder().decode(storedText.body), "Overseer API");
      assert.match(new TextDecoder().decode(storedJson.body), /1n/u);
      assert.deepStrictEqual(recorder.snapshot().artifacts, [textRef, jsonRef]);
    }).pipe(Effect.provide(evidenceLayer)),
  );
});
