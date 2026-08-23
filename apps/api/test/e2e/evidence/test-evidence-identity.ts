import { Schema } from "effect";

/** Deterministic identity of one test registered within a test run. */
export const TestId = Schema.String.check(Schema.isPattern(/^test_[A-Za-z0-9_-]+$/)).pipe(
  Schema.brand("TestId"),
);

/** Identity shared by every execution attempt of one registered test. */
export type TestId = typeof TestId.Type;

/** Deterministic identity of one attempt to execute a registered test. */
export const TestExecutionId = Schema.String.check(
  Schema.isPattern(/^test-execution_[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("TestExecutionId"));

/** Identity shared by one test execution and all evidence recorded for it. */
export type TestExecutionId = typeof TestExecutionId.Type;

/** Deterministic assertion identity derived from a test execution and sequence number. */
export const TestAssertionId = Schema.String.check(
  Schema.isPattern(/^assertion_[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("TestAssertionId"));

/** Deterministic identity of one recorded test assertion. */
export type TestAssertionId = typeof TestAssertionId.Type;

/** Deterministic artifact identity derived from a test execution and sequence number. */
export const TestArtifactId = Schema.String.check(
  Schema.isPattern(/^artifact_[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("TestArtifactId"));

/** Identity shared by artifact metadata and stored content. */
export type TestArtifactId = typeof TestArtifactId.Type;
