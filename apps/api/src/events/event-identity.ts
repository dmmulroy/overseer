import { Effect, Schema } from "effect";
import { generateUlid, Ulid } from "../domain/ulid.ts";

/** Globally unique identity assigned to one immutable Overseer event. */
export const OverseerEventId = Schema.TemplateLiteral(["event_", Ulid]).pipe(
  Schema.brand("OverseerEventId"),
);

/** Globally unique identity of an immutable Overseer event. */
export type OverseerEventId = typeof OverseerEventId.Type;

/** Monotonically increasing version of one entity's event history. */
export const EntityEventVersion = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(
  Schema.brand("EntityEventVersion"),
);

/** Positive version that authoritatively orders events for one entity. */
export type EntityEventVersion = typeof EntityEventVersion.Type;

/** Generate a globally unique event identity from the active Effect clock and random services. */
export const generateOverseerEventId: Effect.Effect<OverseerEventId> = generateUlid.pipe(
  Effect.map((ulid) => OverseerEventId.make(`event_${ulid}`)),
  Effect.withSpan("OverseerEventId.generate"),
);
