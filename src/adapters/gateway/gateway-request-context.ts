import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { RequestId } from "../../domain/actor.ts";
import type { IdempotencyPrincipal } from "../../domain/idempotency.ts";

/** Authenticated context established for one Gateway request. */
export type GatewayRequestContext = {
  readonly idempotencyPrincipal: IdempotencyPrincipal;
  readonly requestId: RequestId;
};

/** Fiber-local authenticated request context. */
export const GatewayRequestContext = Context.Reference<Option.Option<GatewayRequestContext>>(
  "@overseer/gateway/GatewayRequestContext",
  { defaultValue: Option.none },
);

/** Read the authenticated context established for the current request. */
export const gatewayRequestContext = GatewayRequestContext.pipe(
  Effect.flatMap(Option.match({
    onNone: () => Effect.die("Gateway request context was not established"),
    onSome: Effect.succeed,
  })),
);
