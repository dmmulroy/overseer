import { Schema } from "effect";
import { OverseerRequestId } from "../request-id.ts";

const EventScheduleName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));

const EventDurableObjectId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

const HttpEventOrigin = Schema.Struct({
  kind: Schema.tag("http"),
  requestId: OverseerRequestId,
});

const CronEventOrigin = Schema.Struct({
  kind: Schema.tag("cron"),
  scheduleName: EventScheduleName,
});

const DurableObjectAlarmEventOrigin = Schema.Struct({
  kind: Schema.tag("durable-object-alarm"),
  durableObjectId: EventDurableObjectId,
});

const InternalEventOrigin = Schema.Struct({
  kind: Schema.tag("internal"),
});

/** HTTP, cron, Durable Object alarm, or internal trigger that caused an event. */
export const OverseerEventOrigin = Schema.Union([
  HttpEventOrigin,
  CronEventOrigin,
  DurableObjectAlarmEventOrigin,
  InternalEventOrigin,
]).pipe(Schema.toTaggedUnion("kind"));

/** Parsed execution trigger attached to an Overseer event. */
export type OverseerEventOrigin = typeof OverseerEventOrigin.Type;

/** Non-domain execution provenance attached to an Overseer event. */
export const OverseerEventMetadata = Schema.Struct({
  origin: OverseerEventOrigin,
});

/** Parsed execution provenance attached to an Overseer event. */
export type OverseerEventMetadata = typeof OverseerEventMetadata.Type;
