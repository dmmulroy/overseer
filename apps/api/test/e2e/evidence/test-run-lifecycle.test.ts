import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime } from "effect";
import { TestExecutionId, TestId } from "./test-evidence-identity.ts";
import {
  deriveTestRunStatus,
  finalizePendingTestExecutions,
  testExecutionStatusFromCause,
} from "./test-run-lifecycle.ts";
import type { TestRecord } from "./test-run.ts";

const pendingTest: TestRecord = {
  id: TestId.make("test_0"),
  name: "pending test",
  registrationIndex: 0,
  executions: [
    {
      _tag: "Pending",
      id: TestExecutionId.make("test-execution_0_0"),
      attempt: 0,
      status: "pending",
    },
  ],
};

describe("Test run lifecycle", () => {
  it("classifies timeout, interruption, and ordinary failures distinctly", () => {
    assert.strictEqual(
      testExecutionStatusFromCause(Cause.fail(new Cause.TimeoutError())),
      "timed_out",
    );
    assert.strictEqual(testExecutionStatusFromCause(Cause.interrupt()), "interrupted");
    assert.strictEqual(testExecutionStatusFromCause(Cause.fail("product failure")), "failed");
  });

  it("finalizes executions that never started as skipped", () => {
    const finishedAt = DateTime.makeUnsafe("2026-08-17T14:22:32.000Z");
    const tests = finalizePendingTestExecutions([pendingTest], finishedAt);

    assert.deepStrictEqual(tests[0]?.executions[0], {
      _tag: "Skipped",
      id: TestExecutionId.make("test-execution_0_0"),
      attempt: 0,
      status: "skipped",
      finishedAt,
    });
    assert.strictEqual(deriveTestRunStatus(tests, { infrastructure: "ready" }), "passed");
    assert.strictEqual(deriveTestRunStatus(tests, { infrastructure: "failed" }), "failed");
  });
});
