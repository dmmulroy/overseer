import { Context, Effect, Layer } from "effect";
import type { OtlpTracer } from "effect/unstable/observability";
import { SqlClient } from "effect/unstable/sql";
import type { TestTraceId } from "../test-trace-identity.ts";

/** Persistence operations owned by one test-run trace Durable Object. */
export interface ITestRunTraceDatabase {
  /** Persist one parsed OTLP trace export for the owning test run. */
  readonly ingestOtlpTraces: (traceData: OtlpTracer.TraceData) => Effect.Effect<void>;
  /** Return the immutable OTLP trace data retained for one trace identity. */
  readonly getTestTrace: (traceId: TestTraceId) => Effect.Effect<OtlpTracer.TraceData>;
}

/** Provides test-run trace persistence without exposing Durable Object storage. */
export class TestRunTraceDatabase extends Context.Service<
  TestRunTraceDatabase,
  ITestRunTraceDatabase
>()("@overseer/TestRunTraceDatabase") {}

/**
 * Constructs the stub test-run trace database at runtime.
 *
 * @throws Every operation defects until trace persistence is implemented.
 */
export const makeTestRunTraceDatabase: Effect.Effect<
  TestRunTraceDatabase["Service"],
  never,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  yield* SqlClient.SqlClient;

  return TestRunTraceDatabase.of({
    ingestOtlpTraces: () =>
      Effect.die(new Error("TestRunTraceDatabase.ingestOtlpTraces is not implemented")),
    getTestTrace: () =>
      Effect.die(new Error("TestRunTraceDatabase.getTestTrace is not implemented")),
  });
});

/** Provides the stub test-run trace database while preserving its SQL requirement. */
export const testRunTraceDatabaseLayerWithoutDependencies = Layer.effect(
  TestRunTraceDatabase,
  makeTestRunTraceDatabase,
);
