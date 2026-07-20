import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EmailAddress } from "./src/domain/actor.ts";
import type { ProjectObject } from "./src/runtime/project.ts";
import type { WorkspaceCatalog } from "./src/runtime/workspace-catalog.ts";

const StageHostname = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(253),
  Schema.isPattern(/^[A-Za-z0-9.-]+$/),
).pipe(Schema.brand("StageHostname"));

const HttpsOrigin = Schema.URLFromString.check(
  Schema.makeFilter((url) =>
    url.protocol === "https:" && url.href === `${url.origin}/`
      ? undefined
      : "must be an HTTPS origin"
  ),
);

/** Provision one isolated Overseer stage and its Access-protected Gateway. */
export default Alchemy.Stack(
  "Overseer",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const hostname = yield* Config.schema(StageHostname, "OVERSEER_HOSTNAME");
    const accessIssuer = yield* Config.schema(
      HttpsOrigin,
      "CLOUDFLARE_ACCESS_TEAM_DOMAIN",
    );
    const ownerEmail = yield* Config.schema(EmailAddress, "OVERSEER_OWNER_EMAIL");

    const agentToken = yield* Cloudflare.Access.ServiceToken("AgentDeployment", {
      duration: "8760h",
    });
    const humanPolicy = yield* Cloudflare.Access.Policy("Human", {
      decision: "allow",
      include: [{ email: { email: ownerEmail } }],
    });
    const agentPolicy = yield* Cloudflare.Access.Policy("AgentDeployment", {
      decision: "non_identity",
      include: [{ serviceToken: { tokenId: agentToken.serviceTokenId } }],
    });
    const access = yield* Cloudflare.Access.Application("Gateway", {
      type: "self_hosted",
      domain: hostname,
      policies: [humanPolicy.policyId, agentPolicy.policyId],
      sessionDuration: "24h",
    });

    const catalog = Cloudflare.DurableObject<WorkspaceCatalog>("Catalog", {
      className: "WorkspaceCatalog",
    });
    const projects = Cloudflare.DurableObject<ProjectObject>("Projects", {
      className: "ProjectObject",
    });
    const gateway = yield* Cloudflare.Worker("Gateway", {
      assets: {
        directory: "dist",
        notFoundHandling: "single-page-application",
        runWorkerFirst: true,
      },
      compatibility: { date: "2026-07-19" },
      domain: hostname,
      env: {
        ACCESS_AUDIENCE: access.aud,
        ACCESS_ISSUER: accessIssuer.origin,
        ALLOWED_ORIGIN: `https://${hostname}`,
        CATALOG: catalog,
        PROJECTS: projects,
      },
      main: "src/runtime/gateway.ts",
      url: false,
    });

    return {
      gateway,
      hostname,
      agentClientId: agentToken.clientId,
      agentClientSecret: agentToken.clientSecret,
    };
  }),
);
