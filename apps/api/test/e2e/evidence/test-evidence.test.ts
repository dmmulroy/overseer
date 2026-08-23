import { assert, describe, it } from "@effect/vitest";
import { TestRunId } from "@overseer/test-trace-protocol";
import { Effect, Layer, Option } from "effect";
import { TestEvidence, testEvidenceLayerWithoutDependencies } from "./test-evidence.ts";
import { TestEvidenceRecorder, testEvidenceRecorderLayer } from "./test-evidence-recorder.ts";
import { TestExecutionId } from "./test-evidence-identity.ts";
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
  it.effect("persists value and byte-source attachments immediately", () =>
    Effect.gen(function* () {
      const evidence = yield* TestEvidence;
      const recorder = yield* TestEvidenceRecorder;
      const storage = yield* TestRunStorage;

      const textRef = yield* evidence.attachText({ name: "response", value: "Overseer API" });
      const jsonRef = yield* evidence.attachJson({ name: "diagnostic", value: { count: 1n } });
      const fileRef = yield* evidence.attachFile({
        name: "bytes-file",
        source: { _tag: "Bytes", body: new TextEncoder().encode("file") },
      });
      const videoRef = yield* evidence.attachVideo({
        name: "bytes-video",
        source: { _tag: "Bytes", body: new Uint8Array([0, 1, 2]) },
        contentType: "video/mp4",
      });
      const screenshotRef = yield* evidence.attachScreenshot({
        name: "bytes-screenshot",
        source: { _tag: "Bytes", body: new Uint8Array([3, 4, 5]) },
        contentType: "image/jpeg",
      });

      const storedText = Option.getOrThrow(yield* storage.findTestArtifact(textRef.id));
      const storedJson = Option.getOrThrow(yield* storage.findTestArtifact(jsonRef.id));
      assert.strictEqual(new TextDecoder().decode(storedText.body), "Overseer API");
      assert.match(new TextDecoder().decode(storedJson.body), /1n/u);
      assert.strictEqual(fileRef.contentType, "application/octet-stream");
      assert.strictEqual(videoRef.contentType, "video/mp4");
      assert.strictEqual(screenshotRef.contentType, "image/jpeg");
      assert.deepStrictEqual(recorder.snapshot().artifacts, [
        textRef,
        jsonRef,
        fileRef,
        videoRef,
        screenshotRef,
      ]);
    }).pipe(Effect.provide(evidenceLayer)),
  );
});
