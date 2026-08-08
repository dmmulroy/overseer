import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  AccessAuthenticationMiddleware,
  accessAuthenticationMiddlewareLayer,
} from "./access-authentication-middleware.ts";
import { overseerHttpHandlersLayer } from "./overseer-http-handlers.ts";
import { OverseerHttpApi } from "./overseer-http-api.ts";
import { OverseerSdk, overseerSdkLayer } from "./overseer-sdk/overseer-sdk.ts";
import {
  RequestIdMiddleware,
  requestIdMiddlewareLayerForEnvironment,
} from "./request-id-middleware.ts";

const overseerHttpPlatformLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("Overseer API HTTP file responses are not supported"),
  fileWebResponse: () => Effect.die("Overseer API HTTP web file responses are not supported"),
});

const overseerHttpServerLayer = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  overseerHttpPlatformLayer,
  Path.layer,
);

/** Effect-native API Worker shared by local development and every deployed stage. */
export class ApiWorker extends Cloudflare.Worker<ApiWorker, {}>()("Api") {}

/** Run the authenticated Overseer HTTP API locally or on its Access-protected custom domain. */
export default ApiWorker.make(
  Effect.gen(function* () {
    const hostname = yield* Config.string("OVERSEER_API_HOSTNAME").pipe(
      Config.withDefault("localhost"),
    );

    return {
      main: import.meta.url,
      dev: {
        port: 8787,
        strictPort: true,
      },
      domain: { name: hostname },
      workersDev: false,
    };
  }),
  Effect.gen(function* () {
    // Materialize once per Worker isolate so production reuses its remote JWKS cache;
    // the middleware still verifies each request and provides a request-scoped CurrentActor.
    const accessAuthenticationMiddleware = yield* AccessAuthenticationMiddleware.pipe(
      Effect.provide(accessAuthenticationMiddlewareLayer),
    );
    const requestIdMiddleware = yield* RequestIdMiddleware.pipe(
      Effect.provide(requestIdMiddlewareLayerForEnvironment),
    );
    const overseerSdk = yield* OverseerSdk.pipe(Effect.provide(overseerSdkLayer));

    const configuredOverseerHttpHandlersLayer = overseerHttpHandlersLayer.pipe(
      Layer.provide(Layer.succeed(OverseerSdk, overseerSdk)),
    );

    return {
      fetch: HttpApiBuilder.layer(OverseerHttpApi).pipe(
        Layer.provide(configuredOverseerHttpHandlersLayer),
        Layer.provide(
          Layer.succeed(AccessAuthenticationMiddleware, accessAuthenticationMiddleware),
        ),
        Layer.provide(Layer.succeed(RequestIdMiddleware, requestIdMiddleware)),
        Layer.provide(overseerHttpServerLayer),
        HttpRouter.toHttpEffect,
      ),
    };
  }),
);
