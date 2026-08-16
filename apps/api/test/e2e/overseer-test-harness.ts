import * as Cloudflare from "alchemy/Cloudflare";
import type { CompiledStack } from "alchemy/Stack";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Layer } from "effect";
import { overseerApiClientLayer, OverseerApiClient } from "./overseer-api-client.ts";
import {
  parseOverseerApiDeployment,
  waitForOverseerApiDeployment,
} from "./overseer-api-deployment.ts";
import { overseerTestRunConfig } from "./overseer-test-run.ts";

/** Timeout options passed to one registered end-to-end test. */
export interface OverseerTestOptions {
  /** Maximum live-runtime execution time in milliseconds. */
  readonly timeout: number;
}

type OverseerStack = Test.TestEffect<CompiledStack<unknown>, never>;

/** Registration-time harness that shares one local or deployed Stack across feature test suites. */
export class OverseerTestHarness {
  private constructor(
    private readonly registerTest: (
      name: string,
      effect: Effect.Effect<void, unknown, OverseerApiClient>,
      options?: OverseerTestOptions,
    ) => void,
  ) {}

  /** Registers one deterministic product guarantee against the selected target. */
  readonly test = <E>(
    name: string,
    effect: Effect.Effect<void, E, OverseerApiClient>,
    options?: OverseerTestOptions,
  ): void => {
    this.registerTest(name, effect, options);
  };

  /** Configures Alchemy deployment, readiness, and teardown for one Stack. */
  static fromStack(stack: OverseerStack): OverseerTestHarness {
    const testRun = Effect.runSync(overseerTestRunConfig);
    const alchemyTest = Test.make({
      providers: Cloudflare.providers(),
      state: Cloudflare.state(),
      stage: testRun.stage,
      dev: testRun.target === "local",
    });
    const deployment = alchemyTest.beforeAll(
      alchemyTest.deploy(stack).pipe(
        Effect.flatMap((output) =>
          testRun.target === "local"
            ? parseOverseerApiDeployment("local")(output)
            : parseOverseerApiDeployment("deployed")(output),
        ),
        Effect.tap(waitForOverseerApiDeployment),
      ),
      { timeout: 600_000 },
    );
    // The outer runner destroys local state after Vitest closes Alchemy's dev sidecar.
    alchemyTest.afterAll.skipIf(testRun.target === "local")(alchemyTest.destroy(stack), {
      timeout: 300_000,
    });

    const apiClientLayer = Layer.unwrap(deployment.pipe(Effect.map(overseerApiClientLayer)));

    return new OverseerTestHarness((name, effect, options) => {
      alchemyTest.test(name, effect.pipe(Effect.provide(apiClientLayer)), options);
    });
  }
}
