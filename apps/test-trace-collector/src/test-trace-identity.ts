import { Schema } from "effect";

/** Identity of one end-to-end test run accepted by the trace collector. */
export const TestRunId = Schema.String.check(Schema.isPattern(/^test-run_[A-Za-z0-9_-]+$/)).pipe(
  Schema.brand("TestRunId"),
);

/** Parsed identity used to select one test-run trace Durable Object. */
export type TestRunId = typeof TestRunId.Type;

/** W3C-compatible 128-bit trace identity represented as lowercase hexadecimal. */
export const TestTraceId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)).pipe(
  Schema.brand("TestTraceId"),
);

/** Parsed identity of one trace collected for a test execution. */
export type TestTraceId = typeof TestTraceId.Type;

/** W3C-compatible 64-bit span identity represented as lowercase hexadecimal. */
export const TestSpanId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/)).pipe(
  Schema.brand("TestSpanId"),
);

/** Parsed identity of one span within a collected test trace. */
export type TestSpanId = typeof TestSpanId.Type;
