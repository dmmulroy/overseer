import { Schema } from "effect";
import { TestAssertionId, TestExecutionId } from "./test-evidence-identity.ts";

/** Diagnostic details retained when a test assertion fails. */
export const RecordedAssertionError = Schema.Struct({
  name: Schema.NonEmptyString,
  message: Schema.String,
  stack: Schema.String,
});

/** Serialized assertion failure details suitable for persisted test evidence. */
export interface RecordedAssertionError extends Schema.Schema.Type<typeof RecordedAssertionError> {}

const RegexExpectation = Schema.Struct({ source: Schema.String, flags: Schema.String });

/** Final value observed by an eventual assertion, or proof that no value completed. */
export const TestAssertionObservation = Schema.TaggedUnion({
  Observed: { value: Schema.Json },
  NotObserved: {},
});

/** Persistable final observation made by an eventual assertion. */
export type TestAssertionObservation = typeof TestAssertionObservation.Type;

const BinaryExpected = { actual: Schema.Json, expected: Schema.Json };
const BinaryUnexpected = { actual: Schema.Json, unexpected: Schema.Json };

/** Operation-specific diagnostic values for every supported test assertion. */
export const TestAssertionOperation = Schema.TaggedUnion({
  Equal: BinaryExpected,
  NotEqual: BinaryUnexpected,
  DeepEqual: BinaryExpected,
  NotDeepEqual: BinaryUnexpected,
  OneOf: { actual: Schema.Json, expected: Schema.Array(Schema.Json) },
  DeepOneOf: { actual: Schema.Json, expected: Schema.Array(Schema.Json) },
  IsTrue: { actual: Schema.Boolean },
  IsFalse: { actual: Schema.Boolean },
  IsDefined: { actual: Schema.Json },
  IsUndefined: { actual: Schema.Json },
  IsNull: { actual: Schema.Json },
  InstanceOf: { actual: Schema.Json, expectedClass: Schema.String },
  GreaterThan: BinaryExpected,
  GreaterThanOrEqual: BinaryExpected,
  LessThan: BinaryExpected,
  LessThanOrEqual: BinaryExpected,
  CloseTo: { actual: Schema.Number, expected: Schema.Number, tolerance: Schema.Number },
  Between: { actual: Schema.Json, minimum: Schema.Json, maximum: Schema.Json },
  IsFinite: { actual: Schema.Json },
  IsNaN: { actual: Schema.Json },
  Match: { actual: Schema.String, expected: RegexExpectation },
  NotMatch: { actual: Schema.String, unexpected: RegexExpectation },
  ContainsText: { actual: Schema.String, expected: Schema.String },
  NotContainsText: { actual: Schema.String, unexpected: Schema.String },
  StartsWith: { actual: Schema.String, expected: Schema.String },
  EndsWith: { actual: Schema.String, expected: Schema.String },
  Includes: BinaryExpected,
  NotIncludes: BinaryUnexpected,
  HasLength: { actualLength: Schema.Natural, expectedLength: Schema.Natural },
  HasSize: { actualSize: Schema.Natural, expectedSize: Schema.Natural },
  IsEmpty: { actualSize: Schema.Natural },
  IsNotEmpty: { actualSize: Schema.Natural },
  SameMembers: BinaryExpected,
  SameDeepMembers: BinaryExpected,
  HasProperty: { actual: Schema.Json, expectedProperty: Schema.Json },
  NotHasProperty: { actual: Schema.Json, unexpectedProperty: Schema.Json },
  Throws: { actualError: Schema.Json },
  ThrowsInstanceOf: { actualError: Schema.Json, expectedClass: Schema.String },
  DoesNotThrow: { completion: TestAssertionObservation },
  Fail: { actual: Schema.Json },
  Satisfies: { actual: Schema.Json, expectation: Schema.NonEmptyString },
  EventuallyEqual: {
    observation: TestAssertionObservation,
    expected: Schema.Json,
    attempts: Schema.Natural,
    timeoutMs: Schema.Natural,
    intervalMs: Schema.Natural,
    elapsedMs: Schema.Natural,
  },
  EventuallyDeepEqual: {
    observation: TestAssertionObservation,
    expected: Schema.Json,
    attempts: Schema.Natural,
    timeoutMs: Schema.Natural,
    intervalMs: Schema.Natural,
    elapsedMs: Schema.Natural,
  },
  EventuallyMatch: {
    observation: TestAssertionObservation,
    expected: RegexExpectation,
    attempts: Schema.Natural,
    timeoutMs: Schema.Natural,
    intervalMs: Schema.Natural,
    elapsedMs: Schema.Natural,
  },
  EventuallySatisfies: {
    observation: TestAssertionObservation,
    expectation: Schema.NonEmptyString,
    attempts: Schema.Natural,
    timeoutMs: Schema.Natural,
    intervalMs: Schema.Natural,
    elapsedMs: Schema.Natural,
  },
});

/** Operation-specific values recorded for an executed test assertion. */
export type TestAssertionOperation = typeof TestAssertionOperation.Type;

/** Pass or failure result recorded before assertion execution returns or throws. */
export const TestAssertionOutcome = Schema.TaggedUnion({
  Passed: {},
  Failed: {
    error: RecordedAssertionError,
  },
});

/** Completed outcome of one executed test assertion. */
export type TestAssertionOutcome = typeof TestAssertionOutcome.Type;

/** Complete evidence envelope for one assertion that actually executed. */
export const TestAssertionRecord = Schema.Struct({
  id: TestAssertionId,
  testExecutionId: TestExecutionId,
  sequence: Schema.Natural,
  groupPath: Schema.Array(Schema.NonEmptyString),
  description: Schema.NonEmptyString,
  startedAt: Schema.DateTimeUtcFromString,
  durationMs: Schema.Natural,
  operation: TestAssertionOperation,
  outcome: TestAssertionOutcome,
});

/** Persistable evidence for one assertion that actually executed. */
export interface TestAssertionRecord extends Schema.Schema.Type<typeof TestAssertionRecord> {}
