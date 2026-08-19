import { Layer } from "effect";
import { TestAssert, testAssertLayerWithoutDependencies } from "./test-assert.ts";
import {
  TestEvidence,
  type TestEvidenceInput,
  testEvidenceLayerWithoutDependencies,
} from "./test-evidence.ts";
import { TestEvidenceRecorder, testEvidenceRecorderLayer } from "./test-evidence-recorder.ts";
import type { TestRunStorage } from "./test-run-storage.ts";

/** Run and execution identities for one isolated test-execution evidence graph. */
export type TestExecutionEvidenceInput = TestEvidenceInput;

/**
 * Provides one fresh recorder shared by assertions and attachments while preserving the
 * suite-scoped test-run storage requirement.
 */
export const testExecutionEvidenceLayer = (
  input: TestExecutionEvidenceInput,
): Layer.Layer<TestAssert | TestEvidence | TestEvidenceRecorder, never, TestRunStorage> => {
  const recorderLayer = testEvidenceRecorderLayer({
    testExecutionId: input.testExecutionId,
  });

  return Layer.mergeAll(
    recorderLayer,
    testAssertLayerWithoutDependencies.pipe(Layer.provide(recorderLayer)),
    testEvidenceLayerWithoutDependencies(input).pipe(Layer.provide(recorderLayer)),
  );
};
