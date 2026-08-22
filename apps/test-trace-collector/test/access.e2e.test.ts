import { OverseerSharedInfrastructureStack } from "@overseer/shared-infrastructure";
import { assert, describe } from "@effect/vitest";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Config, Effect, Option, Redacted, Schema } from "effect";
import { HttpClientRequest } from "effect/unstable/http";
import TestTraceCollectorStack from "../alchemy.run.ts";
import { parseOtlpTraceData } from "../src/otlp-trace-data.ts";
import { TestRunId, TestTraceId } from "../src/test-trace-identity.ts";

const TestTraceCollectorLocalDeployment = Schema.Struct({
  url: Schema.URLFromString,
});

const TestTraceCollectorPreviewDeployment = Schema.Struct({
  url: Schema.URLFromString,
  accessAudience: Schema.NonEmptyString,
});

const TestTraceCollectorAccessCredentials = Schema.Struct({
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.UndefinedOr(Schema.Redacted(Schema.NonEmptyString)),
});

class TestTraceCollectorAccessSecretUnavailable extends Schema.TaggedError<TestTraceCollectorAccessSecretUnavailable>()(
  "TestTraceCollectorAccessSecretUnavailable",
  { message: Schema.String },
) {}

const parseTestTraceCollectorLocalDeployment = Schema.decodeUnknownEffect(
  TestTraceCollectorLocalDeployment,
);
const parseTestTraceCollectorPreviewDeployment = Schema.decodeUnknownEffect(
  TestTraceCollectorPreviewDeployment,
);
const parseTestTraceCollectorAccessCredentials = Schema.decodeUnknownEffect(
  TestTraceCollectorAccessCredentials,
);
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

const traceId = TestTraceId.make("0123456789abcdef0123456789abcdef");
const traceData = {
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: "collector-access-e2e" } }],
        droppedAttributesCount: 0,
      },
      scopeSpans: [
        {
          scope: { name: "collector-access-e2e" },
          spans: [
            {
              traceId,
              spanId: "0123456789abcdef",
              name: "collector access acceptance",
              kind: 1,
              startTimeUnixNano: "1000000",
              endTimeUnixNano: "2000000",
              attributes: [],
              droppedAttributesCount: 0,
              events: [],
              droppedEventsCount: 0,
              status: { code: 1 },
              links: [],
              droppedLinksCount: 0,
            },
          ],
        },
      ],
    },
  ],
};

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
) =>
  Effect.gen(function* () {
    const testRunId = TestRunId.make(`test-run_${testStage}`);
    const traceUrl = new URL(`/v1/test-runs/${testRunId}/traces/${traceId}`, deploymentUrl).href;
    const ingestionUrl = new URL(`/v1/test-runs/${testRunId}/traces`, deploymentUrl).href;
    const authorize = Option.match(credentials, {
      onNone: () => (request: HttpClientRequest.HttpClientRequest) => request,
      onSome: withAccessCredentials,
    });
    const ingestionRequest = yield* HttpClientRequest.post(ingestionUrl).pipe(
      authorize,
      HttpClientRequest.bodyJson(traceData),
    );
    const ingestionResponse = yield* Test.executeWhenReady(ingestionRequest, { times: 60 });
    assert.strictEqual(ingestionResponse.status, 200);

    const retrievalResponse = yield* Test.executeWhenReady(
      HttpClientRequest.get(traceUrl).pipe(authorize),
      { times: 60 },
    );
    assert.strictEqual(retrievalResponse.status, 200);
    const retrievedTrace = yield* retrievalResponse.json.pipe(Effect.flatMap(parseOtlpTraceData));
    assert.strictEqual(retrievedTrace.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.traceId, traceId);
  });

if (testTarget === "local") {
  describe("test trace collector Local access", () => {
    const alchemyTest = Test.make({
      providers: Cloudflare.providers(),
      state: Cloudflare.state(),
      stage: testStage,
      dev: true,
    });
    const deployment = alchemyTest.beforeAll(
      alchemyTest.deploy(TestTraceCollectorStack).pipe(
        Effect.flatMap((output) => {
          if (Object.hasOwn(output, "accessAudience")) {
            return Effect.die(
              new Error("Local test trace collector unexpectedly provisioned Cloudflare Access."),
            );
          }
          return parseTestTraceCollectorLocalDeployment(output);
        }),
      ),
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
      alchemyTest
        .deploy(TestTraceCollectorStack)
        .pipe(Effect.flatMap(parseTestTraceCollectorPreviewDeployment)),
      { timeout: 600_000 },
    );

    const accessCredentials = alchemyTest.beforeAll(
      alchemyTest.deploy(TestTraceCollectorAccessCredentialsStack).pipe(
        Effect.flatMap(parseTestTraceCollectorAccessCredentials),
        Effect.flatMap((credentials) =>
          Option.match(Option.fromUndefinedOr(credentials.clientSecret), {
            onNone: () =>
              Effect.fail(
                new TestTraceCollectorAccessSecretUnavailable({
                  message:
                    "Test trace collector Access service-token secret is unavailable. Rotate the shared service token before running deployed collector acceptance tests.",
                }),
              ),
            onSome: (clientSecret) =>
              Effect.succeed({ clientId: credentials.clientId, clientSecret }),
          }),
        ),
      ),
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
        const traceUrl = new URL(`/v1/test-runs/${testRunId}/traces/${traceId}`, deployed.url).href;

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
