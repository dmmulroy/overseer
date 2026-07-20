import * as Schema from "effect/Schema";

const visibleAscii = /^[!-~]+$/;

/** Stable principal scope used to partition idempotency keys. */
export const IdempotencyPrincipal = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(600),
).pipe(Schema.brand("IdempotencyPrincipal"));

/** Stable principal scope used to partition idempotency keys. */
export type IdempotencyPrincipal = typeof IdempotencyPrincipal.Type;

/** Caller-supplied key for replaying one ordinary POST mutation. */
export const IdempotencyKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(visibleAscii),
).pipe(Schema.brand("IdempotencyKey"));

/** Caller-supplied key for replaying one ordinary POST mutation. */
export type IdempotencyKey = typeof IdempotencyKey.Type;
