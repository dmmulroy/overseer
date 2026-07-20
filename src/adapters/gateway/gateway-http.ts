import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Record from "effect/Record";
import type * as Scope from "effect/Scope";
import type * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import {
  CloudflareAccess,
  OverseerApi,
} from "../../contract/http-api.ts";
import { openApiDocument } from "../../contract/openapi.ts";
import { discoveryDocument, schemaIndex } from "../../contract/representations.ts";
import type { RequestId } from "../../domain/actor.ts";
import { applyConditionalResponse } from "./conditional-response.ts";
import type { ProblemResponder } from "./problem-response.ts";

const AuthenticatedCloudflareAccess = Layer.succeed(
  CloudflareAccess,
  CloudflareAccess.of({
    // Authentication and mutation admission wrap the whole API router so that
    // unknown routes receive the same safe authentication policy as endpoints.
    cloudflareAccess: (effect) => effect,
  }),
);

const DiscoveryHandlers = HttpApiBuilder.group(
  OverseerApi,
  "discovery",
  (handlers) =>
    handlers.handleAll({
      discover: () => Effect.sync(discoveryDocument),
      headDiscovery: () => Effect.sync(discoveryDocument),
      discoverSchemas: () => Effect.sync(schemaIndex),
      headSchemas: () => Effect.sync(schemaIndex),
      openApi: () => Effect.sync(openApiDocument),
      headOpenApi: () => Effect.sync(openApiDocument),
    }),
);

const HttpPlatformLive = HttpPlatform.layer.pipe(
  Layer.provide(FileSystem.layerNoop({})),
);

const apiEndpoints = Arr.flatMap(
  Record.values(OverseerApi.groups),
  (group) => Record.values(group.endpoints),
);

function allowedMethods(pathname: string): ReadonlyArray<string> {
  return Arr.dedupe(
    Arr.map(
      Arr.filter(apiEndpoints, (endpoint) => endpoint.path === pathname),
      (endpoint) => endpoint.method,
    ),
  );
}

/** Build the declared API handler once for an Effect-native Worker isolate. */
export function makeApiRequestHandler(
  respond: ProblemResponder,
): Effect.Effect<
  (requestId: RequestId) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    HttpServerError.HttpServerError,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  never,
  Scope.Scope
> {
  const ApiLive = HttpApiBuilder.layer(OverseerApi).pipe(
    Layer.provide(DiscoveryHandlers),
    Layer.provide(AuthenticatedCloudflareAccess),
    Layer.provide([
      Etag.layer,
      HttpPlatformLive,
      Path.layer,
      FileSystem.layerNoop({}),
    ]),
  );

  return Effect.gen(function* () {
    const handleDeclaredApi = yield* HttpRouter.toHttpEffect(ApiLive);

    return Effect.fn("Gateway.handleApiRequest")(function* (requestId) {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const pathname = new URL(request.url, "https://gateway.invalid").pathname;
      const methods = allowedMethods(pathname);

      if (methods.length === 0) {
        return HttpServerResponse.fromWeb(respond({
          code: "resource_not_found",
          detail: "The requested API resource does not exist.",
          requestId,
        }));
      }

      if (!Arr.contains(methods, request.method)) {
        return HttpServerResponse.fromWeb(respond({
          code: "method_not_allowed",
          detail: "This resource does not support the requested method.",
          headers: { allow: methods.join(", ") },
          requestId,
        }));
      }

      const response = yield* handleDeclaredApi;

      return yield* applyConditionalResponse({
        request,
        requestId,
        respond,
        response,
      });
    });
  });
}
