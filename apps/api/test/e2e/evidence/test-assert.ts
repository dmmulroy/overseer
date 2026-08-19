import nodeAssert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Inspectable,
  Layer,
  Option,
  Schema,
} from "effect";
import type {
  TestAssertionObservation,
  TestAssertionOperation,
  TestAssertionRecord,
} from "./test-assertion.ts";
import { TestEvidenceRecorder, type TestAssertionReservation } from "./test-evidence-recorder.ts";
import { encodeTestEvidenceJson } from "./test-evidence-json.ts";

/** Numeric values accepted by ordering assertions. */
export type OrderedTestValue = number | bigint;

/** Explicit polling bounds for one eventual assertion. */
export interface EventuallyAssertionOptions {
  /** Maximum elapsed time before the final observation fails. */
  readonly timeout: Duration.Duration;
  /** Delay between completed observations. */
  readonly interval: Duration.Duration;
}

/** Typed failure returned when an eventual assertion exhausts its explicit bound. */
export class TestAssertionError extends Schema.TaggedError<TestAssertionError>()(
  "TestAssertionError",
  {
    description: Schema.NonEmptyString,
    expectation: Schema.NonEmptyString,
    message: Schema.String,
  },
) {}

/** Comprehensive fail-fast assertions that record every operation that executes. */
export interface ITestAssert {
  readonly equal: <A>(description: string, actual: A, expected: A) => void;
  readonly notEqual: <A>(description: string, actual: A, unexpected: A) => void;
  readonly deepEqual: <A>(description: string, actual: A, expected: A) => void;
  readonly notDeepEqual: <A>(description: string, actual: A, unexpected: A) => void;
  readonly oneOf: <A>(description: string, actual: A, expected: ReadonlyArray<A>) => void;
  readonly deepOneOf: <A>(description: string, actual: A, expected: ReadonlyArray<A>) => void;
  readonly isTrue: (description: string, actual: boolean) => void;
  readonly isFalse: (description: string, actual: boolean) => void;
  readonly isDefined: <A>(description: string, actual: A | null | undefined) => A;
  readonly isUndefined: <A>(description: string, actual: A) => void;
  readonly isNull: <A>(description: string, actual: A) => void;
  readonly instanceOf: <A, B>(
    description: string,
    actual: B,
    expected: abstract new (...args: never[]) => A,
  ) => B & A;
  readonly greaterThan: (
    description: string,
    actual: OrderedTestValue,
    expected: OrderedTestValue,
  ) => void;
  readonly greaterThanOrEqual: (
    description: string,
    actual: OrderedTestValue,
    expected: OrderedTestValue,
  ) => void;
  readonly lessThan: (
    description: string,
    actual: OrderedTestValue,
    expected: OrderedTestValue,
  ) => void;
  readonly lessThanOrEqual: (
    description: string,
    actual: OrderedTestValue,
    expected: OrderedTestValue,
  ) => void;
  readonly closeTo: (
    description: string,
    actual: number,
    expected: number,
    tolerance: number,
  ) => void;
  readonly between: (
    description: string,
    actual: OrderedTestValue,
    minimum: OrderedTestValue,
    maximum: OrderedTestValue,
  ) => void;
  readonly isFinite: (description: string, actual: number) => void;
  readonly isNaN: (description: string, actual: number) => void;
  readonly match: (description: string, actual: string, expected: RegExp) => void;
  readonly notMatch: (description: string, actual: string, unexpected: RegExp) => void;
  readonly containsText: (description: string, actual: string, expected: string) => void;
  readonly notContainsText: (description: string, actual: string, unexpected: string) => void;
  readonly startsWith: (description: string, actual: string, expected: string) => void;
  readonly endsWith: (description: string, actual: string, expected: string) => void;
  readonly includes: <A>(description: string, actual: ReadonlyArray<A>, expected: A) => void;
  readonly notIncludes: <A>(description: string, actual: ReadonlyArray<A>, unexpected: A) => void;
  readonly hasLength: (
    description: string,
    actual: { readonly length: number },
    expected: number,
  ) => void;
  readonly hasSize: (
    description: string,
    actual: { readonly size: number },
    expected: number,
  ) => void;
  readonly isEmpty: (
    description: string,
    actual: { readonly length: number } | { readonly size: number },
  ) => void;
  readonly isNotEmpty: (
    description: string,
    actual: { readonly length: number } | { readonly size: number },
  ) => void;
  readonly sameMembers: <A>(
    description: string,
    actual: ReadonlyArray<A>,
    expected: ReadonlyArray<A>,
  ) => void;
  readonly sameDeepMembers: <A>(
    description: string,
    actual: ReadonlyArray<A>,
    expected: ReadonlyArray<A>,
  ) => void;
  readonly hasProperty: <A extends object, K extends PropertyKey>(
    description: string,
    actual: A,
    expected: K,
  ) => A & { readonly [P in K]: unknown };
  readonly notHasProperty: <A extends object>(
    description: string,
    actual: A,
    unexpected: PropertyKey,
  ) => void;
  readonly throws: (description: string, operation: () => unknown) => unknown;
  readonly throwsInstanceOf: <A extends Error>(
    description: string,
    operation: () => unknown,
    expected: abstract new (...args: never[]) => A,
  ) => A;
  readonly doesNotThrow: <A>(description: string, operation: () => A) => A;
  readonly fail: <A>(description: string, actual: A) => never;
  readonly satisfies: <A>(
    description: string,
    actual: A,
    expectation: string,
    predicate: (actual: A) => boolean,
  ) => void;
  readonly eventuallyEqual: <A, E, R>(
    description: string,
    actual: Effect.Effect<A, E, R>,
    expected: A,
    options: EventuallyAssertionOptions,
  ) => Effect.Effect<void, E | TestAssertionError, R>;
  readonly eventuallyDeepEqual: <A, E, R>(
    description: string,
    actual: Effect.Effect<A, E, R>,
    expected: A,
    options: EventuallyAssertionOptions,
  ) => Effect.Effect<void, E | TestAssertionError, R>;
  readonly eventuallyMatch: <E, R>(
    description: string,
    actual: Effect.Effect<string, E, R>,
    expected: RegExp,
    options: EventuallyAssertionOptions,
  ) => Effect.Effect<void, E | TestAssertionError, R>;
  readonly eventuallySatisfies: <A, E, R>(
    description: string,
    actual: Effect.Effect<A, E, R>,
    expectation: string,
    predicate: (actual: A) => boolean,
    options: EventuallyAssertionOptions,
  ) => Effect.Effect<void, E | TestAssertionError, R>;
  readonly group: <A>(description: string, run: () => A) => A;
  readonly groupEffect: <A, E, R>(
    description: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly each: <A>(
    description: string,
    values: ReadonlyArray<A>,
    run: (value: A, index: number) => void,
  ) => void;
  readonly eachEffect: <A, E, R>(
    description: string,
    values: ReadonlyArray<A>,
    run: (value: A, index: number) => Effect.Effect<void, E, R>,
  ) => Effect.Effect<void, E, R>;
}

/** Provides the assertion capability backed by the current test evidence recorder. */
export class TestAssert extends Context.Service<TestAssert, ITestAssert>()(
  "@overseer/TestAssert",
) {}

const encodeAssertionValue = encodeTestEvidenceJson;

const CurrentTestAssertionGroupPath = Context.Reference<ReadonlyArray<string>>(
  "@overseer/CurrentTestAssertionGroupPath",
  { defaultValue: () => [] },
);

const recordedAssertionError = <A>(error: A) => {
  if (error instanceof Error) {
    return {
      name: error.name.length === 0 ? "Error" : error.name,
      message: error.message,
      stack: error.stack ?? `${error.name}: ${error.message}`,
    };
  }
  const message = Inspectable.toStringUnknown(error);
  return { name: "ThrownValue", message, stack: message };
};

const requireAssertionDescription = (description: string): void => {
  if (description.trim().length === 0) {
    throw new TypeError("Test assertion description must be nonempty");
  }
};

const collectionSize = (actual: { readonly length: number } | { readonly size: number }): number =>
  "length" in actual ? actual.length : actual.size;

function assertOwnProperty<A extends object, K extends PropertyKey>(
  actual: A,
  expected: K,
  description: string,
): asserts actual is A & { readonly [P in K]: unknown } {
  nodeAssert.ok(Object.hasOwn(actual, expected), description);
}

const hasSameMembers = <A>(
  actual: ReadonlyArray<A>,
  expected: ReadonlyArray<A>,
  equivalent: (left: A, right: A) => boolean,
): boolean => {
  if (actual.length !== expected.length) return false;
  const matched = new Set<number>();
  return actual.every((actualValue) => {
    const index = expected.findIndex(
      (expectedValue, expectedIndex) =>
        !matched.has(expectedIndex) && equivalent(actualValue, expectedValue),
    );
    if (index < 0) return false;
    matched.add(index);
    return true;
  });
};

type EventualOperationConfig =
  | { readonly _tag: "EventuallyEqual"; readonly expected: Schema.Json }
  | { readonly _tag: "EventuallyDeepEqual"; readonly expected: Schema.Json }
  | {
      readonly _tag: "EventuallyMatch";
      readonly expected: { readonly source: string; readonly flags: string };
    }
  | { readonly _tag: "EventuallySatisfies"; readonly expectation: string };

const makeEventualAssertionOperation = (
  config: EventualOperationConfig,
  observation: TestAssertionObservation,
  attempts: number,
  timeoutMs: number,
  intervalMs: number,
  elapsedMs: number,
): TestAssertionOperation => {
  switch (config._tag) {
    case "EventuallyEqual":
      return { ...config, observation, attempts, timeoutMs, intervalMs, elapsedMs };
    case "EventuallyDeepEqual":
      return { ...config, observation, attempts, timeoutMs, intervalMs, elapsedMs };
    case "EventuallyMatch":
      return { ...config, observation, attempts, timeoutMs, intervalMs, elapsedMs };
    case "EventuallySatisfies":
      return { ...config, observation, attempts, timeoutMs, intervalMs, elapsedMs };
  }
};

const eventualAssertionErrorFromCause = <E>(cause: Cause.Cause<E>): Error => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error : new Error(Inspectable.toStringUnknown(error));
};

/** Constructs assertions while preserving the current recorder requirement. */
export const makeTestAssert = Effect.gen(function* () {
  const recorder = yield* TestEvidenceRecorder;
  const synchronousGroupPath: Array<string> = [];

  const currentGroupPath = (): ReadonlyArray<string> => {
    const fiber = Fiber.getCurrent();
    const effectGroupPath = fiber === undefined ? [] : fiber.getRef(CurrentTestAssertionGroupPath);
    return [...effectGroupPath, ...synchronousGroupPath];
  };

  const appendOutcome = (
    reservation: TestAssertionReservation,
    description: string,
    operation: TestAssertionOperation,
    error: Error | undefined,
  ): void => {
    const common = {
      id: reservation.id,
      testExecutionId: reservation.testExecutionId,
      sequence: reservation.sequence,
      groupPath: reservation.groupPath,
      description,
      startedAt: reservation.startedAt,
      durationMs: Math.max(0, Date.now() - reservation.startedAtMillis),
      operation,
    };
    const assertion: TestAssertionRecord =
      error === undefined
        ? { ...common, outcome: { _tag: "Passed" } }
        : {
            ...common,
            outcome: { _tag: "Failed", error: recordedAssertionError(error) },
          };
    recorder.appendAssertion(assertion);
  };

  const runAssertion = <A>(
    description: string,
    operation: () => TestAssertionOperation,
    comparison: () => A,
  ): A => {
    requireAssertionDescription(description);
    const reservation = recorder.reserveAssertion(currentGroupPath());
    try {
      const result = comparison();
      appendOutcome(reservation, description, operation(), undefined);
      return result;
    } catch (error) {
      const assertionError =
        error instanceof Error ? error : new Error(Inspectable.toStringUnknown(error));
      appendOutcome(reservation, description, operation(), assertionError);
      throw error;
    }
  };

  const eventual = <A, E, R>(input: {
    readonly description: string;
    readonly actual: Effect.Effect<A, E, R>;
    readonly expectation: string;
    readonly options: EventuallyAssertionOptions;
    readonly matches: (actual: A) => boolean;
    readonly operation: EventualOperationConfig;
  }): Effect.Effect<void, E | TestAssertionError, R> =>
    Effect.suspend(() => {
      requireAssertionDescription(input.description);
      requireAssertionDescription(input.expectation);
      const reservation = recorder.reserveAssertion(currentGroupPath());
      const timeoutMs = Math.max(0, Math.floor(Duration.toMillis(input.options.timeout)));
      const intervalMs = Math.max(0, Math.floor(Duration.toMillis(input.options.interval)));
      let attempts = 0;
      let lastObservation = Option.none<A>();
      let recorded = false;

      const observation = (): TestAssertionObservation =>
        Option.match(lastObservation, {
          onNone: () => ({ _tag: "NotObserved" }),
          onSome: (actual) => ({ _tag: "Observed", value: encodeAssertionValue(actual) }),
        });
      const complete = (error: Error | undefined, elapsedMs: number): void => {
        if (recorded) return;
        appendOutcome(
          reservation,
          input.description,
          makeEventualAssertionOperation(
            input.operation,
            observation(),
            attempts,
            timeoutMs,
            intervalMs,
            elapsedMs,
          ),
          error,
        );
        recorded = true;
      };

      let startedAtMillis = Option.none<number>();
      const poll = Effect.gen(function* () {
        const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
        startedAtMillis = Option.some(startedAt);
        yield* Effect.gen(function* () {
          attempts += 1;
          const actual = yield* input.actual;
          lastObservation = Option.some(actual);
          const matches = yield* Effect.sync(() => input.matches(actual));
          if (matches) return true;

          const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
          if (now - startedAt >= timeoutMs) {
            return yield* Effect.fail(
              new TestAssertionError({
                description: input.description,
                expectation: input.expectation,
                message: `Eventually assertion timed out: ${input.description}`,
              }),
            );
          }
          yield* Effect.sleep(input.options.interval);
          return false;
        }).pipe(Effect.repeat({ until: (matches) => matches }));
      });

      return poll.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const finishedAtMillis = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            complete(
              Exit.isFailure(exit) ? eventualAssertionErrorFromCause(exit.cause) : undefined,
              Option.match(startedAtMillis, {
                onNone: () => 0,
                onSome: (startedAt) => Math.max(0, finishedAtMillis - startedAt),
              }),
            );
          }),
        ),
      );
    });

  const group = <A>(description: string, run: () => A): A => {
    requireAssertionDescription(description);
    synchronousGroupPath.push(description);
    try {
      return run();
    } finally {
      synchronousGroupPath.pop();
    }
  };

  const groupEffect = <A, E, R>(
    description: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> => {
    requireAssertionDescription(description);
    return Effect.gen(function* () {
      const parentGroupPath = yield* CurrentTestAssertionGroupPath;
      return yield* effect.pipe(
        Effect.provideService(CurrentTestAssertionGroupPath, [...parentGroupPath, description]),
      );
    });
  };

  const satisfies = <A>(
    description: string,
    actual: A,
    expectation: string,
    predicate: (actual: A) => boolean,
  ): void => {
    requireAssertionDescription(expectation);
    return runAssertion(
      description,
      () => ({ _tag: "Satisfies", actual: encodeAssertionValue(actual), expectation }),
      () => nodeAssert.ok(predicate(actual), description),
    );
  };

  const doesNotThrow = <A>(description: string, operation: () => A): A => {
    let result = Option.none<A>();
    let completion: TestAssertionObservation = { _tag: "NotObserved" };
    return runAssertion(
      description,
      () => ({ _tag: "DoesNotThrow", completion }),
      () => {
        nodeAssert.doesNotThrow(() => {
          const value = operation();
          result = Option.some(value);
          completion = { _tag: "Observed", value: encodeAssertionValue(value) };
        }, description);
        return Option.getOrThrow(result);
      },
    );
  };

  return TestAssert.of({
    equal: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "Equal",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () => nodeAssert.strictEqual(actual, expected, description),
      ),
    notEqual: (description, actual, unexpected) =>
      runAssertion(
        description,
        () => ({
          _tag: "NotEqual",
          actual: encodeAssertionValue(actual),
          unexpected: encodeAssertionValue(unexpected),
        }),
        () => nodeAssert.notStrictEqual(actual, unexpected, description),
      ),
    deepEqual: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "DeepEqual",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () => nodeAssert.deepStrictEqual(actual, expected, description),
      ),
    notDeepEqual: (description, actual, unexpected) =>
      runAssertion(
        description,
        () => ({
          _tag: "NotDeepEqual",
          actual: encodeAssertionValue(actual),
          unexpected: encodeAssertionValue(unexpected),
        }),
        () => nodeAssert.notDeepStrictEqual(actual, unexpected, description),
      ),
    oneOf: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "OneOf",
          actual: encodeAssertionValue(actual),
          expected: expected.map(encodeAssertionValue),
        }),
        () =>
          nodeAssert.ok(
            expected.some((value) => Object.is(value, actual)),
            description,
          ),
      ),
    deepOneOf: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "DeepOneOf",
          actual: encodeAssertionValue(actual),
          expected: expected.map(encodeAssertionValue),
        }),
        () =>
          nodeAssert.ok(
            expected.some((value) => isDeepStrictEqual(value, actual)),
            description,
          ),
      ),
    isTrue: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsTrue", actual }),
        () => nodeAssert.strictEqual(actual, true, description),
      ),
    isFalse: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsFalse", actual }),
        () => nodeAssert.strictEqual(actual, false, description),
      ),
    isDefined: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsDefined", actual: encodeAssertionValue(actual) }),
        () => {
          nodeAssert.ok(actual !== null && actual !== undefined, description);
          return actual;
        },
      ),
    isUndefined: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsUndefined", actual: encodeAssertionValue(actual) }),
        () => nodeAssert.strictEqual(actual, undefined, description),
      ),
    isNull: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsNull", actual: encodeAssertionValue(actual) }),
        () => nodeAssert.strictEqual(actual, null, description),
      ),
    instanceOf: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "InstanceOf",
          actual: encodeAssertionValue(actual),
          expectedClass: expected.name,
        }),
        () => {
          nodeAssert.ok(actual instanceof expected, description);
          return actual;
        },
      ),
    greaterThan: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "GreaterThan",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () => nodeAssert.ok(actual > expected, description),
      ),
    greaterThanOrEqual: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "GreaterThanOrEqual",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () => nodeAssert.ok(actual >= expected, description),
      ),
    lessThan: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "LessThan",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () => nodeAssert.ok(actual < expected, description),
      ),
    lessThanOrEqual: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "LessThanOrEqual",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () => nodeAssert.ok(actual <= expected, description),
      ),
    closeTo: (description, actual, expected, tolerance) =>
      runAssertion(
        description,
        () => ({ _tag: "CloseTo", actual, expected, tolerance }),
        () => nodeAssert.ok(Math.abs(actual - expected) <= tolerance, description),
      ),
    between: (description, actual, minimum, maximum) =>
      runAssertion(
        description,
        () => ({
          _tag: "Between",
          actual: encodeAssertionValue(actual),
          minimum: encodeAssertionValue(minimum),
          maximum: encodeAssertionValue(maximum),
        }),
        () => nodeAssert.ok(actual >= minimum && actual <= maximum, description),
      ),
    isFinite: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsFinite", actual: encodeAssertionValue(actual) }),
        () => nodeAssert.ok(Number.isFinite(actual), description),
      ),
    isNaN: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsNaN", actual: encodeAssertionValue(actual) }),
        () => nodeAssert.ok(Number.isNaN(actual), description),
      ),
    match: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "Match",
          actual,
          expected: { source: expected.source, flags: expected.flags },
        }),
        () => nodeAssert.match(actual, expected, description),
      ),
    notMatch: (description, actual, unexpected) =>
      runAssertion(
        description,
        () => ({
          _tag: "NotMatch",
          actual,
          unexpected: { source: unexpected.source, flags: unexpected.flags },
        }),
        () => nodeAssert.doesNotMatch(actual, unexpected, description),
      ),
    containsText: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({ _tag: "ContainsText", actual, expected }),
        () => nodeAssert.ok(actual.includes(expected), description),
      ),
    notContainsText: (description, actual, unexpected) =>
      runAssertion(
        description,
        () => ({ _tag: "NotContainsText", actual, unexpected }),
        () => nodeAssert.ok(!actual.includes(unexpected), description),
      ),
    startsWith: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({ _tag: "StartsWith", actual, expected }),
        () => nodeAssert.ok(actual.startsWith(expected), description),
      ),
    endsWith: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({ _tag: "EndsWith", actual, expected }),
        () => nodeAssert.ok(actual.endsWith(expected), description),
      ),
    includes: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "Includes",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () =>
          nodeAssert.ok(
            actual.some((value) => Object.is(value, expected)),
            description,
          ),
      ),
    notIncludes: (description, actual, unexpected) =>
      runAssertion(
        description,
        () => ({
          _tag: "NotIncludes",
          actual: encodeAssertionValue(actual),
          unexpected: encodeAssertionValue(unexpected),
        }),
        () => nodeAssert.ok(!actual.some((value) => Object.is(value, unexpected)), description),
      ),
    hasLength: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({ _tag: "HasLength", actualLength: actual.length, expectedLength: expected }),
        () => nodeAssert.strictEqual(actual.length, expected, description),
      ),
    hasSize: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({ _tag: "HasSize", actualSize: actual.size, expectedSize: expected }),
        () => nodeAssert.strictEqual(actual.size, expected, description),
      ),
    isEmpty: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsEmpty", actualSize: collectionSize(actual) }),
        () => nodeAssert.strictEqual(collectionSize(actual), 0, description),
      ),
    isNotEmpty: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "IsNotEmpty", actualSize: collectionSize(actual) }),
        () => nodeAssert.notStrictEqual(collectionSize(actual), 0, description),
      ),
    sameMembers: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "SameMembers",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () => nodeAssert.ok(hasSameMembers(actual, expected, Object.is), description),
      ),
    sameDeepMembers: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "SameDeepMembers",
          actual: encodeAssertionValue(actual),
          expected: encodeAssertionValue(expected),
        }),
        () => nodeAssert.ok(hasSameMembers(actual, expected, isDeepStrictEqual), description),
      ),
    hasProperty: (description, actual, expected) =>
      runAssertion(
        description,
        () => ({
          _tag: "HasProperty",
          actual: encodeAssertionValue(actual),
          expectedProperty: encodeAssertionValue(expected),
        }),
        () => {
          assertOwnProperty(actual, expected, description);
          return actual;
        },
      ),
    notHasProperty: (description, actual, unexpected) =>
      runAssertion(
        description,
        () => ({
          _tag: "NotHasProperty",
          actual: encodeAssertionValue(actual),
          unexpectedProperty: encodeAssertionValue(unexpected),
        }),
        () => nodeAssert.ok(!Object.hasOwn(actual, unexpected), description),
      ),
    throws: (description, operation) => {
      let completed = true;
      let getActualError: () => unknown = () => "operation completed without throwing";
      return runAssertion(
        description,
        () => ({ _tag: "Throws", actualError: encodeAssertionValue(getActualError()) }),
        () => {
          try {
            operation();
          } catch (error) {
            completed = false;
            getActualError = () => error;
          }
          nodeAssert.ok(!completed, description);
          return getActualError();
        },
      );
    },
    throwsInstanceOf: (description, operation, expected) => {
      let getActualError: () => unknown = () => "operation completed without throwing";
      return runAssertion(
        description,
        () => ({
          _tag: "ThrowsInstanceOf",
          actualError: encodeAssertionValue(getActualError()),
          expectedClass: expected.name,
        }),
        () => {
          try {
            operation();
          } catch (error) {
            getActualError = () => error;
          }
          const actualError = getActualError();
          nodeAssert.ok(actualError instanceof expected, description);
          return actualError;
        },
      );
    },
    doesNotThrow,
    fail: (description, actual) =>
      runAssertion(
        description,
        () => ({ _tag: "Fail", actual: encodeAssertionValue(actual) }),
        () => nodeAssert.fail(description),
      ),
    satisfies,
    eventuallyEqual: (description, actual, expected, options) =>
      eventual({
        description,
        actual,
        expectation: Inspectable.toStringUnknown(expected),
        options,
        matches: (value) => Object.is(value, expected),
        operation: { _tag: "EventuallyEqual", expected: encodeAssertionValue(expected) },
      }),
    eventuallyDeepEqual: (description, actual, expected, options) =>
      eventual({
        description,
        actual,
        expectation: Inspectable.toStringUnknown(expected),
        options,
        matches: (value) => isDeepStrictEqual(value, expected),
        operation: { _tag: "EventuallyDeepEqual", expected: encodeAssertionValue(expected) },
      }),
    eventuallyMatch: (description, actual, expected, options) =>
      eventual({
        description,
        actual,
        expectation: expected.toString(),
        options,
        matches: (value) => new RegExp(expected.source, expected.flags).test(value),
        operation: {
          _tag: "EventuallyMatch",
          expected: { source: expected.source, flags: expected.flags },
        },
      }),
    eventuallySatisfies: (description, actual, expectation, predicate, options) =>
      eventual({
        description,
        actual,
        expectation,
        options,
        matches: predicate,
        operation: { _tag: "EventuallySatisfies", expectation },
      }),
    group,
    groupEffect,
    each: (description, values, run) =>
      group(description, () =>
        values.forEach((value, index) => group(String(index), () => run(value, index))),
      ),
    eachEffect: (description, values, run) =>
      groupEffect(
        description,
        Effect.forEach(values, (value, index) => groupEffect(String(index), run(value, index)), {
          discard: true,
        }),
      ),
  });
});

/** Provides assertions while leaving the fresh recorder requirement visible. */
export const testAssertLayerWithoutDependencies = Layer.effect(TestAssert, makeTestAssert);
