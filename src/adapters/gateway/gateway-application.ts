import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";
import { HttpApiSchemaError } from "effect/unstable/httpapi/HttpApiError";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { UlidGeneratorService } from "../../application/ulid-generator.ts";
import {
  actorFromAuthenticatedPrincipal,
  makeRequestId,
  type RequestId,
} from "../../domain/actor.ts";
import { AccessAssertionVerifier } from "./access-principal.ts";
import { GatewayConfiguration } from "./gateway-configuration.ts";
import { GatewayApi } from "./gateway-http.ts";
import { GatewayRequest, GatewayRequestContext } from "./gateway-request-context.ts";
import { ProblemResponse } from "./problem-response.ts";
import { admitMutationRequest, type MutationAdmission } from "./request-context.ts";

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

type RequestBodyStatus = "accepted" | "too_large" | "unreadable";

const inspectRequestBody = Effect.fn("Gateway.inspectRequestBody")(function* (
  request: HttpServerRequest.HttpServerRequest,
): Effect.fn.Return<RequestBodyStatus> {
  if (request.source instanceof Request === false) {
    return "accepted";
  }
  const body = request.source.clone().body;
  if (body === null) {
    return "accepted";
  }

  let bodySize = 0;
  const bodyRead = yield* Effect.result(
    Stream.fromReadableStream({
      evaluate: () => body,
      onError: (cause) => cause,
    }).pipe(
      Stream.runForEachWhile((chunk) =>
        Effect.sync(() => {
          bodySize += chunk.byteLength;
          return bodySize <= 2 * 1024 * 1024;
        }),
      ),
    ),
  );
  if (Result.isFailure(bodyRead)) {
    return "unreadable";
  }
  return bodySize > 2 * 1024 * 1024 ? "too_large" : "accepted";
});

function schemaFailureResponse(
  defect: HttpApiSchemaError,
  requestId: RequestId,
  problems: ProblemResponse["Service"],
): HttpServerResponse.HttpServerResponse {
  const formatted = SchemaIssue.makeFormatterStandardSchemaV1({
    leafHook: () => "Invalid value.",
    checkHook: () => "Invalid value.",
  })(defect.cause.issue).issues;
  const root = defect.kind === "Payload" ? "body" : defect.kind.toLowerCase();
  const isFieldValidation =
    defect.kind === "Payload" && !isStructuralSchemaIssue(defect.cause.issue);
  return problems.render({
    code: isFieldValidation ? "validation_failed" : "malformed_request",
    detail: isFieldValidation
      ? "A request field value is invalid."
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
  });
}

/** Authenticated Gateway application exposed to the Alchemy Worker. */
export type GatewayApplicationService = {
  readonly fetch: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >;
};

/** Effect service for the authenticated Gateway application. */
export class GatewayApplication extends Context.Service<
  GatewayApplication,
  GatewayApplicationService
>()("@overseer/gateway/GatewayApplication") {}

/** Construct the authenticated Gateway application. */
export const make = Effect.gen(function* () {
  const configuration = yield* GatewayConfiguration;
  const verifier = yield* AccessAssertionVerifier;
  const api = yield* GatewayApi;
  const problems = yield* ProblemResponse;
  const ulids = yield* UlidGeneratorService;

  const fetch = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const requestId = makeRequestId(yield* ulids.next());

    return yield* Effect.gen(function* () {
      const assertion = Redacted.make(request.headers["cf-access-jwt-assertion"] ?? "");
      const authentication = yield* Effect.result(verifier.verify(assertion));

      if (Result.isFailure(authentication)) {
        if (authentication.failure.reason === "verification_unavailable") {
          return yield* Effect.logError("Gateway authentication verification unavailable").pipe(
            Effect.annotateLogs({
              error_type: authentication.failure._tag,
              failure_reason: authentication.failure.reason,
              request_id: requestId,
            }),
            Effect.as(
              problems.render({
                code: "authentication_unavailable",
                detail: "Overseer could not verify the Access assertion.",
                requestId,
              }),
            ),
          );
        }
        return problems.render({
          code: "authentication_required",
          detail: "A valid Cloudflare Access assertion is required.",
          requestId,
          headers: { "www-authenticate": "Cloudflare-Access" },
        });
      }

      const isSafe =
        request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
      const mutationAdmission = isSafe
        ? Option.none<MutationAdmission>()
        : Option.some(
            yield* admitMutationRequest(
              request,
              authentication.success,
              configuration.allowedOrigin,
              requestId,
            ).pipe(Effect.provideService(ProblemResponse, problems)),
          );

      if (
        Option.isSome(mutationAdmission) &&
        HttpServerResponse.isHttpServerResponse(mutationAdmission.value)
      ) {
        return mutationAdmission.value;
      }

      const actor = actorFromAuthenticatedPrincipal(authentication.success);
      const agentSession = Option.flatMap(mutationAdmission, (admission) => {
        if (HttpServerResponse.isHttpServerResponse(admission)) return Option.none();
        return admission._tag === "AgentMutation"
          ? Option.some(admission.agentSession)
          : Option.none();
      });
      const gatewayRequest =
        actor._tag === "HumanActor"
          ? GatewayRequest.HumanRequest({ requestId, actor })
          : GatewayRequest.AgentRequest({ requestId, actor, agentSession });

      if (!isSafe) {
        const bodyStatus = yield* inspectRequestBody(request);
        if (bodyStatus !== "accepted") {
          return problems.render({
            code: bodyStatus === "unreadable" ? "request_body_unreadable" : "payload_too_large",
            detail:
              bodyStatus === "unreadable"
                ? "The request body could not be read."
                : "The request body exceeds the configured size limit.",
            requestId,
          });
        }
      }

      return yield* api
        .handle(requestId)
        .pipe(
          Effect.provideService(GatewayRequestContext, GatewayRequestContext.of(gatewayRequest)),
        );
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause)) {
          return Effect.interrupt;
        }
        const defect = Cause.squash(cause);
        if (HttpApiSchemaError.is(defect) && defect.kind !== "Body") {
          return Effect.succeed(schemaFailureResponse(defect, requestId, problems));
        }
        if (HttpApiSchemaError.is(defect)) {
          return Effect.logError("Gateway response body encoding failed").pipe(
            Effect.annotateLogs({
              error_type: defect._tag,
              schema_component: defect.kind,
              request_id: requestId,
            }),
            Effect.as(
              problems.render({
                code: "internal_error",
                detail: "Overseer could not encode the response.",
                requestId,
              }),
            ),
          );
        }
        return Effect.logError("Gateway unexpected request defect").pipe(
          Effect.annotateLogs({
            error_type: "UnexpectedGatewayDefect",
            request_id: requestId,
          }),
          Effect.as(
            problems.render({
              code: "internal_error",
              detail: "Overseer could not complete the request.",
              requestId,
            }),
          ),
        );
      }),
    );
  });

  return GatewayApplication.of({ fetch });
});

/** Production authenticated Gateway application layer. */
export const layer = Layer.effect(GatewayApplication, make);
