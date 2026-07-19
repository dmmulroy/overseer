import type { AuthenticatedPrincipal } from "../../domain/actor.ts";
import { problemResponse } from "./problem-response.ts";

/** Untrusted Agent-session correlation metadata parsed at HTTP ingress. */
export type AgentSession = {
  readonly sessionId: string;
  readonly harness: string | null;
};

/** Successful mutation metadata established by the Gateway. */
export type MutationMetadata = {
  readonly agentSession: AgentSession | null;
};

function isVisibleAscii(value: string, maximum: number): boolean {
  return value.length > 0 &&
    value.length <= maximum &&
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e;
    });
}

/** Enforce human Origin or parse required Agent-session metadata for unsafe requests. */
export function parseMutationMetadata(
  request: Request,
  principal: AuthenticatedPrincipal,
  allowedOrigin: string,
  requestId: string,
): MutationMetadata | Response {
  if (principal._tag === "HumanPrincipal") {
    if (request.headers.get("origin") !== allowedOrigin) {
      return problemResponse({
        code: "origin_not_allowed",
        detail: "The request Origin is not allowed for this stage.",
        requestId,
        status: 403,
        title: "Origin not allowed",
      });
    }
    return { agentSession: null };
  }

  const sessionId = request.headers.get("overseer-session-id");
  if (sessionId === null) {
    return problemResponse({
      code: "agent_session_required",
      detail: "Agent mutations require Overseer-Session-Id.",
      requestId,
      status: 400,
      title: "Agent session required",
    });
  }
  const harness = request.headers.get("overseer-harness");
  if (
    !isVisibleAscii(sessionId, 128) ||
    (harness !== null && !isVisibleAscii(harness, 64))
  ) {
    return problemResponse({
      code: "agent_session_invalid",
      detail: "Agent-session metadata must be bounded visible ASCII.",
      requestId,
      status: 400,
      title: "Agent session invalid",
    });
  }
  return { agentSession: { sessionId, harness } };
}
