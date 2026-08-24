import { Effect } from "effect";
import type { OverseerTestHarness } from "../harness/overseer-test-harness.ts";

/** Registers the API identity guarantee shared by local and deployed targets. */
export const registerAccessTestSuite = (harness: OverseerTestHarness): void => {
  harness.test(
    "the Overseer API returns its identity",
    ({ assert, client }) =>
      Effect.gen(function* () {
        const identity = yield* client.overseer.getApiIdentity({});

        assert.equal("the public API identifies itself as Overseer API", identity, "Overseer API");
      }),
    { timeout: 120_000 },
  );
};
