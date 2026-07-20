import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
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
import {
  discoveryDocument,
  requestSchemaDocument,
  schemaIndex,
} from "../../contract/representations.ts";
import type { Catalog } from "../../application/catalog/catalog.ts";
import type { RequestId } from "../../domain/actor.ts";
import { applyConditionalResponse } from "./conditional-response.ts";
import { gatewayRequestContext } from "./gateway-request-context.ts";
import type { ProblemResponder } from "./problem-response.ts";
import { workspaceHandlers } from "./workspace-http.ts";

function requestSchemaResponse(
  contentHash: string,
  schemaName: string,
  respond: ProblemResponder,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  never
> {
  return Effect.gen(function* () {
    const context = yield* gatewayRequestContext;
    const document = requestSchemaDocument(contentHash, schemaName);
    return Option.match(document, {
      onNone: () => HttpServerResponse.fromWeb(respond({
        code: "resource_not_found",
        detail: "The requested schema does not exist.",
        requestId: context.requestId,
      })),
      onSome: (value) => HttpServerResponse.jsonUnsafe(value, {
        headers: { "content-type": "application/schema+json" },
      }),
    });
  });
}

const discoveryHandlers = (respond: ProblemResponder) => HttpApiBuilder.group(
  OverseerApi,
  "discovery",
  (handlers) =>
    handlers
      .handle("discover", () => Effect.sync(discoveryDocument))
      .handle("headDiscovery", () => Effect.sync(discoveryDocument))
      .handle("discoverSchemas", () => Effect.sync(schemaIndex))
      .handle("headSchemas", () => Effect.sync(schemaIndex))
      .handle("openApi", () => Effect.sync(openApiDocument))
      .handle("headOpenApi", () => Effect.sync(openApiDocument))
      .handleRaw("readRequestSchema", ({ params }) =>
        requestSchemaResponse(params.content_hash, params.schema_name, respond))
      .handleRaw("headRequestSchema", ({ params }) =>
        requestSchemaResponse(params.content_hash, params.schema_name, respond)),
);

const HttpPlatformLive = HttpPlatform.layer.pipe(
  Layer.provide(FileSystem.layerNoop({})),
);

const apiEndpoints = Object.values(OverseerApi.groups).flatMap(
  (group) => Object.values(group.endpoints),
);

function endpointMatches(path: string, pathname: string): boolean {
  const expected = path.split("/");
  const actual = pathname.split("/");
  return expected.length === actual.length && expected.every(
    (segment, index) => segment.startsWith(":") || segment === actual[index],
  );
}

function allowedMethods(pathname: string): ReadonlyArray<string> {
  return Arr.dedupe(
    Arr.map(
      Arr.filter(apiEndpoints, (endpoint) => endpointMatches(endpoint.path, pathname)),
      (endpoint) => endpoint.method,
    ),
  );
}

/** Build the declared API handler once for an Effect-native Worker isolate. */
export function makeApiRequestHandler(
  respond: ProblemResponder,
  catalog: Catalog,
  authenticatedAccess: Layer.Layer<CloudflareAccess>,
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
    Layer.provide(discoveryHandlers(respond)),
    Layer.provide(workspaceHandlers(catalog, respond)),
    Layer.provide(authenticatedAccess),
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

      const response = yield* handleDeclaredApi.pipe(
        Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.MiB(2)),
      );
      if (response.status === 415) {
        return HttpServerResponse.fromWeb(respond({
          code: "unsupported_media_type",
          detail: "This operation requires a supported request Content-Type.",
          requestId,
        }));
      }
      if (response.status === 413) {
        return HttpServerResponse.fromWeb(respond({
          code: "malformed_request",
          detail: "The request body exceeds the configured size limit.",
          requestId,
        }));
      }
      if (response.status >= 400) {
        return response;
      }

      return yield* applyConditionalResponse({
        request,
        requestId,
        respond,
        response,
      });
    });
  });
}
