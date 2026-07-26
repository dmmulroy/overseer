import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
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
import { WorkspaceRegistryService } from "../../application/workspace-registry/workspace-registry.ts";
import { CloudflareAccess, OverseerApi } from "../../contract/http-api.ts";
import { openApiDocument } from "../../contract/openapi.ts";
import { discoveryDocument, schemaIndex } from "../../contract/representations.ts";
import { requestSchemaDocument } from "../../contract/request-schemas.ts";
import type { RequestId } from "../../domain/actor.ts";
import { GatewayRequestContext } from "./gateway-request-context.ts";
import { ProblemResponse } from "./problem-response.ts";
import { finalizeRepresentationResponse } from "./representation-response.ts";
import { layer as projectHttpLayer } from "./project-http.ts";
import { layer as workspaceHttpLayer } from "./workspace-http.ts";

const requestSchemaResponse = Effect.fn("Gateway.requestSchemaResponse")(function* (
  contentHash: string,
  schemaName: string,
) {
  const context = yield* GatewayRequestContext;
  const problems = yield* ProblemResponse;
  const document = requestSchemaDocument(contentHash, schemaName);
  if (Option.isNone(document)) {
    return problems.render({
      code: "resource_not_found",
      detail: "The requested schema does not exist.",
      requestId: context.requestId,
    });
  }
  return document.value;
});

const discoveryHttpLayer = HttpApiBuilder.group(OverseerApi, "discovery", (handlers) =>
  handlers
    .handle("discover", () => Effect.sync(discoveryDocument))
    .handle("headDiscovery", () => Effect.sync(discoveryDocument))
    .handle("discoverSchemas", () => Effect.sync(schemaIndex))
    .handle("headSchemas", () => Effect.sync(schemaIndex))
    .handle("openApi", () => Effect.sync(openApiDocument))
    .handle("headOpenApi", () => Effect.sync(openApiDocument))
    .handle("readRequestSchema", ({ params }) =>
      requestSchemaResponse(params.content_hash, params.schema_name),
    )
    .handle("headRequestSchema", ({ params }) =>
      requestSchemaResponse(params.content_hash, params.schema_name),
    ),
);

const HttpPlatformLive = HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({})));

const apiEndpoints = Object.values(OverseerApi.groups).flatMap((group) =>
  Object.values(group.endpoints),
);

function endpointMatches(path: string, pathname: string): boolean {
  const expected = path.split("/");
  const actual = pathname.split("/");
  return (
    expected.length === actual.length &&
    expected.every((segment, index) => {
      const actualSegment = actual[index];
      return segment.startsWith(":")
        ? actualSegment !== undefined && actualSegment.length > 0
        : segment === actualSegment;
    })
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

/** Request-scoped API handler assembled from the declared HTTP contract. */
export type GatewayApiHandler = {
  readonly handle: (
    requestId: RequestId,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    HttpServerError.HttpServerError,
    GatewayRequestContext | HttpServerRequest.HttpServerRequest | Scope.Scope
  >;
};

/** Effect service for handling one declared Gateway API request. */
export class GatewayApi extends Context.Service<GatewayApi, GatewayApiHandler>()(
  "@overseer/gateway/GatewayApi",
) {}

const authenticatedAccess = Layer.succeed(
  CloudflareAccess,
  CloudflareAccess.of({ cloudflareAccess: (effect) => effect }),
);

/** Construct the isolate-scoped Gateway API router. */
export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const problems = yield* ProblemResponse;
  const workspaceRegistry = yield* WorkspaceRegistryService;
  const apiLive = HttpApiBuilder.layer(OverseerApi).pipe(
    Layer.provide(discoveryHttpLayer),
    Layer.provide(workspaceHttpLayer),
    Layer.provide(projectHttpLayer),
    Layer.provide(authenticatedAccess),
    Layer.provide([Etag.layer, HttpPlatformLive, Path.layer, FileSystem.layerNoop({})]),
  );
  const handleDeclaredApi = (yield* HttpRouter.toHttpEffect(apiLive)).pipe(
    Effect.provideService(ProblemResponse, problems),
    Effect.provideService(WorkspaceRegistryService, workspaceRegistry),
  );

  const handle = Effect.fn("Gateway.handleApiRequest")(function* (requestId: RequestId) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const pathname = new URL(request.url, "https://gateway.invalid").pathname;
    const methods = allowedMethods(pathname);

    if (methods.length === 0) {
      return problems.render({
        code: "resource_not_found",
        detail: "The requested API resource does not exist.",
        requestId,
      });
    }

    if (!Arr.contains(methods, request.method)) {
      return problems.render({
        code: "method_not_allowed",
        detail: "This resource does not support the requested method.",
        headers: { allow: methods.join(", ") },
        requestId,
      });
    }

    const response = yield* handleDeclaredApi;
    if (response.status === 415) {
      return problems.render({
        code: "unsupported_media_type",
        detail: "This operation requires a supported request Content-Type.",
        requestId,
      });
    }
    if (response.status >= 400) {
      return response;
    }

    return yield* finalizeRepresentationResponse({
      request,
      requestId,
      response,
    }).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.provideService(ProblemResponse, problems),
    );
  });

  return GatewayApi.of({ handle });
});

/** Production Gateway API router layer. */
export const layer = Layer.effect(GatewayApi, make);
