import { Context, Effect, Layer, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";
import {
  CloudflareAccessPrincipal,
  CloudflareAccessVerifier,
  localCloudflareAccessVerifierLayer,
  productionCloudflareAccessVerifierLayer,
} from "./cloudflare-access-verifier.ts";
import { Actor } from "./domain/actor.ts";
import { OverseerEnvironmentConfig } from "./overseer-environment.ts";

/** Unauthorized response for failed Cloudflare Access authentication. */
export class AccessUnauthorized extends Schema.TaggedErrorClass<AccessUnauthorized>()(
  "AccessUnauthorized",
  {
    message: Schema.String,
  },
  { httpApiStatus: 401 },
) {}

/** Provides the immutable Actor authenticated for the current HTTP request. */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()(
  "@overseer/CurrentActor",
) {}

const actorFromCloudflareAccessPrincipal = CloudflareAccessPrincipal.match({
  HumanPrincipal: ({ subject, email }) =>
    Actor.make({
      kind: "human",
      subject,
      email,
    }),
  AgentPrincipal: ({ agentId }) =>
    Actor.make({
      kind: "agent",
      agentId,
    }),
});

/** Verifies the Cloudflare Access assertion and provides the current request Actor. */
export class AccessAuthenticationMiddleware extends HttpApiMiddleware.Service<
  AccessAuthenticationMiddleware,
  { provides: CurrentActor }
>()("@overseer/AccessAuthenticationMiddleware", {
  error: AccessUnauthorized,
  security: {
    accessAssertion: HttpApiSecurity.apiKey({
      in: "header",
      key: "Cf-Access-Jwt-Assertion",
    }),
  },
}) {}

/** Constructs Access authentication middleware while preserving its verifier requirement. */
export const makeAccessAuthenticationMiddleware: Effect.Effect<
  AccessAuthenticationMiddleware["Service"],
  never,
  CloudflareAccessVerifier
> = Effect.gen(function* () {
  const accessVerifier = yield* CloudflareAccessVerifier;

  return AccessAuthenticationMiddleware.of({
    accessAssertion: (endpointEffect, { credential }) =>
      Effect.provideServiceEffect(
        endpointEffect,
        CurrentActor,
        accessVerifier.verifyAccessAssertion(credential).pipe(
          Effect.map(actorFromCloudflareAccessPrincipal),
          Effect.mapError(() => new AccessUnauthorized({ message: "Unauthorized" })),
        ),
      ),
  });
});

/** Provides Access authentication middleware without selecting a verifier implementation. */
export const accessAuthenticationMiddlewareLayerWithoutDependencies = Layer.effect(
  AccessAuthenticationMiddleware,
  makeAccessAuthenticationMiddleware,
);

/** Selects local or production Cloudflare Access verification from the Alchemy-bound environment. */
export const cloudflareAccessVerifierLayerForEnvironment = Layer.unwrap(
  OverseerEnvironmentConfig.pipe(
    Effect.map((environment) =>
      environment === "development"
        ? localCloudflareAccessVerifierLayer
        : productionCloudflareAccessVerifierLayer,
    ),
  ),
);

/** Provides Access authentication middleware selected by the Alchemy-bound environment. */
export const accessAuthenticationMiddlewareLayer =
  accessAuthenticationMiddlewareLayerWithoutDependencies.pipe(
    Layer.provide(cloudflareAccessVerifierLayerForEnvironment),
  );
