import * as Cause from "effect/Cause";
import type { ConfigError } from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import type * as Scope from "effect/Scope";
import type { Catalog } from "../../application/catalog/catalog.ts";
import { CloudflareAccess } from "../../contract/http-api.ts";
import { IdempotencyPrincipal } from "../../domain/idempotency.ts";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as SchemaIssue from "effect/SchemaIssue";
import { HttpApiSchemaError } from "effect/unstable/httpapi/HttpApiError";
import {
  AccessAssertionVerifier,
  type AccessAudience,
} from "./access-principal.ts";
import type { GatewayRuntimeConfiguration } from "./gateway-configuration.ts";
import { makeApiRequestHandler } from "./gateway-http.ts";
import { GatewayRequestContext } from "./gateway-request-context.ts";
import {
  authenticationProblem,
  makeProblemResponder,
} from "./problem-response.ts";
import { parseMutationMetadata } from "./request-context.ts";
import { AuthenticatedPrincipal, RequestId } from "../../domain/actor.ts";

function isStructuralSchemaIssue(
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
): boolean {
  switch (issue._tag) {
    case "Filter":
      return path.length === 0;
    case "Pointer":
      return isStructuralSchemaIssue(issue.issue, [...path, ...issue.path]);
    case "Composite":
    case "AnyOf":
      return issue.issues.some((nested) => isStructuralSchemaIssue(nested, path));
    case "Encoding":
      return isStructuralSchemaIssue(issue.issue, path);
    default:
      return true;
  }
}

/** Build the authenticated Gateway HTTP application for one Worker isolate. */
export function makeGatewayApplication(
  configuration: GatewayRuntimeConfiguration,
  accessAudience: Effect.Effect<AccessAudience, ConfigError>,
  catalog: Catalog,
): Effect.Effect<
  Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  ConfigError,
  AccessAssertionVerifier | Scope.Scope
> {
  return Effect.gen(function* () {
    const verifier = yield* AccessAssertionVerifier;
    const audience = yield* accessAudience;
    const respond = makeProblemResponder(configuration.problemTypeBaseUrl);
    const authenticatedAccess = Layer.succeed(
      CloudflareAccess,
      CloudflareAccess.of({
        cloudflareAccess: (effect) => effect,
      }),
    );
    const handleApiRequest = yield* makeApiRequestHandler(
      respond,
      catalog,
      authenticatedAccess,
    );

    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestId = RequestId.make(crypto.randomUUID());

      const response = yield* Effect.gen(function* () {
        const assertion = Redacted.make(
          request.headers["cf-access-jwt-assertion"] ?? "",
        );
        const authentication = yield* Effect.result(
          verifier.verify(assertion, audience),
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
        if (!isSafe) {
          const source: unknown = request.source;
          const bodySize = source instanceof Request
            ? yield* Effect.promise(() =>
                source.clone().arrayBuffer().then((body) => body.byteLength)
              )
            : 0;
          if (bodySize > 2 * 1024 * 1024) {
            return HttpServerResponse.fromWeb(respond({
              code: "malformed_request",
              detail: "The request body exceeds the configured size limit.",
              requestId,
            }));
          }
        }

        const idempotencyPrincipal = IdempotencyPrincipal.make(
          AuthenticatedPrincipal.match(authentication.success, {
            HumanPrincipal: ({ subject }) => `human:${subject}`,
            AgentDeploymentPrincipal: ({ deploymentId }) =>
              `agent_deployment:${deploymentId}`,
          }),
        );
        return yield* Effect.provideService(
          handleApiRequest(requestId),
          GatewayRequestContext,
          Option.some({ idempotencyPrincipal, requestId }),
        );
      }).pipe(
        Effect.catchCause((cause) => {
          const defect = Cause.squash(cause);
          if (HttpApiSchemaError.is(defect)) {
            const formatted = SchemaIssue.makeFormatterStandardSchemaV1({
              leafHook: () => "Invalid value.",
              checkHook: () => "Invalid value.",
            })(defect.cause.issue).issues;
            const root = defect.kind === "Payload"
              ? "body"
              : defect.kind.toLowerCase();
            const isNameValidation = defect.kind === "Payload" &&
              !isStructuralSchemaIssue(defect.cause.issue);
            return Effect.succeed(HttpServerResponse.fromWeb(respond({
              code: isNameValidation ? "validation_failed" : "malformed_request",
              detail: isNameValidation
                ? "The Workspace name is invalid."
                : "The request did not match the declared API contract.",
              requestId,
              errors: formatted.map((issue) => {
                const path = issue.path ?? [];
                return {
                  code: "invalid",
                  path: `/${root}${path.length === 0 ? "" : `/${path.map(String).join("/")}`}`,
                  message: issue.message,
                };
              }),
            })));
          }
          return Effect.logError("Gateway request defect").pipe(
            Effect.annotateLogs({
              cause_type: "Cause",
              request_id: requestId,
            }),
            Effect.as(HttpServerResponse.fromWeb(respond({
              code: "internal_error",
              detail: "Overseer could not complete the request.",
              requestId,
            }))),
          );
        }),
      );

      return response;
    });
  });
}
