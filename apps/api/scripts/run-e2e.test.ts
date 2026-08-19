import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { TestRun } from "../test/e2e/overseer-test-run.ts";
import { makeOverseerTestRun } from "./run-e2e.ts";

describe("Overseer end-to-end test runner", () => {
  it.effect("generates distinct schema-valid local stages", () =>
    Effect.gen(function* () {
      const first = yield* makeOverseerTestRun("local");
      const second = yield* makeOverseerTestRun("local");

      assert.doesNotThrow(() => Schema.decodeUnknownSync(TestRun)(first));
      assert.doesNotThrow(() => Schema.decodeUnknownSync(TestRun)(second));
      assert.strictEqual(first.target, "local");
      assert.notStrictEqual(first.stage, second.stage);
    }).pipe(Effect.provide(NodeCrypto.layer)),
  );

  it.effect("generates a schema-valid deployed run", () =>
    Effect.gen(function* () {
      const testRun = yield* makeOverseerTestRun("deployed");

      assert.doesNotThrow(() => Schema.decodeUnknownSync(TestRun)(testRun));
      assert.strictEqual(testRun.target, "deployed");
    }).pipe(Effect.provide(NodeCrypto.layer)),
  );
});
