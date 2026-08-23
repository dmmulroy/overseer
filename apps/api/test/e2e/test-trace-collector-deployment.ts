import {
  OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN,
  OverseerSharedInfrastructureStack,
} from "@overseer/shared-infrastructure";
import {
  TestRunId,
  TestTraceCollectorUnavailableError,
  TestTraceId,
  TestTraceNotFoundError,
  TraceCollectorHttpApi,
} from "@overseer/test-trace-protocol";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Redacted, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { isHttpClientError } from "effect/unstable/http/HttpClientError";
import { HttpApiClient } from "effect/unstable/httpapi";

/** Production trace collector URL and redacted Access credentials used by the E2E harness. */
export interface TestTraceCollectorDeployment {
  readonly url: URL;
  readonly access: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
  };
}

const testTraceCollectorProductionUrl = new URL(
  `https://${OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN}`,
);

class TestTraceCollectorAccessSecretUnavailable extends Schema.TaggedError<TestTraceCollectorAccessSecretUnavailable>()(
  "TestTraceCollectorAccessSecretUnavailable",
  { message: Schema.String },
) {}

/** Resolve an authenticated production trace collector connection from typed Alchemy outputs. */
export const resolveTestTraceCollectorDeployment = Effect.fn(
  "TestTraceCollectorDeployment.resolve",
)(function* (clientId: string, clientSecret: Redacted.Redacted<string> | undefined) {
  if (clientSecret === undefined) {
    return yield* Effect.fail(
      new TestTraceCollectorAccessSecretUnavailable({
        message:
          "Test trace collector Access service-token secret is unavailable. Rotate the shared service token before running Overseer end-to-end tests.",
      }),
    );
  }

  return {
    url: testTraceCollectorProductionUrl,
    access: { clientId, clientSecret },
  } satisfies TestTraceCollectorDeployment;
});

/** Resolves the persistent production trace collector and its shared Access credentials. */
export const OverseerTestTraceCollectorDeploymentStack = Alchemy.Stack(
  "OverseerTestTraceCollectorDeployment",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const sharedInfrastructureReference =
      OverseerSharedInfrastructureStack.stage[OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE];
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

const readinessTraceId = TestTraceId.make("0123456789abcdef0123456789abcdef");

/** Verify that the E2E harness can authenticate to the collector's typed lookup boundary. */
export const waitForTestTraceCollectorDeployment = Effect.fn(
  "TestTraceCollectorDeployment.waitUntilReady",
)(
  function* (deployment: TestTraceCollectorDeployment, testRunId: TestRunId) {
    const httpClient = yield* HttpClient.HttpClient;
    const authenticatedHttpClient = httpClient.pipe(
      HttpClient.mapRequest((request) =>
        request.pipe(
          HttpClientRequest.setHeader("CF-Access-Client-Id", deployment.access.clientId),
          HttpClientRequest.setHeader(
            "CF-Access-Client-Secret",
            Redacted.value(deployment.access.clientSecret),
          ),
        ),
      ),
    );
    const client = yield* HttpApiClient.makeWith(TraceCollectorHttpApi, {
      baseUrl: deployment.url,
      httpClient: authenticatedHttpClient,
    });

    yield* client.traceCollector.getTestTrace({
      params: { testRunId, traceId: readinessTraceId },
    });
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
);
