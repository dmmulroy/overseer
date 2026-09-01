import { Effect, Schema } from "effect";
import { Actor } from "../domain/actor.ts";
import { OverseerEventId } from "./event-identity.ts";
import { OverseerEventMetadata } from "./event-origin.ts";

/** Version of the common encoded Overseer event envelope. */
export const OverseerEventEnvelopeVersion = Schema.Literal(1).pipe(
  Schema.withConstructorDefault(Effect.succeed(1)),
);

/** Overseer component that originally emitted an event. */
export const OverseerEventSource = Schema.Literals([
  "overseer.api",
  "overseer.workspace-durable-object",
  "overseer.project-durable-object",
]);

/** Known Overseer event producer. */
export type OverseerEventSource = typeof OverseerEventSource.Type;

/** Envelope fields shared by every versioned Overseer event. */
export const OverseerEventEnvelopeFields = Schema.Struct({
  envelopeVersion: OverseerEventEnvelopeVersion,
  eventId: OverseerEventId,
  source: OverseerEventSource,
  timestamp: Schema.DateTimeUtcFromMillis,
  actor: Actor,
  metadata: OverseerEventMetadata,
});
