import * as Cloudflare from "alchemy/Cloudflare";
import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";
import { Cache, Context, Effect, Layer } from "effect";
import type { OtlpTracer } from "effect/unstable/observability";
import { HttpApiClient } from "effect/unstable/httpapi";
import type { TestRunId, TestTraceId } from "../test-trace-identity.ts";
import { TestRunTraceHttpApi } from "./test-run-trace-http-api.ts";
import testRunTraceServerLayer, { TestRunTraceServer } from "./test-run-trace-server.ts";

/** Worker-facing operations for test-run trace Durable Objects. */
export interface ITestRunTraceClient {
  /** Forward one parsed OTLP export to the Durable Object selected by test-run identity. */
  readonly ingestOtlpTraces: (
    testRunId: TestRunId,
    traceData: OtlpTracer.TraceData,
  ) => Effect.Effect<void>;
  /** Retrieve one retained trace from the Durable Object selected by test-run identity. */
  readonly getTestTrace: (
    testRunId: TestRunId,
    traceId: TestTraceId,
  ) => Effect.Effect<OtlpTracer.TraceData>;
}

type TestRunTraceHttpClient = HttpApiClient.ForApi<typeof TestRunTraceHttpApi>;

/** Provides the application-owned HTTP client for test-run trace Durable Objects. */
export class TestRunTraceClient extends Context.Service<TestRunTraceClient, ITestRunTraceClient>()(
  "@overseer/TestRunTraceClient",
) {}

/** Constructs the test-run trace client with execution-scoped Durable Object stubs. */
export const makeTestRunTraceClient: Effect.Effect<
  TestRunTraceClient["Service"],
  never,
  Cloudflare.Worker | TestRunTraceServer
> = Effect.gen(function* () {
  const namespace = yield* TestRunTraceServer;
  const testRunTraceHttpClients = yield* makeExecutionMemo(
    Cache.make<TestRunId, TestRunTraceHttpClient>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: (testRunId) =>
        Effect.suspend(() =>
          HttpApiClient.makeWith(TestRunTraceHttpApi, {
            baseUrl: "http://test-run-trace.internal",
            httpClient: Cloudflare.toHttpClient(namespace.getByName(testRunId)),
          }),
        ),
    }),
  );
  const testRunTraceHttpClient = (testRunId: TestRunId) =>
    Effect.flatMap(testRunTraceHttpClients, (clients) => Cache.get(clients, testRunId));

  return TestRunTraceClient.of({
    ingestOtlpTraces: Effect.fn("TestRunTraceClient.ingestOtlpTraces")(
      function* (testRunId, traceData) {
        const client = yield* testRunTraceHttpClient(testRunId);
        yield* client.testRunTrace.ingestOtlpTraces({ payload: traceData }).pipe(Effect.orDie);
      },
    ),
    getTestTrace: Effect.fn("TestRunTraceClient.getTestTrace")(function* (testRunId, traceId) {
      const client = yield* testRunTraceHttpClient(testRunId);
      return yield* client.testRunTrace.getTestTrace({ params: { traceId } }).pipe(Effect.orDie);
    }),
  });
});

/** Provides the test-run trace client while preserving its Durable Object requirement. */
export const testRunTraceClientLayerWithoutDependencies = Layer.effect(
  TestRunTraceClient,
  makeTestRunTraceClient,
);

/** Provides the test-run trace client with its production Durable Object server. */
export const testRunTraceClientLayer = testRunTraceClientLayerWithoutDependencies.pipe(
  Layer.provide(testRunTraceServerLayer),
);
