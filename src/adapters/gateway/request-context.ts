import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import {
  AgentSessionId,
  AuthenticatedPrincipal,
  HarnessName,
  type RequestId,
} from "../../domain/actor.ts";
import type { ProblemResponder } from "./problem-response.ts";

/** Untrusted Agent-session correlation metadata parsed at HTTP ingress. */
export const AgentSession = Schema.Struct({
  sessionId: AgentSessionId,
  harness: Schema.NullOr(HarnessName),
});

/** Untrusted Agent-session correlation metadata parsed at HTTP ingress. */
export interface AgentSession extends Schema.Schema.Type<typeof AgentSession> {}

/** Successful mutation metadata established by the Gateway. */
export type MutationMetadata = {
  readonly agentSession: AgentSession | null;
};

function parseHumanMutationMetadata(
  request: HttpServerRequest,
  allowedOrigin: URL,
  requestId: RequestId,
  respond: ProblemResponder,
): MutationMetadata | Response {
  if (request.headers.origin !== allowedOrigin.origin) {
    return respond({
      code: "origin_not_allowed",
      detail: "The request Origin is not allowed for this stage.",
      requestId,
    });
  }

  return { agentSession: null };
}

function parseAgentMutationMetadata(
  request: HttpServerRequest,
  requestId: RequestId,
  respond: ProblemResponder,
): MutationMetadata | Response {
  const sessionId = request.headers["overseer-session-id"];

  if (sessionId === undefined) {
    return respond({
      code: "agent_session_required",
      detail: "Agent mutations require Overseer-Session-Id.",
      requestId,
    });
  }

  const parsedSessionId = Schema.decodeUnknownOption(AgentSessionId)(sessionId);
  const harness = request.headers["overseer-harness"];
  const parsedHarness = harness === undefined
    ? Option.none<HarnessName>()
    : Schema.decodeUnknownOption(HarnessName)(harness);

  if (
    Option.isNone(parsedSessionId) ||
    (harness !== undefined && Option.isNone(parsedHarness))
  ) {
    return respond({
      code: "agent_session_invalid",
      detail: "Agent-session metadata must be bounded visible ASCII.",
      requestId,
    });
  }

  return {
    agentSession: AgentSession.make({
      sessionId: parsedSessionId.value,
      harness: Option.getOrNull(parsedHarness),
    }),
  };
}

/** Enforce human Origin or parse required Agent-session metadata for unsafe requests. */
export function parseMutationMetadata(
  request: HttpServerRequest,
  principal: AuthenticatedPrincipal,
  allowedOrigin: URL,
  requestId: RequestId,
  respond: ProblemResponder,
): MutationMetadata | Response {
  return AuthenticatedPrincipal.match(principal, {
    HumanPrincipal: () =>
      parseHumanMutationMetadata(request, allowedOrigin, requestId, respond),
    AgentDeploymentPrincipal: () =>
      parseAgentMutationMetadata(request, requestId, respond),
  });
}
