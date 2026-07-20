import * as Schema from "effect/Schema";

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

/** Stable credential identity for one Agent deployment. */
export const AgentDeploymentId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(visibleAscii),
).pipe(Schema.brand("AgentDeploymentId"));

/** Stable credential identity for one Agent deployment. */
export type AgentDeploymentId = typeof AgentDeploymentId.Type;

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
export const RequestId = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("RequestId"),
);

/** Gateway-generated request correlation identity. */
export type RequestId = typeof RequestId.Type;

/** A principal established by a validated Cloudflare Access assertion. */
export const AuthenticatedPrincipal = Schema.TaggedUnion({
  HumanPrincipal: {
    subject: HumanPrincipalId,
    email: EmailAddress,
  },
  AgentDeploymentPrincipal: {
    deploymentId: AgentDeploymentId,
  },
});

/** A principal established by a validated Cloudflare Access assertion. */
export type AuthenticatedPrincipal = typeof AuthenticatedPrincipal.Type;
