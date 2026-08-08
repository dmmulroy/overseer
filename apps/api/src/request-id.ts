import { Context, Effect, Schema } from "effect";
import { generateUlid, Ulid } from "./domain/ulid.ts";

/** Unique application correlation identity assigned once to an Overseer HTTP request. */
export const OverseerRequestId = Schema.TemplateLiteral(["request_", Ulid]).pipe(
  Schema.brand("OverseerRequestId"),
  Schema.annotateEncoded({
    description: "Application request correlation ID for support, logs, and traces.",
    examples: ["request_01KZGWMQ4054AXZGW9RR1VJ3JM"],
  }),
);

/** A validated application correlation identity for one Overseer HTTP request. */
export type OverseerRequestId = typeof OverseerRequestId.Type;

/** Response header that exposes the Overseer request correlation identity. */
export const OVERSEER_REQUEST_ID_HEADER = "X-Overseer-Request-Id";

/** Generate an Overseer request ID independently of provider request identifiers. */
export const generateOverseerRequestId: Effect.Effect<OverseerRequestId> = generateUlid.pipe(
  Effect.map((ulid) => OverseerRequestId.make(`request_${ulid}`)),
  Effect.withSpan("OverseerRequestId.generate"),
);

/** Provides the application correlation identity assigned to the current HTTP request. */
export class CurrentRequestId extends Context.Service<CurrentRequestId, OverseerRequestId>()(
  "@overseer/CurrentRequestId",
) {}
