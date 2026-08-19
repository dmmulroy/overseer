import * as Cloudflare from "alchemy/Cloudflare";
import type { CompiledStack } from "alchemy/Stack";
import * as Test from "alchemy/Test/Vitest";
import { DateTime, Effect, Layer, ManagedRuntime, Option } from "effect";
import { afterAll, beforeAll } from "vite-plus/test";
import {
  type ITestAssert,
  TestAssert,
  testAssertLayerWithoutDependencies,
} from "./evidence/test-assert.ts";
import {
  type ITestEvidence,
  TestEvidence,
  testEvidenceLayerWithoutDependencies,
} from "./evidence/test-evidence.ts";
import {
  TestEvidenceRecorder,
  testEvidenceRecorderLayer,
} from "./evidence/test-evidence-recorder.ts";
import { TestExecutionId, TestId, TestRunId } from "./evidence/test-evidence-identity.ts";
import {
  deriveTestRunStatus,
  type FinishedTestExecutionStatus,
  finalizePendingTestExecutions,
  testExecutionStatusFromCause,
} from "./evidence/test-run-lifecycle.ts";
import { TestRun, type TestRecord, type TestRun as TestRunSnapshot } from "./evidence/test-run.ts";
import { type ITestRunStorage, TestRunStorage } from "./evidence/test-run-storage.ts";
import { localTestRunStorageLayer } from "./evidence/test-run-storage-local.ts";
import { createFixtureRegistry, type FixtureRegistry } from "./fixture-registry.ts";
import {
  type IOverseerApiClient,
  overseerApiClientLayer,
  OverseerApiClient,
} from "./overseer-api-client.ts";
import {
  parseOverseerApiDeployment,
  waitForOverseerApiDeployment,
} from "./overseer-api-deployment.ts";
import { overseerTestRunConfig } from "./overseer-test-run.ts";

/** Timeout options passed to one registered end-to-end test. */
export interface OverseerTestOptions {
  /** Maximum product-test execution time in milliseconds, excluding evidence finalization. */
  readonly timeout: number;
}

type OverseerStack = Test.TestEffect<CompiledStack<unknown>, never>;
type RegisteredTestMode = "run" | "skip";

/** Extensible values supplied when a harness constructs one end-to-end test Effect. */
export interface OverseerTestContext {
  /** Comprehensive fail-fast assertions recorded as test evidence. */
  readonly assert: ITestAssert;
  /** Authenticated schema-derived client for the selected Overseer API deployment. */
  readonly client: IOverseerApiClient;
  /** Explicit artifact attachments recorded for the current test execution. */
  readonly evidence: ITestEvidence;
  /** Deterministic schema-derived values, models, and scenarios for test-data construction. */
  readonly fixtures: FixtureRegistry;
}

/** Registration-time harness that shares one local or deployed Stack across feature test suites. */
export class OverseerTestHarness {
  private constructor(
    private readonly registerTest: (
      mode: RegisteredTestMode,
      name: string,
      makeEffect: (context: OverseerTestContext) => Effect.Effect<void, unknown>,
      options?: OverseerTestOptions,
    ) => void,
  ) {}

  /** Registers one deterministic product guarantee against the selected target. */
  readonly test = <E>(
    name: string,
    makeEffect: (context: OverseerTestContext) => Effect.Effect<void, E>,
    options?: OverseerTestOptions,
  ): void => {
    this.registerTest("run", name, makeEffect, options);
  };

  /** Registers one intentionally skipped product guarantee in test-run evidence. */
  readonly skip = <E>(
    name: string,
    makeEffect: (context: OverseerTestContext) => Effect.Effect<void, E>,
    options?: OverseerTestOptions,
  ): void => {
    this.registerTest("skip", name, makeEffect, options);
  };

  /** Configures Alchemy deployment, readiness, evidence persistence, and teardown for one Stack. */
  static fromStack(stack: OverseerStack): OverseerTestHarness {
    const testRun = Effect.runSync(overseerTestRunConfig);
    const runId = TestRunId.make(`test-run_${testRun.stage}`);
    const registeredTests: Array<TestRecord> = [];
    let infrastructureFailed = false;
    let runSnapshot = Option.none<TestRunSnapshot>();
    const storageRuntime = ManagedRuntime.make(localTestRunStorageLayer);
    const storageReady = Promise.withResolvers<ITestRunStorage>();
    const sharedStorageLayer = Layer.effect(
      TestRunStorage,
      Effect.promise(() => storageReady.promise),
    );
    const alchemyTest = Test.make({
      providers: Cloudflare.providers(),
      state: Cloudflare.state(),
      stage: testRun.stage,
      dev: testRun.target === "local",
    });
    const currentRun = (): TestRunSnapshot => Option.getOrThrow(runSnapshot);
    const replaceTest = (registrationIndex: number, test: TestRecord): void => {
      const snapshot = currentRun();
      runSnapshot = Option.some(
        TestRun.make({
          id: snapshot.id,
          target: snapshot.target,
          stage: snapshot.stage,
          status: snapshot.status,
          startedAt: snapshot.startedAt,
          timing: snapshot.timing,
          tests: snapshot.tests.map((existing) =>
            existing.registrationIndex === registrationIndex ? test : existing,
          ),
          artifacts: snapshot.artifacts,
        }),
      );
    };

    // Registered before Alchemy deployment so deployment and readiness failures still have a run.
    beforeAll(async () => {
      const storage = await storageRuntime.runPromise(TestRunStorage);
      storageReady.resolve(storage);
      const startedAt = DateTime.nowUnsafe();
      runSnapshot = Option.some(
        TestRun.make({
          id: runId,
          target: testRun.target,
          stage: testRun.stage,
          status: "running",
          startedAt,
          timing: { _tag: "Running" },
          tests: registeredTests,
          artifacts: [],
        }),
      );
      await storageRuntime.runPromise(storage.createTestRun(currentRun()));
    });

    const deployment = alchemyTest.beforeAll(
      alchemyTest.deploy(stack).pipe(
        Effect.flatMap((output) =>
          testRun.target === "local"
            ? parseOverseerApiDeployment("local")(output)
            : parseOverseerApiDeployment("deployed")(output),
        ),
        Effect.tap(waitForOverseerApiDeployment),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (exit._tag === "Failure") infrastructureFailed = true;
          }),
        ),
      ),
      { timeout: 600_000 },
    );
    // The outer runner destroys local state after Vitest closes Alchemy's dev sidecar.
    alchemyTest.afterAll.skipIf(testRun.target === "local")(alchemyTest.destroy(stack), {
      timeout: 300_000,
    });

    // Vitest runs afterAll hooks in reverse registration order, so evidence finalizes before teardown.
    afterAll(async () => {
      try {
        if (Option.isNone(runSnapshot)) return;
        const snapshot = runSnapshot.value;
        const finishedAt = DateTime.nowUnsafe();
        const tests = finalizePendingTestExecutions(snapshot.tests, finishedAt);
        runSnapshot = Option.some(
          TestRun.make({
            id: snapshot.id,
            target: snapshot.target,
            stage: snapshot.stage,
            status: deriveTestRunStatus(tests, {
              infrastructure: infrastructureFailed ? "failed" : "ready",
            }),
            startedAt: snapshot.startedAt,
            timing: {
              _tag: "Finished",
              finishedAt,
              durationMs: Math.max(
                0,
                DateTime.toEpochMillis(finishedAt) - DateTime.toEpochMillis(snapshot.startedAt),
              ),
            },
            tests,
            artifacts: snapshot.artifacts,
          }),
        );
        const storage = await storageReady.promise;
        await storageRuntime.runPromise(storage.updateTestRun(currentRun()));
      } finally {
        await storageRuntime.dispose();
      }
    });

    const apiClientLayer = Layer.unwrap(deployment.pipe(Effect.map(overseerApiClientLayer)));

    return new OverseerTestHarness((mode, name, makeEffect, options) => {
      const registrationIndex = registeredTests.length;
      const testId = TestId.make(`test_${registrationIndex}`);
      const testExecutionId = TestExecutionId.make(`test-execution_${registrationIndex}_0`);
      registeredTests.push({
        id: testId,
        name,
        registrationIndex,
        executions: [
          {
            _tag: "Pending",
            id: testExecutionId,
            attempt: 0,
            status: "pending",
          },
        ],
      });

      const timeoutMs = options?.timeout ?? 120_000;
      const effect = Effect.gen(function* () {
        const storage = yield* TestRunStorage;
        const startedAt = DateTime.nowUnsafe();
        const registered = currentRun().tests[registrationIndex];
        if (registered === undefined) {
          return yield* Effect.die(
            new Error(`Overseer test registration ${registrationIndex} was not found`),
          );
        }
        const runningTest: TestRecord = {
          id: registered.id,
          name: registered.name,
          registrationIndex: registered.registrationIndex,
          executions: [
            {
              _tag: "Running",
              id: testExecutionId,
              attempt: 0,
              status: "running",
              startedAt,
              assertions: [],
              artifacts: [],
            },
          ],
        };
        replaceTest(registrationIndex, runningTest);
        yield* storage.updateTestRun(currentRun());

        const client = yield* OverseerApiClient;
        const assert: ITestAssert = yield* TestAssert;
        const evidence: ITestEvidence = yield* TestEvidence;
        const recorder = yield* TestEvidenceRecorder;
        const fixtures = createFixtureRegistry();

        return yield* makeEffect({ assert, client, evidence, fixtures }).pipe(
          Effect.timeout(timeoutMs),
          Effect.onExit((testExit) =>
            Effect.gen(function* () {
              const finishedAt = DateTime.nowUnsafe();
              const recorded = recorder.snapshot();
              const status: FinishedTestExecutionStatus =
                testExit._tag === "Success"
                  ? "passed"
                  : testExecutionStatusFromCause(testExit.cause);
              replaceTest(registrationIndex, {
                id: runningTest.id,
                name: runningTest.name,
                registrationIndex: runningTest.registrationIndex,
                executions: [
                  {
                    _tag: "Finished",
                    id: testExecutionId,
                    attempt: 0,
                    status,
                    startedAt,
                    finishedAt,
                    durationMs: Math.max(
                      0,
                      DateTime.toEpochMillis(finishedAt) - DateTime.toEpochMillis(startedAt),
                    ),
                    assertions: recorded.assertions,
                    artifacts: recorded.artifacts,
                  },
                ],
              });
              yield* storage.updateTestRun(currentRun());
            }),
          ),
        );
      });

      const recorderLayer = testEvidenceRecorderLayer({ testExecutionId });
      const evidenceCapabilitiesLayer = Layer.mergeAll(
        recorderLayer,
        testAssertLayerWithoutDependencies.pipe(Layer.provide(recorderLayer)),
        testEvidenceLayerWithoutDependencies({ runId, testExecutionId }).pipe(
          Layer.provide(recorderLayer),
        ),
      );
      const runnable = effect.pipe(
        Effect.provide(evidenceCapabilitiesLayer),
        Effect.provide(apiClientLayer),
        Effect.provide(sharedStorageLayer),
      );
      const runnerOptions = { timeout: timeoutMs + 5_000 };
      if (mode === "skip") {
        alchemyTest.test.skip(name, runnable, runnerOptions);
      } else {
        alchemyTest.test(name, runnable, runnerOptions);
      }
    });
  }
}
