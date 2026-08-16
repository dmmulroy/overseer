import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { makeOverseerTestRun } from "./run-e2e.ts";
import { TestRun } from "../test/e2e/overseer-test-run.ts";

describe("Overseer end-to-end test runner", () => {
  it("generates distinct schema-valid local stages", () => {
    const first = makeOverseerTestRun("local");
    const second = makeOverseerTestRun("local");

    assert.doesNotThrow(() => Schema.decodeUnknownSync(TestRun)(first));
    assert.doesNotThrow(() => Schema.decodeUnknownSync(TestRun)(second));
    assert.strictEqual(first.target, "local");
    assert.notStrictEqual(first.stage, second.stage);
  });

  it("generates a schema-valid deployed run", () => {
    const testRun = makeOverseerTestRun("deployed");

    assert.doesNotThrow(() => Schema.decodeUnknownSync(TestRun)(testRun));
    assert.strictEqual(testRun.target, "deployed");
  });
});
