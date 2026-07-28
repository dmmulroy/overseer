import * as Context from "effect/Context";
import type { Actor, AgentSession, RequestId } from "../../domain/actor.ts";

/** Authenticated and attributed context established for one Gateway request. */
export type GatewayRequest = {
  readonly requestId: RequestId;
  readonly actor: Actor;
  readonly agentSession: AgentSession | null;
};

/** Required fiber-local context for one authenticated Gateway request. */
export class GatewayRequestContext extends Context.Service<GatewayRequestContext, GatewayRequest>()(
  "@overseer/gateway/GatewayRequestContext",
) {}
