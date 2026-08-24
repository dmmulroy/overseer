import { Schema } from "effect";

/**
 * Stable Agent credential identity containing 1–256 visible ASCII characters.
 *
 * @example Valid: `agent-codex-01`
 * @example Invalid: `agent codex 01` (spaces are outside the accepted visible ASCII range)
 */
export const AgentId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(/^[!-~]+$/),
).pipe(Schema.brand("AgentId"));

/** A validated Agent credential identity. */
export type AgentId = typeof AgentId.Type;

/**
 * Stable human subject from a validated Cloudflare Access JWT `sub` claim.
 *
 * @example Valid: `8ca4f860-9f4f-4f3b-bf62-4524a30f5c11`
 * @example Invalid: `` (the subject cannot be empty)
 */
export const CloudflareAccessSubject = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
).pipe(Schema.brand("CloudflareAccessSubject"));

/** A validated Cloudflare Access human subject. */
export type CloudflareAccessSubject = typeof CloudflareAccessSubject.Type;

/**
 * Email address containing one `@`, no whitespace, and at most 320 characters.
 *
 * @example Valid: `alice@example.com`
 * @example Invalid: `alice.example.com` (missing `@`)
 */
export const EmailAddress = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(320),
  Schema.isPattern(/^[^\s@]+@[^\s@]+$/),
).pipe(Schema.brand("EmailAddress"));

/** A validated email address. */
export type EmailAddress = typeof EmailAddress.Type;

const HumanActor = Schema.Struct({
  kind: Schema.tag("human"),
  subject: CloudflareAccessSubject,
  email: EmailAddress,
});

const AgentActor = Schema.Struct({
  kind: Schema.tag("agent"),
  agentId: AgentId,
});

/** System identity allowed to cause operations without a human or Agent request. */
export const SystemActorId = Schema.Literals([
  "overseer-scheduler",
  "workspace-alarm",
  "project-alarm",
]);

/** Known system identity that can cause an Overseer operation. */
export type SystemActorId = typeof SystemActorId.Type;

const SystemActor = Schema.Struct({
  kind: Schema.tag("system"),
  systemId: SystemActorId,
});

/** Immutable human, Agent, or system identity attributed to an Overseer operation. */
export const Actor = Schema.Union([HumanActor, AgentActor, SystemActor]).pipe(
  Schema.toTaggedUnion("kind"),
);

/** Immutable domain identity attributed to an Overseer operation. */
export type Actor = typeof Actor.Type;
