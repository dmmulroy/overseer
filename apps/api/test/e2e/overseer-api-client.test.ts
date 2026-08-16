import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted, Ref } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { OverseerApiClient, overseerApiClientLayer } from "./overseer-api-client.ts";
import {
  type OverseerApiDeployment,
  parseOverseerApiDeployment,
} from "./overseer-api-deployment.ts";

const executeRecordedIdentityRequest = (deployment: OverseerApiDeployment) =>
  Effect.gen(function* () {
    const observedRequest = yield* Ref.make<
      Option.Option<{
        readonly request: Parameters<Parameters<typeof HttpClient.make>[0]>[0];
        readonly url: URL;
      }>
    >(Option.none());
    const recordingHttpClient = HttpClient.make((request, url) =>
      Ref.set(observedRequest, Option.some({ request, url })).pipe(
        Effect.as(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify("Overseer API"), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      ),
    );

    const identity = yield* Effect.gen(function* () {
      const client = yield* OverseerApiClient;
      return yield* client.overseer.getApiIdentity({});
    }).pipe(
      Effect.provide(
        overseerApiClientLayer(deployment).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, recordingHttpClient)),
        ),
      ),
    );

    return { identity, observed: Option.getOrThrow(yield* Ref.get(observedRequest)) };
  });

it.effect("sends local API calls without Cloudflare Access credentials", () =>
  Effect.gen(function* () {
    const deployment = yield* parseOverseerApiDeployment("local")({
      url: "http://localhost:8787",
    });
    const { identity, observed } = yield* executeRecordedIdentityRequest(deployment);

    assert.strictEqual(identity, "Overseer API");
    assert.strictEqual(observed.url.href, "http://localhost:8787/");
    assert.strictEqual(observed.request.headers["cf-access-client-id"], undefined);
    assert.strictEqual(observed.request.headers["cf-access-client-secret"], undefined);
  }),
);

it.effect("sends deployed API calls with Agent Access credentials", () =>
  Effect.gen(function* () {
    const deployment = yield* parseOverseerApiDeployment("deployed")({
      url: "https://overseer-api-test-user-run.mulroy.ai",
      agentClientId: "agent-client-id",
      agentClientSecret: Redacted.make("access-secret"),
    });
    const { identity, observed } = yield* executeRecordedIdentityRequest(deployment);

    assert.strictEqual(identity, "Overseer API");
    assert.strictEqual(observed.url.href, "https://overseer-api-test-user-run.mulroy.ai/");
    assert.strictEqual(observed.request.headers["cf-access-client-id"], "agent-client-id");
    assert.strictEqual(observed.request.headers["cf-access-client-secret"], "access-secret");
  }),
);
