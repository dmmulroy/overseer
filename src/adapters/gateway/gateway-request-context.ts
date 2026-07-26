import * as Context from "effect/Context";
import type { RequestId } from "../../domain/actor.ts";
import type { IdempotencyScope } from "../../domain/idempotency.ts";

/** Authenticated context established for one Gateway request. */
export type GatewayRequest = {
  readonly idempotencyScope: IdempotencyScope;
  readonly requestId: RequestId;
};

/** Required fiber-local context for one authenticated Gateway request. */
export class GatewayRequestContext extends Context.Service<GatewayRequestContext, GatewayRequest>()(
  "@overseer/gateway/GatewayRequestContext",
) {}
