import * as Schema from "effect/Schema";
import { Ulid } from "./ulid.ts";

const visibleAscii = /^[!-~]+$/;

/** Stable identity for the authenticated human principal. */
export const HumanPrincipalId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
).pipe(Schema.brand("HumanPrincipalId"));

/** Stable identity for the authenticated human principal. */
export type HumanPrincipalId = typeof HumanPrincipalId.Type;

/** Identity-provider-verified human email address. */
export const EmailAddress = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(320),
  Schema.isPattern(/^[^\s@]+@[^\s@]+$/),
).pipe(Schema.brand("EmailAddress"));

/** Identity-provider-verified human email address. */
export type EmailAddress = typeof EmailAddress.Type;

/** Stable credential identity for one authenticated Agent. */
export const AgentId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(visibleAscii),
).pipe(Schema.brand("AgentId"));

/** Stable credential identity for one authenticated Agent. */
export type AgentId = typeof AgentId.Type;

/** Caller-provided correlation identity for one Agent session. */
export const AgentSessionId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(visibleAscii),
).pipe(Schema.brand("AgentSessionId"));

/** Caller-provided correlation identity for one Agent session. */
export type AgentSessionId = typeof AgentSessionId.Type;

/** Optional caller-provided Agent harness name. */
export const HarnessName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(visibleAscii),
).pipe(Schema.brand("HarnessName"));

/** Optional caller-provided Agent harness name. */
export type HarnessName = typeof HarnessName.Type;

/** Gateway-generated request correlation identity. */
export const RequestId = Schema.TemplateLiteral(["request_", Ulid]).pipe(Schema.brand("RequestId"));

/** Gateway-generated request correlation identity. */
export type RequestId = typeof RequestId.Type;

/** Prefix a ULID for use as a request correlation identity. */
export function makeRequestId(ulid: Ulid): RequestId {
  return RequestId.make(`request_${ulid}`);
}

/** A principal established by a validated Cloudflare Access assertion. */
export const AuthenticatedPrincipal = Schema.TaggedUnion({
  HumanPrincipal: {
    subject: HumanPrincipalId,
    email: EmailAddress,
  },
  AgentPrincipal: {
    agentId: AgentId,
  },
});

/** A principal established by a validated Cloudflare Access assertion. */
export type AuthenticatedPrincipal = typeof AuthenticatedPrincipal.Type;

/** Immutable principal snapshot attributed to a committed change. */
export const Actor = Schema.TaggedUnion({
  HumanActor: {
    subject: HumanPrincipalId,
    email: EmailAddress,
  },
  AgentActor: {
    agentId: AgentId,
  },
});

/** Immutable principal snapshot attributed to a committed change. */
export type Actor = typeof Actor.Type;

/** Untrusted Agent session metadata captured separately from authority. */
export const AgentSession = Schema.Struct({
  sessionId: AgentSessionId,
  harness: Schema.NullOr(HarnessName),
});

/** Untrusted Agent session metadata captured separately from authority. */
export interface AgentSession extends Schema.Schema.Type<typeof AgentSession> {}

/** Immutable attribution captured with one committed command. */
export const CommandAttribution = Schema.Struct({
  actor: Actor,
  agentSession: Schema.NullOr(AgentSession),
  requestId: RequestId,
});

/** Immutable attribution captured with one committed command. */
export interface CommandAttribution extends Schema.Schema.Type<typeof CommandAttribution> {}
