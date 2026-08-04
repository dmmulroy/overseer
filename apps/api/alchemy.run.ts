import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, ConfigProvider, Effect } from "effect";
import ApiWorkerLive, { ApiWorker } from "./src/api-worker.ts";
import { OverseerApiHostname } from "./src/overseer-api-hostname.ts";

/** Service token provisioned for authenticated Agent requests. */
export const OverseerApiAgentAccessToken = Cloudflare.Access.ServiceToken("OverseerApiAgent", {
  duration: "2160h",
});

const makeOverseerApiAccessApplication = Effect.gen(function* () {
  const hostname = yield* OverseerApiHostname;
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

/** Provision the production Access-protected API or start its local workerd implementation. */
export default Alchemy.Stack(
  "OverseerApi",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { dev } = yield* Alchemy.AlchemyContext;

    if (dev === true) {
      const api = yield* ApiWorker.pipe(
        Effect.provide(ApiWorkerLive),
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown({ OVERSEER_ENVIRONMENT: "development" })),
        ),
      );
      return { url: api.url };
    }

    const agentToken = yield* OverseerApiAgentAccessToken;
    const accessApplication = yield* makeOverseerApiAccessApplication;
    const accessTeamDomain = yield* Config.string("CLOUDFLARE_ACCESS_TEAM_DOMAIN");
    const api = yield* ApiWorker.pipe(
      Effect.provide(ApiWorkerLive),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OVERSEER_ENVIRONMENT: "production",
            ACCESS_AUDIENCE: accessApplication.aud,
            CLOUDFLARE_ACCESS_TEAM_DOMAIN: accessTeamDomain,
          }),
        ),
      ),
    );

    return {
      url: api.url,
      accessAudience: accessApplication.aud,
      agentClientId: agentToken.clientId,
      agentClientSecret: agentToken.clientSecret,
    };
  }),
);
