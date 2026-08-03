import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import {
  AccessAuthenticationMiddleware,
  accessAuthenticationMiddlewareLayer,
} from "./access-authentication-middleware.ts";

/** Service token provisioned for authenticated Agent requests. */
export const OverseerApiAgentAccessToken = Cloudflare.Access.ServiceToken("OverseerApiAgent", {
  duration: "2160h",
});

/** Production Cloudflare Access application and its human and Agent policies. */
export const OverseerApiAccessApplication = Effect.gen(function* () {
  const hostname = yield* Config.string("OVERSEER_HOSTNAME");
  const ownerEmail = yield* Config.string("OVERSEER_OWNER_EMAIL");
  const agentToken = yield* OverseerApiAgentAccessToken;

  const humanPolicy = yield* Cloudflare.Access.Policy("OverseerApiHumanAccess", {
    decision: "allow",
    include: [{ email: { email: ownerEmail } }],
  });

  const agentPolicy = yield* Cloudflare.Access.Policy("OverseerApiAgentAccess", {
    decision: "non_identity",
    include: [{ serviceToken: { tokenId: agentToken.serviceTokenId } }],
  });

  return yield* Cloudflare.Access.Application("OverseerApiAccess", {
    type: "self_hosted",
    domain: hostname,
    policies: [humanPolicy.policyId, agentPolicy.policyId],
    sessionDuration: "1w",
  });
});

const ApiWorkerProps = Effect.gen(function* () {
  const phase = yield* Alchemy.ALCHEMY_PHASE;

  if (phase === "runtime") {
    const environment = yield* Config.string("OVERSEER_ENVIRONMENT");

    return {
      main: import.meta.url,
      dev: {
        port: 8787,
        strictPort: true,
      },
      env:
        environment === "development"
          ? { OVERSEER_ENVIRONMENT: environment }
          : {
              OVERSEER_ENVIRONMENT: environment,
              ACCESS_AUDIENCE: yield* Config.string("ACCESS_AUDIENCE"),
              CLOUDFLARE_ACCESS_TEAM_DOMAIN: yield* Config.string("CLOUDFLARE_ACCESS_TEAM_DOMAIN"),
            },
    };
  }

  const { dev } = yield* Alchemy.AlchemyContext;
  if (dev === true) {
    return {
      main: import.meta.url,
      dev: {
        port: 8787,
        strictPort: true,
      },
      env: {
        OVERSEER_ENVIRONMENT: "development" as const,
      },
    };
  }

  const accessApplication = yield* OverseerApiAccessApplication;
  const accessTeamDomain = yield* Config.string("CLOUDFLARE_ACCESS_TEAM_DOMAIN");

  return {
    main: import.meta.url,
    dev: {
      port: 8787,
      strictPort: true,
    },
    env: {
      OVERSEER_ENVIRONMENT: "production" as const,
      ACCESS_AUDIENCE: accessApplication.aud,
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: accessTeamDomain,
    },
  };
});

/** Effect-native API Worker shared by local development and every deployed stage. */
export class ApiWorker extends Cloudflare.Worker<ApiWorker, {}>()("Api") {}

/** Return the basic API identity as an Effect HTTP response. */
export const apiIdentityResponse = Effect.succeed(HttpServerResponse.text("Overseer API"));

/** Run the API locally in workerd or deploy it with production Access verification. */
export default ApiWorker.make(
  ApiWorkerProps,
  Effect.gen(function* () {
    const phase = yield* Alchemy.ALCHEMY_PHASE;

    if (phase === "runtime") {
      yield* AccessAuthenticationMiddleware.pipe(
        Effect.provide(accessAuthenticationMiddlewareLayer),
      );
    }

    return {
      fetch: apiIdentityResponse,
    };
  }),
);
