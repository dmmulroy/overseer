import { TestRunId, TestStage } from "@overseer/test-trace-protocol";
import { Schema } from "effect";
import { OverseerTestTarget } from "../overseer-test-run.ts";
import { TestArtifactRef } from "./test-artifact.ts";
import { TestAssertionRecord } from "./test-assertion.ts";
import { TestExecutionId, TestId } from "./test-evidence-identity.ts";
import { TestExecutionTraceEvidence } from "./test-execution-trace-ref.ts";

/** Lifecycle status of a complete end-to-end test run. */
export const TestRunStatus = Schema.Literals([
  "running",
  "passed",
  "failed",
  "interrupted",
  "timed_out",
]);

/** Current or final lifecycle status of a test run. */
export type TestRunStatus = typeof TestRunStatus.Type;

/** Lifecycle status of one registered test execution attempt. */
export const TestExecutionStatus = Schema.Literals([
  "pending",
  "running",
  "passed",
  "failed",
  "interrupted",
  "timed_out",
  "skipped",
]);

/** Current or final lifecycle status of one test execution. */
export type TestExecutionStatus = typeof TestExecutionStatus.Type;

/** Running or completed test-run timing without optional completion fields. */
export const TestRunTiming = Schema.TaggedUnion({
  Running: {},
  Finished: {
    finishedAt: Schema.DateTimeUtcFromString,
    durationMs: Schema.Natural,
  },
});

/** Timing evidence for a complete test run. */
export type TestRunTiming = typeof TestRunTiming.Type;

const FinishedTestExecutionStatus = Schema.Literals([
  "passed",
  "failed",
  "interrupted",
  "timed_out",
]);

/** One pending, running, completed, or skipped attempt to execute a registered test. */
export const TestExecution = Schema.TaggedUnion({
  Pending: {
    id: TestExecutionId,
    attempt: Schema.Natural,
    status: Schema.Literal("pending"),
  },
  Running: {
    id: TestExecutionId,
    attempt: Schema.Natural,
    status: Schema.Literal("running"),
    startedAt: Schema.DateTimeUtcFromString,
    assertions: Schema.Array(TestAssertionRecord),
    artifacts: Schema.Array(TestArtifactRef),
    trace: TestExecutionTraceEvidence.cases.Pending,
  },
  Finished: {
    id: TestExecutionId,
    attempt: Schema.Natural,
    status: FinishedTestExecutionStatus,
    startedAt: Schema.DateTimeUtcFromString,
    finishedAt: Schema.DateTimeUtcFromString,
    durationMs: Schema.Natural,
    assertions: Schema.Array(TestAssertionRecord),
    artifacts: Schema.Array(TestArtifactRef),
    trace: TestExecutionTraceEvidence.cases.Completed,
  },
  Skipped: {
    id: TestExecutionId,
    attempt: Schema.Natural,
    status: Schema.Literal("skipped"),
    finishedAt: Schema.DateTimeUtcFromString,
  },
});

/** Persistable evidence captured for one registered test execution attempt. */
export type TestExecution = typeof TestExecution.Type;

/** Registered test metadata and every execution attempt in registration order. */
export const TestRecord = Schema.Struct({
  id: TestId,
  name: Schema.NonEmptyString,
  registrationIndex: Schema.Natural,
  executions: Schema.Array(TestExecution),
});

/** Persistable evidence for one test registered in a test run. */
export interface TestRecord extends Schema.Schema.Type<typeof TestRecord> {}

/** Structured snapshot of one end-to-end test run. */
export const TestRun = Schema.Struct({
  id: TestRunId,
  target: OverseerTestTarget,
  stage: TestStage,
  status: TestRunStatus,
  startedAt: Schema.DateTimeUtcFromString,
  timing: TestRunTiming,
  tests: Schema.Array(TestRecord),
});

/** Persistable aggregate snapshot for one end-to-end test command invocation. */
export interface TestRun extends Schema.Schema.Type<typeof TestRun> {}
