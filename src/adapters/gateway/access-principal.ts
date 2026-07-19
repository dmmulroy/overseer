import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as JoseErrors,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";
import * as Schema from "effect/Schema";
import {
  InvalidAccessIdentity,
  parseAccessIdentity,
  type AuthenticatedPrincipal,
} from "../../domain/actor.ts";

/** Parsed configuration needed to validate Access assertions. */
export type AccessConfiguration = {
  readonly audience: string;
  readonly issuer: string;
  readonly jwks: JSONWebKeySet | null;
};

/** A known Access authentication failure. */
export class AccessAuthenticationFailed extends Schema.TaggedErrorClass<AccessAuthenticationFailed>()(
  "AccessAuthenticationFailed",
  {
    reason: Schema.Literals([
      "missing_assertion",
      "invalid_assertion",
      "invalid_identity",
    ]),
    cause: Schema.Defect(),
  },
) {}

/** Verify a Cloudflare Access JWT and parse its principal. */
export async function verifyAccessAssertion(
  assertion: string | null,
  config: AccessConfiguration,
): Promise<AuthenticatedPrincipal | AccessAuthenticationFailed> {
  if (assertion === null || assertion.length === 0) {
    return new AccessAuthenticationFailed({
      reason: "missing_assertion",
      cause: new Error("The Access assertion header is missing"),
    });
  }

  try {
    const keySet = config.jwks === null
      ? createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`))
      : createLocalJWKSet(config.jwks);
    const verified = await jwtVerify(assertion, keySet, {
      algorithms: ["RS256"],
      audience: config.audience,
      issuer: config.issuer,
      typ: "JWT",
    });
    const identity = parseAccessIdentity(verified.payload);
    return identity instanceof InvalidAccessIdentity
      ? new AccessAuthenticationFailed({ reason: "invalid_identity", cause: identity })
      : identity;
  } catch (cause) {
    if (cause instanceof JoseErrors.JOSEError || cause instanceof Error) {
      return new AccessAuthenticationFailed({ reason: "invalid_assertion", cause });
    }
    return new AccessAuthenticationFailed({
      reason: "invalid_assertion",
      cause: new Error("The Access assertion could not be verified"),
    });
  }
}
