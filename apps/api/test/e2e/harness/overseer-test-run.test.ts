import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { overseerTestRunConfig } from "./overseer-test-run.ts";

describe("Overseer test run configuration", () => {
  it("parses one isolated local test run from environment-backed values", () => {
    const provider = ConfigProvider.fromUnknown({
      OVERSEER_TEST_TARGET: "local",
      OVERSEER_TEST_STAGE: "test-dmmulroy-01kzgwmq4054axzgw9rr1vj3jm",
    });

    const testRun = Effect.runSync(overseerTestRunConfig.parse(provider));

    assert.deepStrictEqual(testRun, {
      target: "local",
      stage: "test-dmmulroy-01kzgwmq4054axzgw9rr1vj3jm",
    });
  });

  it("rejects a production stage before deployment", () => {
    const provider = ConfigProvider.fromUnknown({
      OVERSEER_TEST_TARGET: "deployed",
      OVERSEER_TEST_STAGE: "production",
    });

    const result = Effect.runSync(Effect.result(overseerTestRunConfig.parse(provider)));

    assert.strictEqual(result._tag, "Failure");
  });
});
