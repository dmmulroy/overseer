import { OverseerSharedInfrastructureStack } from "@overseer/shared-infrastructure";
import { parseOtlpTraceData, TestRunId, TestTraceId } from "@overseer/test-trace-protocol";
import { assert, describe } from "@effect/vitest";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Config, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClientRequest } from "effect/unstable/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";
import TestTraceCollectorStack from "../alchemy.run.ts";

class TestTraceCollectorAccessSecretUnavailable extends Schema.TaggedError<TestTraceCollectorAccessSecretUnavailable>()(
  "TestTraceCollectorAccessSecretUnavailable",
  { message: Schema.String },
) {}

const TestTraceCollectorEndToEndTarget = Schema.Literals(["local", "preview"]);
const testStage = Effect.runSync(Config.schema(Schema.NonEmptyString, "ALCHEMY_TEST_STAGE"));
const testTarget = Effect.runSync(
  Config.schema(TestTraceCollectorEndToEndTarget, "TEST_TRACE_COLLECTOR_TARGET"),
);

const TestTraceCollectorAccessCredentialsStack = Alchemy.Stack(
  "TestTraceCollectorAccessCredentials",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const sharedInfrastructureReference = OverseerSharedInfrastructureStack.stage["production"];
    if (sharedInfrastructureReference === undefined) {
      return yield* Effect.die(
        new Error("Overseer shared infrastructure production stage reference is unavailable."),
      );
    }
    const sharedInfrastructure = yield* sharedInfrastructureReference;

    return {
      clientId: sharedInfrastructure.traceCollectorAccessClientId,
      clientSecret: sharedInfrastructure.traceCollectorAccessClientSecret,
    };
  }),
);

const resolveTestTraceCollectorUrl = Effect.fn("TestTraceCollectorDeployment.resolveUrl")(
  function* (url: string | undefined) {
    if (url === undefined) {
      return yield* Effect.die(
        new Error("Test trace collector deployment URL is unavailable. Deploy the Stack again."),
      );
    }
    return new URL(url);
  },
);

const unavailableTraceId = TestTraceId.make("0123456789abcdef0123456789abcdef");
const parseExportedTestTraceId = Schema.decodeUnknownEffect(TestTraceId);
const collectorAcceptanceSpanName = "test trace collector accepts Effect OTLP exports";

type TestTraceCollectorAuthenticatedAccessCredentials = {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
};

const withAccessCredentials =
  (credentials: TestTraceCollectorAuthenticatedAccessCredentials) =>
  (request: HttpClientRequest.HttpClientRequest): HttpClientRequest.HttpClientRequest =>
    request.pipe(
      HttpClientRequest.setHeader("CF-Access-Client-Id", credentials.clientId),
      HttpClientRequest.setHeader(
        "CF-Access-Client-Secret",
        Redacted.value(credentials.clientSecret),
      ),
    );

const verifyTestTraceRoundTrip = (
  deploymentUrl: URL,
  credentials: Option.Option<TestTraceCollectorAuthenticatedAccessCredentials>,
) => {
  const testRunId = TestRunId.make(`test-run_${testStage}`);
  const ingestionUrl = new URL(`/v1/test-runs/${testRunId}/traces`, deploymentUrl).href;
  const exporterHeaders = Option.match(credentials, {
    onNone: () => undefined,
    onSome: ({ clientId, clientSecret }) => ({
      "CF-Access-Client-Id": clientId,
      "CF-Access-Client-Secret": Redacted.value(clientSecret),
    }),
  });
  const tracerLayer = OtlpTracer.layer({
    url: ingestionUrl,
    resource: { serviceName: "collector-access-e2e" },
    headers: exporterHeaders,
    exportInterval: "1 hour",
  }).pipe(Layer.provide(OtlpSerialization.layerJson));

  return Effect.gen(function* () {
    const traceId = yield* Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      return yield* parseExportedTestTraceId(span.traceId);
    }).pipe(Effect.withSpan(collectorAcceptanceSpanName, { root: true }));
    const flusher = yield* OtlpExporter.Flusher;
    yield* flusher.flush;

    const authorize = Option.match(credentials, {
      onNone: () => (request: HttpClientRequest.HttpClientRequest) => request,
      onSome: withAccessCredentials,
    });
    const traceUrl = new URL(`/v1/test-runs/${testRunId}/traces/${traceId}`, deploymentUrl).href;
    const retrievalResponse = yield* Test.executeWhenReady(
      HttpClientRequest.get(traceUrl).pipe(authorize),
      { times: 60 },
    );
    assert.strictEqual(retrievalResponse.status, 200);
    const retrievedTraceJson = yield* retrievalResponse.json;
    const retrievedTrace = yield* parseOtlpTraceData(retrievedTraceJson);
    const retrievedSpans = retrievedTrace.resourceSpans.flatMap((resourceSpan) =>
      resourceSpan.scopeSpans.flatMap((scopeSpan) => scopeSpan.spans),
    );
    assert.strictEqual(retrievedSpans.length, 1);
    assert.strictEqual(retrievedSpans[0]?.traceId, traceId);
    assert.strictEqual(retrievedSpans[0]?.name, collectorAcceptanceSpanName);
  }).pipe(Effect.provide(tracerLayer));
};

if (testTarget === "local") {
  describe("test trace collector Local access", () => {
    const alchemyTest = Test.make({
      providers: Cloudflare.providers(),
      state: Cloudflare.state(),
      stage: testStage,
      dev: true,
    });
    const deployment = alchemyTest.beforeAll(
      Effect.gen(function* () {
        const output = yield* alchemyTest.deploy(TestTraceCollectorStack);
        if (Object.hasOwn(output, "accessAudience")) {
          return yield* Effect.die(
            new Error("Local test trace collector unexpectedly provisioned Cloudflare Access."),
          );
        }
        return { url: yield* resolveTestTraceCollectorUrl(output.url) };
      }),
      { timeout: 600_000 },
    );

    alchemyTest.test(
      "Local accepts trace ingestion and retrieval without Access credentials",
      Effect.gen(function* () {
        const deployed = yield* deployment;
        yield* verifyTestTraceRoundTrip(deployed.url, Option.none());
      }),
      { timeout: 600_000 },
    );
  });
} else {
  describe("test trace collector Preview Access", () => {
    const alchemyTest = Test.make({
      providers: Cloudflare.providers(),
      state: Cloudflare.state(),
      stage: testStage,
      dev: false,
    });

    const deployment = alchemyTest.beforeAll(
      Effect.gen(function* () {
        const output = yield* alchemyTest.deploy(TestTraceCollectorStack);
        if (!("accessAudience" in output)) {
          return yield* Effect.die(
            new Error("Preview test trace collector did not provision Cloudflare Access."),
          );
        }
        return { url: yield* resolveTestTraceCollectorUrl(output.url) };
      }),
      { timeout: 600_000 },
    );

    const accessCredentials = alchemyTest.beforeAll(
      Effect.gen(function* () {
        const credentials = yield* alchemyTest.deploy(TestTraceCollectorAccessCredentialsStack);
        if (credentials.clientSecret === undefined) {
          return yield* Effect.fail(
            new TestTraceCollectorAccessSecretUnavailable({
              message:
                "Test trace collector Access service-token secret is unavailable. Rotate the shared service token before running deployed collector acceptance tests.",
            }),
          );
        }
        return {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
        };
      }),
    );

    alchemyTest.afterAll(alchemyTest.destroy(TestTraceCollectorAccessCredentialsStack), {
      timeout: 300_000,
    });
    alchemyTest.afterAll(alchemyTest.destroy(TestTraceCollectorStack), { timeout: 300_000 });

    alchemyTest.test(
      "Preview rejects missing and invalid credentials and accepts the shared service token",
      Effect.gen(function* () {
        const deployed = yield* deployment;
        const credentials = yield* accessCredentials;
        const testRunId = TestRunId.make(`test-run_${testStage}`);
        const traceUrl = new URL(
          `/v1/test-runs/${testRunId}/traces/${unavailableTraceId}`,
          deployed.url,
        ).href;

        const missingCredentialsResponse = yield* Test.executeWhenReady(
          HttpClientRequest.get(traceUrl),
          { times: 60 },
        );
        assert.strictEqual(missingCredentialsResponse.status, 403);

        const invalidCredentialsResponse = yield* Test.executeWhenReady(
          HttpClientRequest.get(traceUrl).pipe(
            HttpClientRequest.setHeader("CF-Access-Client-Id", "invalid-client-id"),
            HttpClientRequest.setHeader("CF-Access-Client-Secret", "invalid-client-secret"),
          ),
          { times: 60 },
        );
        assert.strictEqual(invalidCredentialsResponse.status, 403);

        yield* verifyTestTraceRoundTrip(deployed.url, Option.some(credentials));
      }),
      { timeout: 600_000 },
    );
  });
}
