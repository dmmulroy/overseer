import { Schema } from "effect";

/** DNS-safe infrastructure stage reserved for one isolated end-to-end test run. */
export const TestStage = Schema.String.check(
  Schema.isPattern(/^test-[a-z0-9](?:[a-z0-9-]{0,43}[a-z0-9])?$/),
).pipe(Schema.brand("TestStage"));

/** Parsed infrastructure stage that cannot name local or production resources. */
export type TestStage = typeof TestStage.Type;

/** Identity of one end-to-end test run retained with its Axiom traces. */
export const TestRunId = Schema.String.check(Schema.isPattern(/^test-run_[A-Za-z0-9_-]+$/)).pipe(
  Schema.brand("TestRunId"),
);

/** Parsed identity used to correlate one test run with retained trace evidence. */
export type TestRunId = typeof TestRunId.Type;

/** Derives the canonical E2E test-run identity from an isolated infrastructure stage. */
export const deriveTestRunIdFromStage = (stage: TestStage): TestRunId =>
  TestRunId.make(`test-run_${stage}`);

/** W3C-compatible 128-bit trace identity represented as lowercase hexadecimal. */
export const TestTraceId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)).pipe(
  Schema.brand("TestTraceId"),
);

/** Parsed identity of one trace exported for a test execution. */
export type TestTraceId = typeof TestTraceId.Type;

/** W3C-compatible 64-bit span identity represented as lowercase hexadecimal. */
export const TestSpanId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/)).pipe(
  Schema.brand("TestSpanId"),
);

/** Parsed identity of one span within an exported test trace. */
export type TestSpanId = typeof TestSpanId.Type;
