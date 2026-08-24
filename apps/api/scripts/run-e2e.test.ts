import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { TestRun } from "../test/e2e/harness/overseer-test-run.ts";
import { makeOverseerEvidenceDirectory, makeOverseerTestRun } from "./run-e2e.ts";

describe("Overseer end-to-end test runner", () => {
  it("selects an absolute evidence directory from the runner working directory", () => {
    assert.strictEqual(
      makeOverseerEvidenceDirectory("/repo/apps/api"),
      "/repo/apps/api/.overseer/evidence",
    );
  });

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
