import * as Schema from "effect/Schema";

const visibleAscii = /^[!-~]+$/;

/** Stable scope that partitions idempotency keys between authenticated callers. */
export const IdempotencyScope = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(600),
).pipe(Schema.brand("IdempotencyScope"));

/** Stable scope that partitions idempotency keys between authenticated callers. */
export type IdempotencyScope = typeof IdempotencyScope.Type;

/** Caller-supplied key for replaying one ordinary POST mutation. */
export const IdempotencyKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(visibleAscii),
).pipe(Schema.brand("IdempotencyKey"));

/** Caller-supplied key for replaying one ordinary POST mutation. */
export type IdempotencyKey = typeof IdempotencyKey.Type;
