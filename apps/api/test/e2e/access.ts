import { Effect } from "effect";
import type { ITestAssert } from "./evidence/test-assert.ts";
import type { OverseerTestHarness } from "./overseer-test-harness.ts";

/** Registers the API identity guarantee shared by local and deployed targets. */
export const registerAccessTestSuite = (harness: OverseerTestHarness): void => {
  harness.test(
    "the Overseer API returns its identity",
    (context) =>
      Effect.gen(function* () {
        const assert: ITestAssert = context.assert;
        const identity = yield* context.client.overseer.getApiIdentity({});

        assert.equal("the public API identifies itself as Overseer API", identity, "Overseer API");
      }),
    { timeout: 120_000 },
  );
};
