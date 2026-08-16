import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Redacted, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import {
  OverseerApiDeployment,
  parseOverseerApiDeployment,
  waitForOverseerApiDeployment,
} from "./overseer-api-deployment.ts";

it.effect("parses a local Overseer API deployment from its URL", () =>
  Effect.gen(function* () {
    const deployment = yield* parseOverseerApiDeployment("local")({
      url: "http://localhost:8787",
    });

    assert.doesNotThrow(() => Schema.encodeSync(OverseerApiDeployment)(deployment));
    assert.strictEqual(deployment.target, "local");
    assert.strictEqual(deployment.url.href, "http://localhost:8787/");
  }),
);

it.effect("parses a deployed Overseer API without exposing its Access secret", () =>
  Effect.gen(function* () {
    const secret = Redacted.make("access-secret");
    const deployment = yield* parseOverseerApiDeployment("deployed")({
      url: "https://overseer-api-test-user-run.mulroy.ai",
      agentClientId: "agent-client-id",
      agentClientSecret: secret,
    });

    assert.doesNotThrow(() => Schema.encodeSync(OverseerApiDeployment)(deployment));
    assert.strictEqual(deployment.target, "deployed");
    if (deployment.target !== "deployed") return assert.fail("Expected a deployed API");
    assert.strictEqual(deployment.url.href, "https://overseer-api-test-user-run.mulroy.ai/");
    assert.strictEqual(deployment.access.clientId, "agent-client-id");
    assert.strictEqual(deployment.access.clientSecret, secret);
  }),
);

it.effect("rejects deployed output with no fresh Access secret", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      parseOverseerApiDeployment("deployed")({
        url: "https://overseer-api-test-user-run.mulroy.ai",
        agentClientId: "agent-client-id",
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("waits for the Workspace Durable Object to survive deployment convergence", () =>
  Effect.gen(function* () {
    const deployment = yield* parseOverseerApiDeployment("local")({
      url: "http://localhost:8787",
    });
    const requestedPaths = yield* Ref.make<ReadonlyArray<string>>([]);
    const workspaceAttempts = yield* Ref.make(0);
    const recordingHttpClient = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        yield* Ref.update(requestedPaths, (paths) => [...paths, url.pathname]);
        if (url.pathname === "/") {
          return HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify("Overseer API"), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }

        const attempt = yield* Ref.updateAndGet(workspaceAttempts, (count) => count + 1);
        return HttpClientResponse.fromWeb(
          request,
          new Response(undefined, { status: attempt === 1 ? 500 : 404 }),
        );
      }),
    );

    const readiness = yield* waitForOverseerApiDeployment(deployment).pipe(
      Effect.provide(Layer.succeed(HttpClient.HttpClient, recordingHttpClient)),
      Effect.forkScoped,
    );
    yield* TestClock.adjust("5 seconds");
    yield* Fiber.join(readiness);

    assert.deepStrictEqual(yield* Ref.get(requestedPaths), [
      "/",
      "/v1/workspaces/workspace_00000000000000000000000000",
      "/v1/workspaces/workspace_00000000000000000000000000",
    ]);
  }).pipe(Effect.scoped),
);
