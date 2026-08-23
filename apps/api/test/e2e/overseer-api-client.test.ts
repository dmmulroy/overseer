import { assert, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Option, Redacted, Ref } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { HttpClientError, TransportError } from "effect/unstable/http/HttpClientError";
import { OverseerApiClient, overseerApiClientLayer } from "./overseer-api-client.ts";
import {
  type OverseerApiDeployment,
  resolveOverseerApiDeployment,
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
    const deployment = yield* resolveOverseerApiDeployment("local", {
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
    const deployment = yield* resolveOverseerApiDeployment("deployed", {
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

it.effect("retries transient deployed responses while Cloudflare bindings converge", () =>
  Effect.gen(function* () {
    const deployment = yield* resolveOverseerApiDeployment("deployed", {
      url: "https://overseer-api-test-user-run.mulroy.ai",
      agentClientId: "agent-client-id",
      agentClientSecret: Redacted.make("access-secret"),
    });
    const attempts = yield* Ref.make(0);
    const convergingHttpClient = HttpClient.make((request) =>
      Ref.updateAndGet(attempts, (count) => count + 1).pipe(
        Effect.map((attempt) =>
          HttpClientResponse.fromWeb(
            request,
            attempt === 1
              ? new Response(undefined, { status: 500 })
              : new Response(JSON.stringify("Overseer API"), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
          ),
        ),
      ),
    );

    const identityFiber = yield* Effect.gen(function* () {
      const client = yield* OverseerApiClient;
      return yield* client.overseer.getApiIdentity({});
    }).pipe(
      Effect.provide(
        overseerApiClientLayer(deployment).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, convergingHttpClient)),
        ),
      ),
      Effect.forkScoped,
    );
    yield* TestClock.adjust("2 seconds");

    assert.strictEqual(yield* Fiber.join(identityFiber), "Overseer API");
    assert.strictEqual(yield* Ref.get(attempts), 2);
  }).pipe(Effect.scoped),
);

it.effect("does not retry ambiguous deployed transport failures", () =>
  Effect.gen(function* () {
    const deployment = yield* resolveOverseerApiDeployment("deployed", {
      url: "https://overseer-api-test-user-run.mulroy.ai",
      agentClientId: "agent-client-id",
      agentClientSecret: Redacted.make("access-secret"),
    });
    const attempts = yield* Ref.make(0);
    const ambiguousHttpClient = HttpClient.make((request) =>
      Effect.gen(function* () {
        const attempt = yield* Ref.updateAndGet(attempts, (count) => count + 1);
        if (attempt === 1) {
          return yield* Effect.fail(
            new HttpClientError({
              reason: new TransportError({
                request,
                description: "ambiguous test transport failure",
              }),
            }),
          );
        }
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify("Overseer API"), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    const identityFiber = yield* Effect.gen(function* () {
      const client = yield* OverseerApiClient;
      return yield* client.overseer.getApiIdentity({});
    }).pipe(
      Effect.provide(
        overseerApiClientLayer(deployment).pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, ambiguousHttpClient)),
        ),
      ),
      Effect.forkScoped,
    );
    yield* TestClock.adjust("2 seconds");

    assert.isTrue(Exit.isFailure(yield* Fiber.await(identityFiber)));
    assert.strictEqual(yield* Ref.get(attempts), 1);
  }).pipe(Effect.scoped),
);
