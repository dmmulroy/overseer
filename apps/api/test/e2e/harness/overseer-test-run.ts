import { TestStage } from "../../../src/overseer-e2e-trace-identity.ts";
import { Config, Schema } from "effect";

/** Supported local-runtime and real Cloudflare execution targets. */
export const OverseerTestTarget = Schema.Literals(["local", "deployed"]);

/** Parsed execution target selected for one end-to-end test run. */
export type OverseerTestTarget = typeof OverseerTestTarget.Type;

/** Target and isolated Alchemy stage selected for one end-to-end test run. */
export const TestRun = Schema.Struct({
  target: OverseerTestTarget,
  stage: TestStage,
});

/** Parsed values that configure one isolated end-to-end test run. */
export interface TestRun extends Schema.Schema.Type<typeof TestRun> {}

/** Reads the required target and test-only stage without defaults. */
export const overseerTestRunConfig: Config.Config<TestRun> = Config.all({
  target: Config.schema(OverseerTestTarget, "OVERSEER_TEST_TARGET"),
  stage: Config.schema(TestStage, "OVERSEER_TEST_STAGE"),
}).pipe(Config.map((values) => TestRun.make(values)));
