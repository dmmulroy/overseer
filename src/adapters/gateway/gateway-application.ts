import type { ConfigError } from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import type * as Scope from "effect/Scope";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  AccessAssertionVerifier,
  type AccessAudience,
} from "./access-principal.ts";
import type { GatewayRuntimeConfiguration } from "./gateway-configuration.ts";
import { makeApiRequestHandler } from "./gateway-http.ts";
import {
  authenticationProblem,
  makeProblemResponder,
} from "./problem-response.ts";
import { parseMutationMetadata } from "./request-context.ts";
import { RequestId } from "../../domain/actor.ts";

/** Build the authenticated Gateway HTTP application for one Worker isolate. */
export function makeGatewayApplication(
  configuration: GatewayRuntimeConfiguration,
  accessAudience: Effect.Effect<AccessAudience, ConfigError>,
): Effect.Effect<
  Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  never,
  AccessAssertionVerifier | Scope.Scope
> {
  return Effect.gen(function* () {
    const verifier = yield* AccessAssertionVerifier;
    const respond = makeProblemResponder(configuration.problemTypeBaseUrl);
    const handleApiRequest = yield* makeApiRequestHandler(respond);

    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestId = RequestId.make(crypto.randomUUID());

      const response = yield* Effect.gen(function* () {
        const decodedAudience = yield* Effect.result(accessAudience);

        if (Result.isFailure(decodedAudience)) {
          yield* Effect.logError("Gateway configuration invalid").pipe(
            Effect.annotateLogs({
              error_type: decodedAudience.failure._tag,
              request_id: requestId,
            }),
          );

          return HttpServerResponse.fromWeb(respond({
            code: "gateway_unavailable",
            detail: "The Gateway configuration is invalid.",
            requestId,
          }));
        }

        const assertion = Redacted.make(
          request.headers["cf-access-jwt-assertion"] ?? "",
        );
        const authentication = yield* Effect.result(
          verifier.verify(assertion, decodedAudience.success),
        );

        if (Result.isFailure(authentication)) {
          return HttpServerResponse.fromWeb(
            authentication.failure.reason === "verification_unavailable"
              ? respond({
                  code: "authentication_unavailable",
                  detail: "Overseer could not verify the Access assertion.",
                  requestId,
                })
              : authenticationProblem(respond, requestId),
          );
        }

        const isSafe = request.method === "GET" ||
          request.method === "HEAD" ||
          request.method === "OPTIONS";
        const mutationMetadata = isSafe
          ? { agentSession: null }
          : parseMutationMetadata(
              request,
              authentication.success,
              configuration.allowedOrigin,
              requestId,
              respond,
            );

        if (mutationMetadata instanceof Response) {
          return HttpServerResponse.fromWeb(mutationMetadata);
        }

        return yield* handleApiRequest(requestId);
      }).pipe(
        Effect.catchCause((_cause) =>
          Effect.logError("Gateway request defect").pipe(
            Effect.annotateLogs({
              cause_type: "Cause",
              request_id: requestId,
            }),
            Effect.as(HttpServerResponse.fromWeb(respond({
              code: "internal_error",
              detail: "Overseer could not complete the request.",
              requestId,
            }))),
          )
        ),
      );

      return response;
    });
  });
}
