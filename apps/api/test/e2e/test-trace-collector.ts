import {
  type OtlpTraceData,
  TestRunId,
  TestTraceCollectorUnavailableError,
  TestTraceId,
  TestTraceNotFoundError,
  TraceCollectorHttpApi,
} from "@overseer/test-trace-protocol";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Ref,
  Schedule,
  Schema,
  Tracer,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { isHttpClientError } from "effect/unstable/http/HttpClientError";
import { HttpApiClient } from "effect/unstable/httpapi";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";
import { overseerHttpClientTraceHeaderFilter } from "../../src/overseer-http-header-policy.ts";
import {
  testTraceCollectorConnectionLayer,
  TestTraceCollectorConnection,
} from "./test-trace-collector-deployment.ts";

/** Inputs that identify one root span exported for an end-to-end test execution. */
export interface TestTraceExecutionInput {
  /** Test run used to select the collector's Durable Object. */
  readonly runId: TestRunId;
  /** Stable test name used for the execution root span. */
  readonly spanName: string;
}

/** Test Effect exit and TTC reference generated for one traced test execution. */
export interface TracedTestExecution<A, E> {
  /** Original test Effect exit, preserved independently from trace export. */
  readonly testExit: Exit.Exit<A, E>;
  /** Generated identity shared by the root and descendant spans. */
  readonly traceId: TestTraceId;
  /** Exact Access-protected TTC endpoint serving the eventually complete trace. */
  readonly traceUrl: URL;
}

/** Expected failure to retrieve one trace through the authenticated TTC endpoint. */
export class TestTraceLookupError extends Schema.TaggedError<TestTraceLookupError>()(
  "TestTraceLookupError",
  {
    operation: Schema.Literal("getTrace"),
    message: Schema.String,
    testRunId: TestRunId,
    traceId: TestTraceId,
    cause: Schema.Defect(),
  },
) {}

/** Expected failure to establish authenticated readiness with the persistent collector. */
export class TestTraceCollectorReadinessError extends Schema.TaggedError<TestTraceCollectorReadinessError>()(
  "TestTraceCollectorReadinessError",
  {
    operation: Schema.Literal("checkReadiness"),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** Operations provided by the authenticated persistent test trace collector. */
export interface ITestTraceCollector {
  /** Verify authenticated access through the collector's typed not-found response. */
  readonly checkReadiness: (
    runId: TestRunId,
  ) => Effect.Effect<void, TestTraceCollectorReadinessError>;
  /** Retrieve the currently available TTC snapshot for one test trace. */
  readonly getTrace: (
    runId: TestRunId,
    traceId: TestTraceId,
  ) => Effect.Effect<OtlpTraceData, TestTraceLookupError>;
  /** Run one test Effect under a root span and retain its TTC lookup identity. */
  readonly traceExecution: <A, E, R>(
    input: TestTraceExecutionInput,
    productEffect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<TracedTestExecution<A, E>, never, Exclude<R, Tracer.ParentSpan>>;
}

/** Provides authenticated OTLP export and retrieval for end-to-end test traces. */
export class TestTraceCollector extends Context.Service<TestTraceCollector, ITestTraceCollector>()(
  "@overseer/test/TestTraceCollector",
) {}

const readinessTraceId = TestTraceId.make("0123456789abcdef0123456789abcdef");
const parseExportedTraceId = Schema.decodeUnknownEffect(TestTraceId);

/** Constructs the test trace collector while preserving connection and HTTP requirements. */
export const makeTestTraceCollector: Effect.Effect<
  TestTraceCollector["Service"],
  never,
  TestTraceCollectorConnection | HttpClient.HttpClient
> = Effect.gen(function* () {
  const connection = yield* TestTraceCollectorConnection;
  const httpClient = yield* HttpClient.HttpClient;
  const authenticatedHttpClient = httpClient.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.setHeader("CF-Access-Client-Id", connection.access.clientId),
        HttpClientRequest.setHeader(
          "CF-Access-Client-Secret",
          Redacted.value(connection.access.clientSecret),
        ),
      ),
    ),
  );
  const client = yield* HttpApiClient.makeWith(TraceCollectorHttpApi, {
    baseUrl: connection.url,
    httpClient: authenticatedHttpClient,
  });

  const findTestTrace = Effect.fn("TestTraceCollector.findTestTrace")(function* (
    runId: TestRunId,
    traceId: TestTraceId,
  ) {
    return yield* client.traceCollector.getTestTrace({
      params: { testRunId: runId, traceId },
    });
  });

  const getTrace = Effect.fn("TestTraceCollector.getTrace")(
    function* (runId: TestRunId, traceId: TestTraceId) {
      return yield* findTestTrace(runId, traceId);
    },
    (effect, runId, traceId) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new TestTraceLookupError({
              operation: "getTrace",
              message: `TTC trace lookup failed for test run ${runId} and trace ${traceId}.`,
              testRunId: runId,
              traceId,
              cause,
            }),
        ),
      ),
  );

  const checkReadiness = Effect.fn("TestTraceCollector.checkReadiness")(
    function* (runId: TestRunId) {
      yield* findTestTrace(runId, readinessTraceId);
    },
    Effect.catchIf(
      (error): error is TestTraceNotFoundError => error instanceof TestTraceNotFoundError,
      () => Effect.void,
    ),
    Effect.retry({
      while: (error) =>
        error instanceof TestTraceCollectorUnavailableError ||
        (isHttpClientError(error) && error.reason._tag === "TransportError"),
      schedule: Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("3 seconds")]),
      times: 60,
    }),
    Effect.mapError(
      (cause) =>
        new TestTraceCollectorReadinessError({
          operation: "checkReadiness",
          message:
            "Test trace collector readiness failed. Verify the production collector deployment and shared Access credential, then retry the end-to-end run.",
          cause,
        }),
    ),
  );

  const traceExecution: ITestTraceCollector["traceExecution"] = Effect.fn(
    "TestTraceCollector.traceExecution",
  )(function* (input, productEffect) {
    const ingestionUrl = new URL(`/v1/test-runs/${input.runId}/traces`, connection.url).href;
    const tracerLayer = OtlpTracer.layer({
      url: ingestionUrl,
      resource: { serviceName: "overseer-e2e-harness" },
      headers: {
        "CF-Access-Client-Id": connection.access.clientId,
        "CF-Access-Client-Secret": Redacted.value(connection.access.clientSecret),
      },
      exportInterval: "1 hour",
    }).pipe(
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
    );

    return yield* Effect.gen(function* () {
      const traceIdRef = yield* Ref.make(Option.none<TestTraceId>());
      const testExit = yield* Effect.gen(function* () {
        const span = yield* Tracer.ParentSpan;
        const traceId = yield* parseExportedTraceId(span.traceId).pipe(Effect.orDie);
        yield* Ref.set(traceIdRef, Option.some(traceId));
        return yield* productEffect;
      }).pipe(
        Effect.withSpan(input.spanName, { root: true }),
        Effect.provideService(HttpClient.TracerHeaderFilter, overseerHttpClientTraceHeaderFilter),
        Effect.exit,
      );
      const traceId = Option.getOrThrowWith(
        yield* Ref.get(traceIdRef),
        () => new Error("Test trace collector root span identity was not captured"),
      );

      const flusher = yield* OtlpExporter.Flusher;
      yield* flusher.flush.pipe(Effect.timeoutOption("10 seconds"));

      return {
        testExit,
        traceId,
        traceUrl: new URL(`/v1/test-runs/${input.runId}/traces/${traceId}`, connection.url),
      } satisfies TracedTestExecution<unknown, unknown>;
    }).pipe(Effect.provide(tracerLayer));
  });

  return TestTraceCollector.of({ checkReadiness, getTrace, traceExecution });
});

/** Provides the collector while leaving connection and HTTP implementations visible. */
export const testTraceCollectorLayerWithoutDependencies = Layer.effect(
  TestTraceCollector,
  makeTestTraceCollector,
);

/** Provides the collector from one resolved connection while preserving its HTTP requirement. */
export const testTraceCollectorLayerFromConnection = (
  connection: TestTraceCollectorConnection["Service"],
): Layer.Layer<TestTraceCollector, never, HttpClient.HttpClient> =>
  testTraceCollectorLayerWithoutDependencies.pipe(
    Layer.provide(testTraceCollectorConnectionLayer(connection)),
  );
