import { Cause, DateTime, Option } from "effect";
import type { TestRecord, TestRunStatus } from "./test-run.ts";

/** Final status of a test execution that started running. */
export type FinishedTestExecutionStatus = "passed" | "failed" | "interrupted" | "timed_out";

/** Infrastructure outcome used when deriving the final test-run status. */
export interface TestRunInfrastructureOutcome {
  /** Whether deployment and readiness completed successfully. */
  readonly infrastructure: "ready" | "failed";
}

/** Classify a failed test Effect without conflating timeout and interruption. */
export const testExecutionStatusFromCause = <E>(
  cause: Cause.Cause<E>,
): Exclude<FinishedTestExecutionStatus, "passed"> => {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure) && Cause.isTimeoutError(failure.value)) return "timed_out";
  return Cause.hasInterrupts(cause) ? "interrupted" : "failed";
};

/** Convert every registered execution that never started into a truthful skipped execution. */
export const finalizePendingTestExecutions = (
  tests: ReadonlyArray<TestRecord>,
  finishedAt: DateTime.Utc,
): ReadonlyArray<TestRecord> =>
  tests.map((test) => ({
    id: test.id,
    name: test.name,
    registrationIndex: test.registrationIndex,
    executions: test.executions.map((execution) =>
      execution._tag === "Pending"
        ? {
            _tag: "Skipped",
            id: execution.id,
            attempt: execution.attempt,
            status: "skipped",
            finishedAt,
          }
        : execution,
    ),
  }));

/** Derive one final run status from infrastructure and completed execution outcomes. */
export const deriveTestRunStatus = (
  tests: ReadonlyArray<TestRecord>,
  outcome: TestRunInfrastructureOutcome,
): TestRunStatus => {
  if (outcome.infrastructure === "failed") return "failed";
  const statuses = tests.flatMap((test) => test.executions.map((execution) => execution.status));
  if (statuses.some((status) => status === "timed_out")) return "timed_out";
  if (statuses.some((status) => status === "interrupted")) return "interrupted";
  if (statuses.some((status) => status === "failed")) return "failed";
  return statuses.every((status) => status === "passed" || status === "skipped")
    ? "passed"
    : "failed";
};
