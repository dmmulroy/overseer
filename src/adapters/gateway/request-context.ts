import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AgentSessionId,
  HarnessName,
  AuthenticatedPrincipal,
  type RequestId,
} from "../../domain/actor.ts";
import { problemResponse } from "./problem-response.ts";

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
  request: Request,
  allowedOrigin: URL,
  requestId: RequestId,
): MutationMetadata | Response {
  if (request.headers.get("origin") !== allowedOrigin.origin) {
    return problemResponse({
      code: "origin_not_allowed",
      detail: "The request Origin is not allowed for this stage.",
      requestId,
    });
  }
  return { agentSession: null };
}

function parseAgentMutationMetadata(
  request: Request,
  requestId: RequestId,
): MutationMetadata | Response {
  const sessionId = request.headers.get("overseer-session-id");
  if (sessionId === null) {
    return problemResponse({
      code: "agent_session_required",
      detail: "Agent mutations require Overseer-Session-Id.",
      requestId,
    });
  }
  const parsedSessionId = Schema.decodeUnknownOption(AgentSessionId)(sessionId);
  const harness = request.headers.get("overseer-harness");
  const parsedHarness = harness === null
    ? Option.none<HarnessName>()
    : Schema.decodeUnknownOption(HarnessName)(harness);
  if (Option.isNone(parsedSessionId) || (harness !== null && Option.isNone(parsedHarness))) {
    return problemResponse({
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
  request: Request,
  principal: AuthenticatedPrincipal,
  allowedOrigin: URL,
  requestId: RequestId,
): MutationMetadata | Response {
  return AuthenticatedPrincipal.match(principal, {
    HumanPrincipal: () => parseHumanMutationMetadata(request, allowedOrigin, requestId),
    AgentDeploymentPrincipal: () => parseAgentMutationMetadata(request, requestId),
  });
}
