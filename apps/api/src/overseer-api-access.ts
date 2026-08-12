import { ALCHEMY_DEV } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Option } from "effect";
import { OverseerApiHostname } from "./overseer-api-hostname.ts";

/** Service token provisioned for authenticated Overseer Agent requests. */
export const OverseerApiAgentAccessToken = Cloudflare.Access.ServiceToken("OverseerApiAgent", {
  duration: "2160h",
});

const makeOverseerApiAccessApplication = Effect.fn(function* (ownerEmail: string) {
  const hostname = yield* OverseerApiHostname;
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
    sessionDuration: "168h",
  });
});

/** Optional Access deployment shared by the Worker props and Stack outputs. */
export const OverseerApiAccessDeployment = Effect.gen(function* () {
  if (yield* ALCHEMY_DEV) {
    return Option.none();
  }

  // Read all deploy configuration before provisioning any Cloudflare resource.
  const ownerEmail = yield* Config.string("OVERSEER_OWNER_EMAIL");
  const accessTeamDomain = yield* Config.string("CLOUDFLARE_ACCESS_TEAM_DOMAIN");
  const agentToken = yield* OverseerApiAgentAccessToken;
  const application = yield* makeOverseerApiAccessApplication(ownerEmail);

  return Option.some({ accessTeamDomain, agentToken, application });
});
