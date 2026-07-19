import type { JWTPayload } from "jose";

/** A principal established by a validated Cloudflare Access assertion. */
export type AuthenticatedPrincipal =
  | {
      readonly _tag: "HumanPrincipal";
      readonly subject: string;
      readonly email: string;
    }
  | {
      readonly _tag: "AgentDeploymentPrincipal";
      readonly clientId: string;
    };

/** Failure to parse identity claims from an otherwise valid Access assertion. */
export class InvalidAccessIdentity extends Error {
  /** Stable discriminant for identity-claim failures. */
  readonly _tag = "InvalidAccessIdentity" as const;

  /** Machine-readable reason the verified claims do not identify a principal. */
  readonly reason:
    | "missing_human_claims"
    | "missing_agent_client_id"
    | "unsupported_token_type";

  /** Construct an identity-claim parsing failure. */
  constructor(reason: InvalidAccessIdentity["reason"]) {
    super("The Access assertion does not identify a supported principal");
    this.reason = reason;
  }
}

/** Parse verified Access claims into an Overseer principal. */
export function parseAccessIdentity(
  claims: JWTPayload,
): AuthenticatedPrincipal | InvalidAccessIdentity {
  if (claims.type !== "app") {
    return new InvalidAccessIdentity("unsupported_token_type");
  }

  if (
    typeof claims.common_name === "string" &&
    (claims.sub === undefined || claims.sub === "")
  ) {
    const clientId = claims.common_name.trim();
    return clientId.length > 0
      ? { _tag: "AgentDeploymentPrincipal", clientId }
      : new InvalidAccessIdentity("missing_agent_client_id");
  }

  if (
    typeof claims.sub === "string" &&
    claims.sub.length > 0 &&
    typeof claims.email === "string" &&
    claims.email.includes("@") &&
    !claims.email.includes(" ")
  ) {
    return {
      _tag: "HumanPrincipal",
      subject: claims.sub,
      email: claims.email,
    };
  }

  return new InvalidAccessIdentity("missing_human_claims");
}
