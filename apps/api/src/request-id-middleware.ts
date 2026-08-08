import { Effect, Layer, Option, Schema } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";
import { OverseerEnvironmentConfig } from "./overseer-environment.ts";
import {
  CurrentRequestId,
  generateOverseerRequestId,
  OVERSEER_REQUEST_ID_HEADER,
} from "./request-id.ts";

const CloudflareRayId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[!-~]+$/),
).pipe(Schema.brand("CloudflareRayId"));

const parseCloudflareRayId = Schema.decodeUnknownOption(CloudflareRayId);

type RequestIdentityAnnotations = Readonly<Record<string, string>>;

const runWithCurrentRequestId = Effect.fnUntraced(function* <A, E, R>(
  endpointEffect: Effect.Effect<A, E, R>,
  providerAnnotations: RequestIdentityAnnotations,
) {
  const requestId = yield* generateOverseerRequestId;
  const annotations = { requestId, ...providerAnnotations };

  yield* Effect.annotateCurrentSpan(annotations);
  yield* HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(HttpServerResponse.setHeader(response, OVERSEER_REQUEST_ID_HEADER, requestId)),
  );

  return yield* endpointEffect.pipe(
    Effect.provideService(CurrentRequestId, requestId),
    Effect.annotateLogs(annotations),
    Effect.annotateSpans(annotations),
  );
});

const cloudflareRequestIdentityAnnotations: Effect.Effect<
  RequestIdentityAnnotations,
  never,
  HttpServerRequest.HttpServerRequest
> = Effect.map(HttpServerRequest.HttpServerRequest, (request) => {
  const header = request.headers["cf-ray"];
  if (header === undefined) {
    return {};
  }

  return Option.match(parseCloudflareRayId(header), {
    onNone: () => ({ "cf-ray": "invalid" }),
    onSome: (cfRay) => ({ "cf-ray": cfRay }),
  });
});

/** Assigns one request ID and provides it to every Effect in the HTTP request. */
export class RequestIdMiddleware extends HttpApiMiddleware.Service<
  RequestIdMiddleware,
  { provides: CurrentRequestId }
>()("@overseer/RequestIdMiddleware") {}

/** Provides generic request ID middleware for local and provider-neutral runtimes. */
export const requestIdMiddlewareLayer = Layer.succeed(
  RequestIdMiddleware,
  RequestIdMiddleware.of((endpointEffect) => runWithCurrentRequestId(endpointEffect, {})),
);

/** Provides request ID middleware enriched with Cloudflare Ray ID observability context. */
export const cloudflareRequestIdMiddlewareLayer = Layer.succeed(
  RequestIdMiddleware,
  RequestIdMiddleware.of((endpointEffect) =>
    Effect.flatMap(cloudflareRequestIdentityAnnotations, (annotations) =>
      runWithCurrentRequestId(endpointEffect, annotations),
    ),
  ),
);

/** Selects generic or Cloudflare request ID middleware from the Overseer environment. */
export const requestIdMiddlewareLayerForEnvironment = Layer.unwrap(
  OverseerEnvironmentConfig.pipe(
    Effect.map((environment) =>
      environment === "development" ? requestIdMiddlewareLayer : cloudflareRequestIdMiddlewareLayer,
    ),
  ),
);
