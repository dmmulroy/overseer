import { OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN } from "@overseer/shared-infrastructure";
import { ALCHEMY_DEV } from "alchemy";
import { Stack } from "alchemy/Stack";
import { Effect, Schema } from "effect";

/** Cloudflare script name reserved for the Production test trace collector Worker. */
export const TEST_TRACE_COLLECTOR_PRODUCTION_WORKER_NAME = "test-trace-collector-production";

const TEST_TRACE_COLLECTOR_PRODUCTION_STAGE = "production";

type TestTraceCollectorAlchemyExecution = {
  readonly isDevelopmentMode: boolean;
  readonly stage: string;
};

/** Local, production, or preview deployment policy for the test trace collector. */
export const TestTraceCollectorDeploymentTarget = Schema.TaggedUnion({
  Local: {
    workersDev: Schema.Literal(true),
  },
  Production: {
    domain: Schema.Literal(OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN),
    workerName: Schema.Literal(TEST_TRACE_COLLECTOR_PRODUCTION_WORKER_NAME),
    workersDev: Schema.Literal(false),
  },
  Preview: {
    workersDev: Schema.Literal(true),
  },
});

/** Parsed deployment policy selected for the current Alchemy execution. */
export type TestTraceCollectorDeploymentTarget = typeof TestTraceCollectorDeploymentTarget.Type;

/** Selects the trace collector URL surface while protecting the production stage from local development. */
export const selectTestTraceCollectorDeploymentTarget = ({
  isDevelopmentMode,
  stage,
}: TestTraceCollectorAlchemyExecution): TestTraceCollectorDeploymentTarget => {
  if (isDevelopmentMode && stage === TEST_TRACE_COLLECTOR_PRODUCTION_STAGE) {
    throw new Error("Refusing to run test trace collector Alchemy development against production.");
  }

  if (isDevelopmentMode) {
    return TestTraceCollectorDeploymentTarget.cases.Local.make({ workersDev: true });
  }

  return stage === TEST_TRACE_COLLECTOR_PRODUCTION_STAGE
    ? TestTraceCollectorDeploymentTarget.cases.Production.make({
        domain: OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN,
        workerName: TEST_TRACE_COLLECTOR_PRODUCTION_WORKER_NAME,
        workersDev: false,
      })
    : TestTraceCollectorDeploymentTarget.cases.Preview.make({ workersDev: true });
};

/** Resolves the trace collector deployment target from the active Alchemy execution. */
export const resolveTestTraceCollectorDeploymentTarget = Effect.gen(function* () {
  const isDevelopmentMode = yield* ALCHEMY_DEV;
  const stack = yield* Stack;

  return selectTestTraceCollectorDeploymentTarget({
    isDevelopmentMode,
    stage: stack.stage,
  });
});
