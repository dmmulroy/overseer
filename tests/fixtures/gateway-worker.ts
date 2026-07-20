import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  AccessAudience,
  accessAssertionVerifierLayer,
} from "../../src/adapters/gateway/access-principal.ts";
import { makeGatewayApplication } from "../../src/adapters/gateway/gateway-application.ts";
import {
  ExactOrigin,
  HttpsOrigin,
} from "../../src/adapters/gateway/gateway-configuration.ts";
import { makeProblemResponder } from "../../src/adapters/gateway/problem-response.ts";
import { RequestId } from "../../src/domain/actor.ts";

const TestGatewayConfiguration = Schema.Struct({
  accessAudience: AccessAudience,
  accessIssuer: HttpsOrigin,
  allowedOrigin: ExactOrigin,
});

class TestGatewayApplication extends Context.Service<
  TestGatewayApplication,
  Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >
>()("@overseer/test/GatewayApplication") {}

type GatewayEnvironment = {
  readonly ASSETS?: { readonly fetch: (request: Request) => Promise<Response> };
  readonly ACCESS_AUDIENCE: string;
  readonly ACCESS_ISSUER: string;
  readonly ALLOWED_ORIGIN: string;
};

let application:
  | Promise<(request: Request) => Promise<Response>>
  | undefined;

function makeHandler(
  configuration: typeof TestGatewayConfiguration.Type,
): Promise<(request: Request) => Promise<Response>> {
  const runtime = ManagedRuntime.make(
    Layer.effect(
      TestGatewayApplication,
      makeGatewayApplication(
        {
          accessIssuer: configuration.accessIssuer,
          allowedOrigin: configuration.allowedOrigin,
          problemTypeBaseUrl: new URL("/problems/", configuration.allowedOrigin),
        },
        Effect.succeed(configuration.accessAudience),
      ),
    ).pipe(
      Layer.provide(
        accessAssertionVerifierLayer(configuration.accessIssuer),
      ),
    ),
  );

  return runtime.runPromise(TestGatewayApplication).then((handler) =>
    HttpEffect.toWebHandler(handler)
  );
}

/** Raw workerd adapter used to exercise the Effect-native Gateway in Miniflare. */
export default {
  async fetch(request: Request, env: GatewayEnvironment): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      return env.ASSETS === undefined
        ? new Response("Application assets are unavailable", { status: 503 })
        : env.ASSETS.fetch(request);
    }

    const decoded = Schema.decodeUnknownResult(TestGatewayConfiguration)({
      accessAudience: env.ACCESS_AUDIENCE,
      accessIssuer: env.ACCESS_ISSUER,
      allowedOrigin: env.ALLOWED_ORIGIN,
    });

    if (Result.isFailure(decoded)) {
      const requestId = RequestId.make(crypto.randomUUID());
      const respond = makeProblemResponder(
        new URL("/problems/", new URL(request.url).origin),
      );

      return respond({
        code: "gateway_unavailable",
        detail: "The Gateway configuration is invalid.",
        requestId,
      });
    }

    application ??= makeHandler(decoded.success);
    return (await application)(request);
  },
};
