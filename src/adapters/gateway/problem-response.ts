import {
  DiscoveryMediaTypes,
  ProblemDocument,
  type ProblemCode,
  type ProblemStatus,
} from "../../contract/http-api.ts";
import type { RequestId } from "../../domain/actor.ts";

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
  internal_error: { retryable: true, status: 500, title: "Internal error" },
  method_not_allowed: { retryable: false, status: 405, title: "Method not allowed" },
  origin_not_allowed: { retryable: false, status: 403, title: "Origin not allowed" },
  representation_not_acceptable: {
    retryable: false,
    status: 406,
    title: "Representation not acceptable",
  },
  resource_not_found: { retryable: false, status: 404, title: "Resource not found" },
};

/** Input for one safe expected-problem projection. */
export type ProblemInput = {
  readonly code: ProblemCode;
  readonly detail: string;
  readonly requestId: RequestId;
  readonly headers?: Readonly<Record<string, string>>;
};

/** Render an expected failure as an RFC 9457 problem. */
export function problemResponse(input: ProblemInput): Response {
  const policy = problemPolicies[input.code];
  const problem = ProblemDocument.make({
    type: `https://overseer.dev/problems/${input.code}`,
    title: policy.title,
    status: policy.status,
    detail: input.detail,
    code: input.code,
    request_id: input.requestId,
    retryable: policy.retryable,
  });
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      "cache-control": "no-store",
      "content-type": DiscoveryMediaTypes.problem,
      "x-request-id": input.requestId,
      ...input.headers,
    },
  });
}

/** Render a safe authentication problem. */
export function authenticationProblem(requestId: RequestId): Response {
  return problemResponse({
    code: "authentication_required",
    detail: "A valid Cloudflare Access assertion is required.",
    requestId,
    headers: { "www-authenticate": "Cloudflare-Access" },
  });
}
