import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Option } from "effect";
import { type ITestAssert, TestAssert, testAssertLayerWithoutDependencies } from "./test-assert.ts";
import { TestEvidenceRecorder, testEvidenceRecorderLayer } from "./test-evidence-recorder.ts";
import { TestExecutionId } from "./test-evidence-identity.ts";

class ExpectedError extends Error {}

const executionId = TestExecutionId.make("test-execution_assertions_0");
const assertionsLayer = () => {
  const recorderLayer = testEvidenceRecorderLayer({ testExecutionId: executionId });
  return Layer.mergeAll(
    recorderLayer,
    testAssertLayerWithoutDependencies.pipe(Layer.provide(recorderLayer)),
  );
};

describe("Test assertions", () => {
  it.effect("records passing synchronous assertions in execution order", () =>
    Effect.gen(function* () {
      const testAssert: ITestAssert = yield* TestAssert;
      const recorder = yield* TestEvidenceRecorder;
      const value: string | undefined = "value";

      testAssert.equal("strict values match", 1, 1);
      testAssert.notEqual("strict values differ", 1, 2);
      testAssert.deepEqual("structures match", { value: 1 }, { value: 1 });
      testAssert.notDeepEqual("structures differ", { value: 1 }, { value: 2 });
      testAssert.oneOf("value is allowed", "a", ["a", "b"]);
      testAssert.deepOneOf("structure is allowed", { value: 1 }, [{ value: 1 }]);
      testAssert.isTrue("boolean is true", true);
      testAssert.isFalse("boolean is false", false);
      testAssert.isDefined("value is defined", value);
      testAssert.isUndefined("value is undefined", undefined);
      testAssert.isNull("value is null", null);
      testAssert.instanceOf("error has expected class", new ExpectedError(), ExpectedError);
      testAssert.greaterThan("number is greater", 2, 1);
      testAssert.greaterThanOrEqual("number is at least", 2, 2);
      testAssert.lessThan("number is less", 1, 2);
      testAssert.lessThanOrEqual("number is at most", 2, 2);
      testAssert.closeTo("number is close", 1.01, 1, 0.02);
      testAssert.between("number is bounded", 2, 1, 3);
      testAssert.isFinite("number is finite", 1);
      testAssert.isNaN("number is NaN", Number.NaN);
      testAssert.match("text matches", "Workspace", /space/u);
      testAssert.notMatch("text does not match", "Workspace", /project/u);
      testAssert.containsText("text contains value", "Workspace", "space");
      testAssert.notContainsText("text excludes value", "Workspace", "Project");
      testAssert.startsWith("text starts with value", "Workspace", "Work");
      testAssert.endsWith("text ends with value", "Workspace", "space");
      testAssert.includes("array includes value", [1, 2], 2);
      testAssert.notIncludes("array excludes value", [1, 2], 3);
      testAssert.hasLength("array has length", [1, 2], 2);
      testAssert.hasSize("set has size", new Set([1, 2]), 2);
      testAssert.isEmpty("array is empty", []);
      testAssert.isNotEmpty("set is not empty", new Set([1]));
      testAssert.sameMembers("arrays have strict members", [1, 2, 1], [1, 1, 2]);
      testAssert.sameDeepMembers(
        "arrays have deep members",
        [{ value: 1 }, { value: 2 }],
        [{ value: 2 }, { value: 1 }],
      );
      testAssert.hasProperty("object owns property", { value: 1 }, "value");
      testAssert.notHasProperty("object excludes property", { value: 1 }, "other");
      testAssert.throws("operation throws", () => {
        throw new ExpectedError();
      });
      testAssert.throwsInstanceOf(
        "operation throws expected class",
        () => {
          throw new ExpectedError();
        },
        ExpectedError,
      );
      testAssert.doesNotThrow("operation completes", () => "completed");
      testAssert.satisfies(
        "domain predicate passes",
        2,
        "number is even",
        (actual) => actual % 2 === 0,
      );

      const snapshot = recorder.snapshot();
      assert.strictEqual(snapshot.assertions.length, 40);
      assert.strictEqual(snapshot.assertions[0]?.operation._tag, "Equal");
      assert.strictEqual(snapshot.assertions[39]?.operation._tag, "Satisfies");
      assert.ok(snapshot.assertions.every((record) => record.outcome._tag === "Passed"));
    }).pipe(Effect.provide(assertionsLayer())),
  );

  it.effect("records a failed assertion before rethrowing the original AssertionError", () =>
    Effect.gen(function* () {
      const testAssert: ITestAssert = yield* TestAssert;
      const recorder = yield* TestEvidenceRecorder;

      let thrown: Error | undefined;
      try {
        testAssert.equal("strict values should match", 1, 2);
      } catch (error) {
        if (error instanceof Error) thrown = error;
      }

      const record = recorder.snapshot().assertions[0];
      assert.strictEqual(thrown?.name, "AssertionError");
      assert.strictEqual(record?.outcome._tag, "Failed");
      assert.strictEqual(record?.description, "strict values should match");
    }).pipe(Effect.provide(assertionsLayer())),
  );

  it.effect("records an eventual typed failure before preserving it", () =>
    Effect.gen(function* () {
      const testAssert: ITestAssert = yield* TestAssert;
      const recorder = yield* TestEvidenceRecorder;
      const failure = new ExpectedError("observation failure");

      const exit = yield* Effect.exit(
        testAssert.eventuallyEqual(
          "Workspace observation remains available",
          Effect.fail(failure),
          "active",
          { timeout: Duration.seconds(1), interval: Duration.millis(10) },
        ),
      );

      assert.ok(Exit.isFailure(exit));
      assert.strictEqual(Option.getOrThrow(Cause.findErrorOption(exit.cause)), failure);
      const snapshot = recorder.snapshot();
      assert.strictEqual(snapshot.assertions.length, 1);
      assert.strictEqual(snapshot.assertions[0]?.outcome._tag, "Failed");
      assert.strictEqual(snapshot.assertions[0]?.operation._tag, "EventuallyEqual");
    }).pipe(Effect.provide(assertionsLayer())),
  );

  it.effect("records an eventual timeout with its last observation", () =>
    Effect.gen(function* () {
      const testAssert: ITestAssert = yield* TestAssert;
      const recorder = yield* TestEvidenceRecorder;

      const exit = yield* Effect.exit(
        testAssert.eventuallyEqual(
          "Workspace eventually becomes active",
          Effect.succeed("pending"),
          "active",
          { timeout: Duration.zero, interval: Duration.millis(10) },
        ),
      );

      assert.ok(Exit.isFailure(exit));
      const snapshot = recorder.snapshot();
      assert.strictEqual(snapshot.assertions.length, 1);
      assert.deepStrictEqual(snapshot.assertions[0]?.operation, {
        _tag: "EventuallyEqual",
        observation: { _tag: "Observed", value: "pending" },
        expected: "active",
        attempts: 1,
        timeoutMs: 0,
        intervalMs: 10,
      });
    }).pipe(Effect.provide(assertionsLayer())),
  );

  it.effect("records an eventual observed-Effect defect before preserving it", () =>
    Effect.gen(function* () {
      const testAssert: ITestAssert = yield* TestAssert;
      const recorder = yield* TestEvidenceRecorder;
      const defect = new ExpectedError("observation defect");

      const exit = yield* Effect.exit(
        testAssert.eventuallyEqual(
          "Workspace observation remains available",
          Effect.die(defect),
          "active",
          { timeout: Duration.seconds(1), interval: Duration.millis(10) },
        ),
      );

      assert.ok(Exit.isFailure(exit));
      assert.ok(Cause.hasDies(exit.cause));
      const record = recorder.snapshot().assertions[0];
      assert.strictEqual(record?.outcome._tag, "Failed");
      assert.deepStrictEqual(record?.operation, {
        _tag: "EventuallyEqual",
        observation: { _tag: "NotObserved" },
        expected: "active",
        attempts: 1,
        timeoutMs: 1_000,
        intervalMs: 10,
      });
    }).pipe(Effect.provide(assertionsLayer())),
  );

  it.effect("records a throwing eventual predicate with its last observation", () =>
    Effect.gen(function* () {
      const testAssert: ITestAssert = yield* TestAssert;
      const recorder = yield* TestEvidenceRecorder;

      const exit = yield* Effect.exit(
        testAssert.eventuallySatisfies(
          "Workspace observation satisfies its invariant",
          Effect.succeed({ state: "active" }),
          "Workspace state is legal",
          () => {
            throw new ExpectedError("predicate defect");
          },
          { timeout: Duration.seconds(1), interval: Duration.millis(10) },
        ),
      );

      assert.ok(Exit.isFailure(exit));
      assert.ok(Cause.hasDies(exit.cause));
      const record = recorder.snapshot().assertions[0];
      assert.strictEqual(record?.outcome._tag, "Failed");
      assert.deepStrictEqual(record?.operation, {
        _tag: "EventuallySatisfies",
        observation: { _tag: "Observed", value: { state: "active" } },
        expectation: "Workspace state is legal",
        attempts: 1,
        timeoutMs: 1_000,
        intervalMs: 10,
      });
    }).pipe(Effect.provide(assertionsLayer())),
  );

  it.effect("records interruption before an eventual observation completes", () =>
    Effect.gen(function* () {
      const testAssert: ITestAssert = yield* TestAssert;
      const recorder = yield* TestEvidenceRecorder;
      const observationStarted = yield* Deferred.make<void>();
      const actual = Deferred.succeed(observationStarted, undefined).pipe(
        Effect.andThen(Effect.never),
      );

      const fiber = yield* testAssert
        .eventuallyEqual("Workspace observation completes", actual, "active", {
          timeout: Duration.seconds(1),
          interval: Duration.millis(10),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(observationStarted);
      yield* Fiber.interrupt(fiber);

      const record = recorder.snapshot().assertions[0];
      assert.strictEqual(record?.outcome._tag, "Failed");
      assert.deepStrictEqual(record?.operation, {
        _tag: "EventuallyEqual",
        observation: { _tag: "NotObserved" },
        expected: "active",
        attempts: 1,
        timeoutMs: 1_000,
        intervalMs: 10,
      });
    }).pipe(Effect.provide(assertionsLayer())),
  );

  it.effect("records groups and one final eventual assertion", () =>
    Effect.gen(function* () {
      const testAssert: ITestAssert = yield* TestAssert;
      const recorder = yield* TestEvidenceRecorder;

      testAssert.group("Workspace identity", () => {
        testAssert.equal("identity is preserved", "workspace_1", "workspace_1");
      });
      yield* testAssert.eventuallyEqual(
        "Workspace eventually becomes active",
        Effect.succeed("active"),
        "active",
        { timeout: Duration.seconds(1), interval: Duration.millis(10) },
      );

      const snapshot = recorder.snapshot();
      assert.deepStrictEqual(snapshot.assertions[0]?.groupPath, ["Workspace identity"]);
      assert.strictEqual(snapshot.assertions[1]?.operation._tag, "EventuallyEqual");
    }).pipe(Effect.provide(assertionsLayer())),
  );
});
