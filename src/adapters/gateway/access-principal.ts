import {
  createRemoteJWKSet,
  errors as JoseErrors,
  jwtVerify,
} from "jose";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  AgentDeploymentId,
  EmailAddress,
  HumanPrincipalId,
  AuthenticatedPrincipal,
} from "../../domain/actor.ts";

const InvalidAccessIdentityReason = Schema.Literals([
  "unsupported_token_type",
  "invalid_agent_client_id",
  "invalid_human_claims",
]);
type InvalidAccessIdentityReason = typeof InvalidAccessIdentityReason.Type;

const invalidIdentityMessages: Readonly<Record<InvalidAccessIdentityReason, string>> = {
  unsupported_token_type: "The assertion is not an application token",
  invalid_agent_client_id: "The Agent deployment client ID is invalid",
  invalid_human_claims: "The human identity claims are invalid",
};

class InvalidAccessIdentity extends Schema.TaggedErrorClass<InvalidAccessIdentity>()(
  "InvalidAccessIdentity",
  {
    reason: InvalidAccessIdentityReason,
    message: Schema.String,
  },
) {
  constructor(reason: InvalidAccessIdentityReason) {
    super({ reason, message: invalidIdentityMessages[reason] });
  }
}

function parseAccessIdentity(claims: Record<string, unknown>): AuthenticatedPrincipal | InvalidAccessIdentity {
  if (claims.type !== "app") {
    return new InvalidAccessIdentity("unsupported_token_type");
  }

  if (
    typeof claims.common_name === "string" &&
    (claims.sub === undefined || claims.sub === "")
  ) {
    const deploymentId = Schema.decodeUnknownOption(AgentDeploymentId)(claims.common_name);
    return Option.isSome(deploymentId)
      ? AuthenticatedPrincipal.cases.AgentDeploymentPrincipal.make({
          deploymentId: deploymentId.value,
        })
      : new InvalidAccessIdentity("invalid_agent_client_id");
  }

  const subject = Schema.decodeUnknownOption(HumanPrincipalId)(claims.sub);
  const email = Schema.decodeUnknownOption(EmailAddress)(claims.email);
  return Option.isSome(subject) && Option.isSome(email)
    ? AuthenticatedPrincipal.cases.HumanPrincipal.make({
        subject: subject.value,
        email: email.value,
      })
    : new InvalidAccessIdentity("invalid_human_claims");
}

/** Cloudflare Access application audience accepted by the Gateway. */
export const AccessAudience = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("AccessAudience"),
);

/** Cloudflare Access application audience accepted by the Gateway. */
export type AccessAudience = typeof AccessAudience.Type;

/** Parsed configuration needed to validate Access assertions. */
export type AccessConfiguration = {
  readonly audience: AccessAudience;
  readonly issuer: URL;
};

const AccessAuthenticationFailureReason = Schema.Literals([
  "missing_assertion",
  "invalid_assertion",
  "invalid_identity",
  "verification_unavailable",
]);
type AccessAuthenticationFailureReason = typeof AccessAuthenticationFailureReason.Type;

const authenticationFailureMessages: Readonly<
  Record<AccessAuthenticationFailureReason, string>
> = {
  missing_assertion: "The Access assertion header is missing",
  invalid_assertion: "The Access assertion is invalid",
  invalid_identity: "The Access assertion identity is invalid",
  verification_unavailable: "Access assertion verification is unavailable",
};

/** A known Access authentication failure. */
export class AccessAuthenticationFailed extends Schema.TaggedErrorClass<AccessAuthenticationFailed>()(
  "AccessAuthenticationFailed",
  {
    reason: AccessAuthenticationFailureReason,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  /** Construct a classified Access authentication failure. */
  constructor(input: {
    readonly reason: AccessAuthenticationFailureReason;
    readonly cause: unknown;
  }) {
    super({ ...input, message: authenticationFailureMessages[input.reason] });
  }
}

function classifyVerificationFailure(cause: unknown): AccessAuthenticationFailed {
  const reason = cause instanceof JoseErrors.JWKSTimeout ||
      (cause instanceof JoseErrors.JOSEError && cause.code === "ERR_JOSE_GENERIC") ||
      !(cause instanceof JoseErrors.JOSEError)
    ? "verification_unavailable"
    : "invalid_assertion";
  return new AccessAuthenticationFailed({ reason, cause });
}

/** Verify one Access assertion against a configured application. */
export type AccessAssertionVerifier = (
  assertion: Redacted.Redacted<string> | null,
) => Effect.Effect<AuthenticatedPrincipal, AccessAuthenticationFailed>;

/** Construct an Access verifier that reuses the remote key-set cache. */
export function makeAccessAssertionVerifier(
  config: AccessConfiguration,
): AccessAssertionVerifier {
  const keySet = createRemoteJWKSet(
    new URL("/cdn-cgi/access/certs", config.issuer),
  );
  return Effect.fn("GatewayAccess.verifyAssertion")(function* (assertion) {
    if (assertion === null || Redacted.value(assertion).length === 0) {
      return yield* Effect.fail(new AccessAuthenticationFailed({
        reason: "missing_assertion",
        cause: new Error("The Access assertion header is missing"),
      }));
    }

    const verified = yield* Effect.tryPromise({
      try: () =>
        jwtVerify(Redacted.value(assertion), keySet, {
          algorithms: ["RS256"],
          audience: config.audience,
          issuer: config.issuer.origin,
          requiredClaims: ["exp", "iat"],
          typ: "JWT",
        }),
      catch: classifyVerificationFailure,
    });
    const identity = parseAccessIdentity(verified.payload);
    return identity instanceof InvalidAccessIdentity
      ? yield* Effect.fail(new AccessAuthenticationFailed({
          reason: "invalid_identity",
          cause: identity,
        }))
      : identity;
  });
}
