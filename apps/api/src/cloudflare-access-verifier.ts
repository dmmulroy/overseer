import { createRemoteJWKSet, errors as JoseErrors, jwtVerify, type JWTPayload } from "jose";
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { AgentId, CloudflareAccessSubject, EmailAddress } from "./domain/actor.ts";
import { OverseerEnvironmentConfig } from "./overseer-environment.ts";

const AccessAudience = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("AccessAudience"),
);

const AccessIssuer = Schema.URLFromString.check(
  Schema.makeFilter((url) =>
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
      ? undefined
      : "must be an exact HTTPS origin",
  ),
);

const AccessVerifierConfiguration = Config.all({
  audience: Config.schema(AccessAudience, "ACCESS_AUDIENCE"),
  issuer: Config.schema(AccessIssuer, "CLOUDFLARE_ACCESS_TEAM_DOMAIN"),
});

/** Verified Cloudflare Access identity before conversion into a domain Actor. */
export const CloudflareAccessPrincipal = Schema.TaggedUnion({
  HumanPrincipal: {
    subject: CloudflareAccessSubject,
    email: EmailAddress,
  },
  AgentPrincipal: {
    agentId: AgentId,
  },
});

/** Verified Cloudflare Access identity carrying parsed domain identity values. */
export type CloudflareAccessPrincipal = typeof CloudflareAccessPrincipal.Type;

const HumanAccessClaims = Schema.Struct({
  type: Schema.Literal("app"),
  sub: CloudflareAccessSubject,
  email: EmailAddress,
});

const parseHumanAccessClaims = Schema.decodeUnknownEffect(HumanAccessClaims);

const AgentAccessClaims = Schema.Struct({
  type: Schema.Literal("app"),
  sub: Schema.Literal(""),
  common_name: AgentId,
});

const parseAgentAccessClaims = Schema.decodeUnknownEffect(AgentAccessClaims);

const AccessVerificationFailureReason = Schema.Literals([
  "missing_assertion",
  "invalid_assertion",
  "invalid_identity",
  "verification_unavailable",
]);

type AccessVerificationFailureReason = typeof AccessVerificationFailureReason.Type;

const accessVerificationFailureMessages = {
  missing_assertion: "Cloudflare Access assertion is missing",
  invalid_assertion: "Cloudflare Access assertion is invalid",
  invalid_identity: "Cloudflare Access assertion identity is invalid",
  verification_unavailable: "Cloudflare Access verification is unavailable",
} as const;

/** Classified failure to verify a Cloudflare Access assertion. */
export class CloudflareAccessVerificationFailed extends Schema.TaggedError<CloudflareAccessVerificationFailed>()(
  "CloudflareAccessVerificationFailed",
  {
    reason: AccessVerificationFailureReason,
    message: Schema.String,
  },
) {
  /** Construct a safe classified verification failure without retaining JWT details. */
  constructor(reason: AccessVerificationFailureReason) {
    super({
      reason,
      message: accessVerificationFailureMessages[reason],
    });
  }
}

/** Capability that verifies a Cloudflare Access assertion and parses its principal. */
export interface ICloudflareAccessVerifier {
  /** Verify one signed assertion without exposing its JWT claims to application code. */
  readonly verifyAccessAssertion: (
    assertion: Redacted.Redacted<string>,
  ) => Effect.Effect<CloudflareAccessPrincipal, CloudflareAccessVerificationFailed>;
}

/** Verifies inbound Cloudflare Access application assertions. */
export class CloudflareAccessVerifier extends Context.Service<
  CloudflareAccessVerifier,
  ICloudflareAccessVerifier
>()("@overseer/CloudflareAccessVerifier") {}

const localCloudflareAccessPrincipal = CloudflareAccessPrincipal.cases.HumanPrincipal.make({
  subject: CloudflareAccessSubject.make("local-human"),
  email: EmailAddress.make("local@overseer.invalid"),
});

const localCloudflareAccessVerifier = CloudflareAccessVerifier.of({
  verifyAccessAssertion: () => Effect.succeed(localCloudflareAccessPrincipal),
});

const invalidIdentity = (): CloudflareAccessVerificationFailed =>
  new CloudflareAccessVerificationFailed("invalid_identity");

const parseCloudflareAccessPrincipal = Effect.fn(
  "CloudflareAccessVerifier.parseCloudflareAccessPrincipal",
)(function* (claims: JWTPayload) {
  if (claims.type !== "app") {
    return yield* Effect.fail(invalidIdentity());
  }

  if (claims.sub === "" && !("email" in claims)) {
    const agentClaims = yield* parseAgentAccessClaims(claims).pipe(
      Effect.mapError(() => invalidIdentity()),
    );

    return CloudflareAccessPrincipal.cases.AgentPrincipal.make({
      agentId: agentClaims.common_name,
    });
  }

  if (!("common_name" in claims)) {
    const humanClaims = yield* parseHumanAccessClaims(claims).pipe(
      Effect.mapError(() => invalidIdentity()),
    );

    return CloudflareAccessPrincipal.cases.HumanPrincipal.make({
      subject: humanClaims.sub,
      email: humanClaims.email,
    });
  }

  return yield* Effect.fail(invalidIdentity());
});

const parseJoseVerificationError = Schema.decodeUnknownOption(
  Schema.instanceOf(JoseErrors.JOSEError),
);

/** Construct the production Cloudflare Access verifier with one isolate-scoped remote JWKS cache. */
const makeProductionCloudflareAccessVerifier: Effect.Effect<
  CloudflareAccessVerifier["Service"],
  Config.ConfigError
> = Effect.gen(function* () {
  const { audience, issuer } = yield* AccessVerifierConfiguration;
  const keySet = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));

  return CloudflareAccessVerifier.of({
    verifyAccessAssertion: Effect.fn("CloudflareAccessVerifier.verifyAccessAssertion")(
      function* (assertion) {
        const token = Redacted.value(assertion);
        if (token.length === 0) {
          return yield* Effect.fail(new CloudflareAccessVerificationFailed("missing_assertion"));
        }

        const verified = yield* Effect.tryPromise({
          try: () =>
            jwtVerify(token, keySet, {
              algorithms: ["RS256"],
              audience,
              issuer: issuer.origin,
              maxTokenAge: "24h",
              requiredClaims: ["exp", "iat"],
              typ: "JWT",
            }),
          catch: (cause) =>
            Option.match(parseJoseVerificationError(cause), {
              onNone: () => new CloudflareAccessVerificationFailed("verification_unavailable"),
              onSome: (error) =>
                new CloudflareAccessVerificationFailed(
                  error instanceof JoseErrors.JWKSTimeout || error.code === "ERR_JOSE_GENERIC"
                    ? "verification_unavailable"
                    : "invalid_assertion",
                ),
            }),
        });

        return yield* parseCloudflareAccessPrincipal(verified.payload);
      },
    ),
  });
});

/**
 * Selects and caches the local or production Access verifier from deployed Worker configuration.
 * Configuration stays lazy so Alchemy planning never reads runtime-only Worker environment values.
 */
export const cloudflareAccessVerifierLayerForEnvironment = Layer.effect(
  CloudflareAccessVerifier,
  Effect.gen(function* () {
    const configuredVerifier = yield* Effect.cached(
      OverseerEnvironmentConfig.pipe(
        Effect.flatMap((environment) =>
          environment === "development"
            ? Effect.succeed(localCloudflareAccessVerifier)
            : makeProductionCloudflareAccessVerifier,
        ),
      ),
    );

    return CloudflareAccessVerifier.of({
      verifyAccessAssertion: (assertion) =>
        configuredVerifier.pipe(
          Effect.mapError(() => new CloudflareAccessVerificationFailed("verification_unavailable")),
          Effect.flatMap((verifier) => verifier.verifyAccessAssertion(assertion)),
        ),
    });
  }),
);
