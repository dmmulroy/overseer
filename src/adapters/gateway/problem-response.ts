import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  DiscoveryMediaTypes,
  ProblemDocument,
  type Link,
  type ProblemCode,
  type ProblemStatus,
} from "../../contract/http-api.ts";
import type { RequestId } from "../../domain/actor.ts";
import { GatewayConfiguration } from "./gateway-configuration.ts";

type ProblemPolicy = {
  readonly retryable: boolean;
  readonly status: ProblemStatus;
  readonly title: string;
};

const problemPolicies: Readonly<Record<ProblemCode, ProblemPolicy>> = {
  agent_session_invalid: { retryable: false, status: 400, title: "Agent session invalid" },
  agent_session_required: { retryable: false, status: 400, title: "Agent session required" },
  authentication_required: { retryable: false, status: 401, title: "Authentication required" },
  authentication_unavailable: { retryable: true, status: 503, title: "Authentication unavailable" },
  gateway_unavailable: { retryable: true, status: 503, title: "Gateway unavailable" },
  idempotency_key_reused: { retryable: false, status: 409, title: "Idempotency key reused" },
  internal_error: { retryable: true, status: 500, title: "Internal error" },
  malformed_request: { retryable: false, status: 400, title: "Malformed request" },
  method_not_allowed: { retryable: false, status: 405, title: "Method not allowed" },
  payload_too_large: { retryable: false, status: 413, title: "Payload too large" },
  origin_not_allowed: { retryable: false, status: 403, title: "Origin not allowed" },
  response_type_not_acceptable: {
    retryable: false,
    status: 406,
    title: "Response type not acceptable",
  },
  request_body_unreadable: { retryable: false, status: 400, title: "Request body unreadable" },
  resource_not_found: { retryable: false, status: 404, title: "Resource not found" },
  service_unavailable: { retryable: true, status: 503, title: "Service unavailable" },
  unsupported_media_type: { retryable: false, status: 415, title: "Unsupported media type" },
  validation_failed: { retryable: false, status: 422, title: "Request validation failed" },
};

/** Input for rendering one safe expected problem. */
export type ProblemInput = {
  readonly code: ProblemCode;
  readonly detail: string;
  readonly requestId: RequestId;
  readonly errors?: ReadonlyArray<{
    readonly code: string;
    readonly path: string;
    readonly message: string;
  }>;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly links?: Readonly<Record<string, Link>>;
  readonly headers?: Readonly<Record<string, string>>;
};

/** Configured RFC 9457 response renderer. */
export type ProblemResponseRenderer = {
  readonly render: (input: ProblemInput) => HttpServerResponse.HttpServerResponse;
};

/** Effect service for rendering safe RFC 9457 responses. */
export class ProblemResponse extends Context.Service<ProblemResponse, ProblemResponseRenderer>()(
  "@overseer/gateway/ProblemResponse",
) {}

function makeProblemDocument(
  problemTypeBaseUrl: URL | string,
  input: ProblemInput,
): ProblemDocument {
  const policy = problemPolicies[input.code];
  const optional: {
    errors?: NonNullable<ProblemInput["errors"]>;
    details?: NonNullable<ProblemInput["details"]>;
    links?: NonNullable<ProblemInput["links"]>;
  } = {};
  if (input.errors !== undefined) optional.errors = input.errors;
  if (input.details !== undefined) optional.details = input.details;
  if (input.links !== undefined) optional.links = input.links;
  const document = {
    type: new URL(encodeURIComponent(input.code), problemTypeBaseUrl).href,
    title: policy.title,
    status: policy.status,
    detail: input.detail,
    code: input.code,
    request_id: input.requestId,
    retryable: policy.retryable,
    ...optional,
  };
  // SAFETY: problemPolicies limits status to ProblemStatus, and every other field is constructed from the ProblemDocument field types above. TypeScript cannot correlate the dynamic policy lookup with the status-discriminated union.
  return document as ProblemDocument;
}

/** Render a safe configuration-failure problem before runtime configuration is available. */
export function renderGatewayConfigurationUnavailable(
  requestId: RequestId,
): HttpServerResponse.HttpServerResponse {
  const problem = makeProblemDocument("https://overseer.invalid/problems/", {
    code: "gateway_unavailable",
    detail: "The Gateway configuration is invalid.",
    requestId,
  });
  return HttpServerResponse.jsonUnsafe(problem, {
    status: problem.status,
    headers: {
      "cache-control": "no-store",
      "content-type": DiscoveryMediaTypes.problem,
      "x-request-id": requestId,
    },
  });
}

/** Construct a problem response renderer from parsed Gateway configuration. */
export const make = Effect.gen(function* () {
  const { problemTypeBaseUrl } = yield* GatewayConfiguration;
  const document = (input: ProblemInput) => makeProblemDocument(problemTypeBaseUrl, input);
  return ProblemResponse.of({
    render: (input) => {
      const problem = document(input);
      return HttpServerResponse.jsonUnsafe(problem, {
        status: problem.status,
        headers: {
          "cache-control": "no-store",
          "content-type": DiscoveryMediaTypes.problem,
          "x-request-id": input.requestId,
          ...input.headers,
        },
      });
    },
  });
});

/** Production problem response renderer layer. */
export const layer = Layer.effect(ProblemResponse, make);
