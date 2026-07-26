import * as Schema from "effect/Schema";

const visibleAscii = /^[!-~]+$/;

/** Caller-supplied key identifying the first successful create result in an authoritative object. */
export const IdempotencyKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(visibleAscii),
).pipe(Schema.brand("IdempotencyKey"));

/** Caller-supplied key identifying the first successful create result in an authoritative object. */
export type IdempotencyKey = typeof IdempotencyKey.Type;
