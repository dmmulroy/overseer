import { Context, DateTime, Layer } from "effect";
import type { TestArtifactRef } from "./test-artifact.ts";
import type { TestAssertionRecord } from "./test-assertion.ts";
import { TestArtifactId, TestAssertionId, type TestExecutionId } from "./test-evidence-identity.ts";

/** Reserved identity, ordering, and timing data for one executing assertion. */
export interface TestAssertionReservation {
  /** Test execution that owns the reserved assertion. */
  readonly testExecutionId: TestExecutionId;
  /** Deterministic identity derived from the execution and sequence. */
  readonly id: TestAssertionId;
  /** Zero-based assertion order within the execution. */
  readonly sequence: number;
  /** Active nested assertion groups at invocation time. */
  readonly groupPath: ReadonlyArray<string>;
  /** UTC wall-clock time at assertion invocation. */
  readonly startedAt: DateTime.Utc;
  /** Epoch milliseconds used to derive bounded diagnostic duration. */
  readonly startedAtMillis: number;
}

/** Snapshot of evidence accumulated by one test execution. */
export interface TestEvidenceSnapshot {
  /** Assertions in execution order. */
  readonly assertions: ReadonlyArray<TestAssertionRecord>;
  /** Artifact references in attachment order. */
  readonly artifacts: ReadonlyArray<TestArtifactRef>;
}

/** Identity required to construct a fresh per-test evidence recorder. */
export interface TestEvidenceRecorderInput {
  /** Identity of the test execution that owns every recorded item. */
  readonly testExecutionId: TestExecutionId;
}

/** Fresh mutable evidence authority scoped to one test execution. */
export interface ITestEvidenceRecorder {
  /** Reserve the next deterministic assertion identity and capture invocation context. */
  readonly reserveAssertion: () => TestAssertionReservation;
  /** Append one completed assertion in its reserved sequence position. */
  readonly appendAssertion: (assertion: TestAssertionRecord) => void;
  /** Reserve the next deterministic artifact identity. */
  readonly reserveArtifactId: () => TestArtifactId;
  /** Append one immediately persisted artifact reference. */
  readonly appendArtifact: (artifact: TestArtifactRef) => void;
  /** Enter one assertion evidence group until the matching leave operation. */
  readonly enterGroup: (description: string) => void;
  /** Leave the innermost assertion evidence group. */
  readonly leaveGroup: () => void;
  /** Read an immutable copy of all evidence accumulated so far. */
  readonly snapshot: () => TestEvidenceSnapshot;
}

/** Provides fresh mutable evidence recording for one test execution. */
export class TestEvidenceRecorder extends Context.Service<
  TestEvidenceRecorder,
  ITestEvidenceRecorder
>()("@overseer/TestEvidenceRecorder") {}

/** Constructs a fresh evidence recorder for one test execution. */
export const makeTestEvidenceRecorder = (
  input: TestEvidenceRecorderInput,
): TestEvidenceRecorder["Service"] => {
  const assertions: Array<TestAssertionRecord> = [];
  const artifacts: Array<TestArtifactRef> = [];
  const groupPath: Array<string> = [];
  let assertionSequence = 0;
  let artifactSequence = 0;

  return TestEvidenceRecorder.of({
    reserveAssertion: () => {
      const sequence = assertionSequence;
      assertionSequence += 1;
      return {
        testExecutionId: input.testExecutionId,
        id: TestAssertionId.make(`assertion_${input.testExecutionId}_${sequence}`),
        sequence,
        groupPath: [...groupPath],
        startedAt: DateTime.nowUnsafe(),
        startedAtMillis: Date.now(),
      };
    },
    appendAssertion: (assertion) => {
      assertions.push(assertion);
    },
    reserveArtifactId: () => {
      const sequence = artifactSequence;
      artifactSequence += 1;
      return TestArtifactId.make(`artifact_${input.testExecutionId}_${sequence}`);
    },
    appendArtifact: (artifact) => {
      artifacts.push(artifact);
    },
    enterGroup: (description) => {
      groupPath.push(description);
    },
    leaveGroup: () => {
      groupPath.pop();
    },
    snapshot: () => ({ assertions: [...assertions], artifacts: [...artifacts] }),
  });
};

/** Provides one fresh evidence recorder for the supplied test execution identity. */
export const testEvidenceRecorderLayer = (
  input: TestEvidenceRecorderInput,
): Layer.Layer<TestEvidenceRecorder> =>
  Layer.succeed(TestEvidenceRecorder, makeTestEvidenceRecorder(input));
