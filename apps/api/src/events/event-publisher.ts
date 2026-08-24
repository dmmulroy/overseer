import { Context, Effect, Schema } from "effect";
import { OverseerEventId } from "./event-identity.ts";
import type { OverseerEvent } from "./overseer-event.ts";

/** Classified reason that durable event publication did not complete. */
export const PublishOverseerEventFailureReason = Schema.Literals([
  "ingestion_rejected",
  "ingestion_unavailable",
]);

/** Classified reason that durable event publication did not complete. */
export type PublishOverseerEventFailureReason = typeof PublishOverseerEventFailureReason.Type;

/** Expected failure while publishing one immutable Overseer event. */
export class PublishOverseerEventError extends Schema.TaggedError<PublishOverseerEventError>()(
  "PublishOverseerEventError",
  {
    eventId: OverseerEventId,
    reason: PublishOverseerEventFailureReason,
  },
) {
  /** Searchable safe explanation and recovery guidance for the publication failure. */
  override get message(): string {
    switch (this.reason) {
      case "ingestion_rejected":
        return `Overseer event publication rejected for ${this.eventId}; inspect the event contract before retrying`;
      case "ingestion_unavailable":
        return `Overseer event publication unavailable for ${this.eventId}; retry the same event identity`;
    }
  }
}

/** Publishes parsed Overseer events to durable event ingestion. */
export interface IOverseerEventPublisher {
  /** Preserve the event identity and source timestamp while durably publishing one event. */
  readonly publishOverseerEvent: (
    event: OverseerEvent,
  ) => Effect.Effect<void, PublishOverseerEventError>;
}

/** Provides the contextual Overseer event-publishing capability without selecting an implementation. */
export class OverseerEventPublisher extends Context.Service<
  OverseerEventPublisher,
  IOverseerEventPublisher
>()("@overseer/OverseerEventPublisher") {}
