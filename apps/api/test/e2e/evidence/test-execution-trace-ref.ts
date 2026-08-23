import { TestTraceId } from "@overseer/test-trace-protocol";
import { Schema } from "effect";

/** Trace evidence lifecycle while an execution is running and after it finishes. */
export const TestExecutionTraceEvidence = Schema.TaggedUnion({
  Pending: {},
  Completed: {
    traceId: TestTraceId,
    url: Schema.URLFromString,
  },
});

/** Persisted trace evidence associated directly with one test execution. */
export type TestExecutionTraceEvidence = typeof TestExecutionTraceEvidence.Type;

/** TTC trace reference required after a test execution finishes. */
export type CompletedTestExecutionTraceEvidence =
  typeof TestExecutionTraceEvidence.cases.Completed.Type;
