import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import type { AgentActor, AgentSession, HumanActor, RequestId } from "../../domain/actor.ts";

/** Authenticated and attributed context established for a human or Agent request. */
export type GatewayRequest = Data.TaggedEnum<{
  HumanRequest: {
    readonly requestId: RequestId;
    readonly actor: HumanActor;
  };
  AgentRequest: {
    readonly requestId: RequestId;
    readonly actor: AgentActor;
    readonly agentSession: Option.Option<AgentSession>;
  };
}>;

/** Construct and exhaustively match authenticated Gateway request context. */
export const GatewayRequest = Data.taggedEnum<GatewayRequest>();

/** Return Agent session metadata when the authenticated request supplied it. */
export function gatewayRequestAgentSession(request: GatewayRequest): Option.Option<AgentSession> {
  return GatewayRequest.$match(request, {
    HumanRequest: () => Option.none(),
    AgentRequest: ({ agentSession }) => agentSession,
  });
}

/** Required fiber-local context for one authenticated Gateway request. */
export class GatewayRequestContext extends Context.Service<GatewayRequestContext, GatewayRequest>()(
  "@overseer/gateway/GatewayRequestContext",
) {}
