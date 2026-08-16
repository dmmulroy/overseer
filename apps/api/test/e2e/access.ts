import { assert } from "@effect/vitest";
import { Effect } from "effect";
import { OverseerApiClient } from "./overseer-api-client.ts";
import type { OverseerTestHarness } from "./overseer-test-harness.ts";

const verifyOverseerApiIdentity = Effect.gen(function* () {
  const client = yield* OverseerApiClient;
  const identity = yield* client.overseer.getApiIdentity({});

  assert.strictEqual(identity, "Overseer API");
});

/** Registers the API identity guarantee shared by local and deployed targets. */
export const registerAccessTestSuite = (harness: OverseerTestHarness): void => {
  harness.test("the Overseer API returns its identity", verifyOverseerApiIdentity, {
    timeout: 120_000,
  });
};
