import { Context, Effect, Layer, Schema } from "effect";
import { HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/unstable/httpapi";
import {
  CloudflareAccessPrincipal,
  CloudflareAccessVerifier,
  cloudflareAccessVerifierLayerForEnvironment,
} from "./cloudflare-access-verifier.ts";
import { Actor } from "./domain/actor.ts";

/** Unauthorized response for failed Cloudflare Access authentication. */
export class AccessUnauthorized extends Schema.TaggedError<AccessUnauthorized>()(
  "AccessUnauthorized",
  {
    message: Schema.String,
  },
  { httpApiStatus: 401 },
) {}

const AccessUnauthorizedApiResponse = AccessUnauthorized.pipe(
  Schema.annotateEncoded({
    examples: [
      {
        _tag: "AccessUnauthorized",
        message: "A valid Cf-Access-Jwt-Assertion header is required.",
      },
    ],
  }),
);

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
  error: AccessUnauthorizedApiResponse,
  security: {
    accessAssertion: HttpApiSecurity.apiKey({
      in: "header",
      key: "Cf-Access-Jwt-Assertion",
    }).pipe(
      HttpApiSecurity.annotateMerge(
        OpenApi.annotations({
          description: "Cloudflare Access assertion sent in the Cf-Access-Jwt-Assertion header.",
        }),
      ),
    ),
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
          Effect.tapError((error) =>
            Effect.logWarning("Cloudflare Access assertion verification failed").pipe(
              Effect.annotateLogs({
                operation: "verifyAccessAssertion",
                reason: error.reason,
              }),
            ),
          ),
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

/** Provides Access authentication middleware selected by the deployed Worker environment. */
export const accessAuthenticationMiddlewareLayer =
  accessAuthenticationMiddlewareLayerWithoutDependencies.pipe(
    Layer.provide(cloudflareAccessVerifierLayerForEnvironment),
  );
