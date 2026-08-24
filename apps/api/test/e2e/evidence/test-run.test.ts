import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { TestExecutionId } from "./test-evidence-identity.ts";
import { TestExecution, TestRun } from "./test-run.ts";

describe("Test run evidence", () => {
  it("round-trips one completed test with one passing Equal assertion", () => {
    const storedRun = {
      id: "test-run_01KZGWRATYFXD8QCG7QTKG5C3S",
      target: "local",
      stage: "test-dmmulroy-01kzgwmq4054axzgw9rr1vj3jm",
      status: "passed",
      startedAt: "2026-08-17T14:22:31.000Z",
      timing: {
        _tag: "Finished",
        finishedAt: "2026-08-17T14:22:32.000Z",
        durationMs: 1_000,
      },
      tests: [
        {
          id: "test_0",
          name: "a Workspace can be renamed",
          registrationIndex: 0,
          executions: [
            {
              _tag: "Finished",
              id: "test-execution_0_0",
              attempt: 0,
              status: "passed",
              startedAt: "2026-08-17T14:22:31.441Z",
              finishedAt: "2026-08-17T14:22:31.442Z",
              durationMs: 1,
              artifacts: [],
              trace: {
                _tag: "Completed",
                traceId: "0123456789abcdef0123456789abcdef",
                provider: "axiom",
                dataset: "overseer-e2e-traces",
              },
              assertions: [
                {
                  id: "assertion_test-execution_0_0_0",
                  testExecutionId: "test-execution_0_0",
                  sequence: 0,
                  groupPath: [],
                  description: "Workspace has its renamed value",
                  startedAt: "2026-08-17T14:22:31.441Z",
                  durationMs: 1,
                  operation: {
                    _tag: "Equal",
                    actual: "Renamed Workspace",
                    expected: "Renamed Workspace",
                  },
                  outcome: { _tag: "Passed" },
                },
              ],
            },
          ],
        },
      ],
    } as const;

    const run = Schema.decodeUnknownSync(TestRun)(storedRun);
    const encodedRun = Schema.encodeSync(TestRun)(run);

    assert.deepStrictEqual(encodedRun, storedRun);
  });

  it("represents a registered test as pending without a false start time", () => {
    const pendingExecution = TestExecution.make({
      _tag: "Pending",
      id: TestExecutionId.make("test-execution_pending_0"),
      attempt: 0,
      status: "pending",
    });

    assert.deepStrictEqual(Schema.encodeSync(TestExecution)(pendingExecution), {
      _tag: "Pending",
      id: "test-execution_pending_0",
      attempt: 0,
      status: "pending",
    });
  });
});
