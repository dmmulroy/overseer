import { createRemoteJWKSet, errors as JoseErrors, jwtVerify } from "jose";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { AgentId, CloudflareAccessSubject, EmailAddress } from "./domain/actor.ts";

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

const accessVerificationFailureMessages: Readonly<Record<AccessVerificationFailureReason, string>> =
  {
    missing_assertion: "Cloudflare Access assertion is missing",
    invalid_assertion: "Cloudflare Access assertion is invalid",
    invalid_identity: "Cloudflare Access assertion identity is invalid",
    verification_unavailable: "Cloudflare Access verification is unavailable",
  };

/** Classified failure to verify a Cloudflare Access assertion. */
export class CloudflareAccessVerificationFailed extends Schema.TaggedErrorClass<CloudflareAccessVerificationFailed>()(
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

/** Local development verifier that authenticates every request as one fixed synthetic principal. */
export const localCloudflareAccessVerifierLayer = Layer.succeed(
  CloudflareAccessVerifier,
  CloudflareAccessVerifier.of({
    verifyAccessAssertion: () => Effect.succeed(localCloudflareAccessPrincipal),
  }),
);

const invalidIdentity = (): CloudflareAccessVerificationFailed =>
  new CloudflareAccessVerificationFailed("invalid_identity");

const parseCloudflareAccessPrincipal = Effect.fn(
  "CloudflareAccessVerifier.parseCloudflareAccessPrincipal",
)(function* (claims: Record<string, unknown>) {
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

const classifyJoseVerificationFailure = (cause: unknown): CloudflareAccessVerificationFailed => {
  const reason =
    cause instanceof JoseErrors.JWKSTimeout ||
    (cause instanceof JoseErrors.JOSEError && cause.code === "ERR_JOSE_GENERIC") ||
    !(cause instanceof JoseErrors.JOSEError)
      ? "verification_unavailable"
      : "invalid_assertion";

  return new CloudflareAccessVerificationFailed(reason);
};

/** Construct the production Cloudflare Access verifier with one isolate-scoped remote JWKS cache. */
export const makeCloudflareAccessVerifier: Effect.Effect<
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
          catch: classifyJoseVerificationFailure,
        });

        return yield* parseCloudflareAccessPrincipal(verified.payload);
      },
    ),
  });
});

/** Layer that constructs the Cloudflare Access verifier while preserving configuration requirements. */
export const cloudflareAccessVerifierLayerWithoutDependencies = Layer.effect(
  CloudflareAccessVerifier,
  makeCloudflareAccessVerifier,
);

/** Production Layer for remote-JWKS Cloudflare Access assertion verification. */
export const productionCloudflareAccessVerifierLayer =
  cloudflareAccessVerifierLayerWithoutDependencies;
