import { OVERSEER_E2E_TRACE_DATASET_NAME } from "@overseer/shared-infrastructure";
import { TestTraceId } from "../../../src/overseer-e2e-trace-identity.ts";
import { Schema } from "effect";

/** Trace evidence lifecycle while an execution is running and after it finishes. */
export const TestExecutionTraceEvidence = Schema.TaggedUnion({
  Pending: {},
  Completed: {
    traceId: TestTraceId,
    provider: Schema.Literal("axiom"),
    dataset: Schema.Literal(OVERSEER_E2E_TRACE_DATASET_NAME),
  },
});

/** Persisted trace evidence associated directly with one test execution. */
export type TestExecutionTraceEvidence = typeof TestExecutionTraceEvidence.Type;

/** Persisted Axiom trace identity required after a test execution finishes. */
export type CompletedTestExecutionTraceEvidence =
  typeof TestExecutionTraceEvidence.cases.Completed.Type;
