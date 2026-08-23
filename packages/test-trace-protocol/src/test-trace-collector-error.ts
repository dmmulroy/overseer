import { Schema } from "effect";
import { TestRunId, TestTraceId } from "./test-trace-identity.ts";

/** Public trace collector operations that can be temporarily unavailable. */
export const TestTraceCollectorOperation = Schema.Literals(["ingestOtlpTraces", "findTestTrace"]);

/** Name of one temporarily unavailable trace collector operation. */
export type TestTraceCollectorOperation = typeof TestTraceCollectorOperation.Type;

/** A syntactically valid trace identity not yet retained by the requested test run. */
export class TestTraceNotFoundError extends Schema.Error<TestTraceNotFoundError>(
  "TestTraceNotFoundError",
)(
  {
    code: Schema.Literal("test_trace_not_found"),
    message: Schema.String,
    testRunId: TestRunId,
    traceId: TestTraceId,
  },
  { httpApiStatus: 404 },
) {}

/** A temporary collector failure that prevented ingestion or retrieval. */
export class TestTraceCollectorUnavailableError extends Schema.Error<TestTraceCollectorUnavailableError>(
  "TestTraceCollectorUnavailableError",
)(
  {
    code: Schema.Literal("test_trace_collector_unavailable"),
    message: Schema.String,
    operation: TestTraceCollectorOperation,
    testRunId: TestRunId,
    retryable: Schema.Literal(true),
  },
  { httpApiStatus: 503 },
) {}
