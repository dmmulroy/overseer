import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  AccessAuthenticationMiddleware,
  accessAuthenticationMiddlewareLayer,
} from "./access-authentication-middleware.ts";

const apiIdentityEndpoint = HttpApiEndpoint.get("getApiIdentity", "/", {
  success: Schema.String,
}).middleware(AccessAuthenticationMiddleware);

/** Public HTTP operations exposed by the Overseer API Worker. */
export class ApiHttpGroup extends HttpApiGroup.make("api").add(apiIdentityEndpoint) {}

/** Authenticated HTTP contract served by the Overseer API Worker. */
export class ApiHttpApi extends HttpApi.make("ApiHttpApi").add(ApiHttpGroup) {}

const apiHttpHandlersLayer = HttpApiBuilder.group(ApiHttpApi, "api", (handlers) =>
  handlers.handle("getApiIdentity", () => Effect.succeed("Overseer API")),
);

const apiHttpPlatformLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("Overseer API HTTP file responses are not supported"),
  fileWebResponse: () => Effect.die("Overseer API HTTP web file responses are not supported"),
});

const apiHttpServerLayer = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  apiHttpPlatformLayer,
  Path.layer,
);

/** Effect-native API Worker shared by local development and every deployed stage. */
export class ApiWorker extends Cloudflare.Worker<ApiWorker, {}>()("Api") {}

/** Run the authenticated Overseer HTTP API in workerd. */
export default ApiWorker.make(
  {
    main: import.meta.url,
    dev: {
      port: 8787,
      strictPort: true,
    },
  },
  Effect.gen(function* () {
    // Materialize once per Worker isolate so production reuses its remote JWKS cache;
    // the middleware still verifies each request and provides a request-scoped CurrentActor.
    const accessAuthenticationMiddleware = yield* AccessAuthenticationMiddleware.pipe(
      Effect.provide(accessAuthenticationMiddlewareLayer),
    );

    return {
      fetch: HttpApiBuilder.layer(ApiHttpApi).pipe(
        Layer.provide(apiHttpHandlersLayer),
        Layer.provide(
          Layer.succeed(AccessAuthenticationMiddleware, accessAuthenticationMiddleware),
        ),
        Layer.provide(apiHttpServerLayer),
        HttpRouter.toHttpEffect,
      ),
    };
  }),
);
