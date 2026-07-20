import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  AccessAudience,
  accessAssertionVerifierLayer,
} from "../adapters/gateway/access-principal.ts";
import { makeGatewayApplication } from "../adapters/gateway/gateway-application.ts";
import {
  GatewayDeploymentConfiguration,
  GatewayRuntimeConfiguration,
} from "../adapters/gateway/gateway-configuration.ts";
import ProjectObjectLive, { ProjectObject } from "./project.ts";
import WorkspaceCatalogLive, { WorkspaceCatalog } from "./workspace-catalog.ts";

/** Service token provisioned for authenticated Agent deployments. */
export const AgentDeploymentToken = Cloudflare.Access.ServiceToken(
  "AgentDeployment",
  { duration: "8760h" },
);

const GatewayProps = Effect.gen(function* () {
  const configuration = yield* GatewayDeploymentConfiguration;
  const agentToken = yield* AgentDeploymentToken;

  const humanPolicy = yield* Cloudflare.Access.Policy("Human", {
    decision: "allow",
    include: [{ email: { email: configuration.ownerEmail } }],
  });
  const agentPolicy = yield* Cloudflare.Access.Policy("AgentDeployment", {
    decision: "non_identity",
    include: [{ serviceToken: { tokenId: agentToken.serviceTokenId } }],
  });
  const access = yield* Cloudflare.Access.Application("Gateway", {
    type: "self_hosted",
    domain: configuration.stageOrigin.hostname,
    policies: [humanPolicy.policyId, agentPolicy.policyId],
    sessionDuration: "24h",
  });

  return {
    assets: {
      directory: "dist",
      notFoundHandling: "single-page-application" as const,
      runWorkerFirst: ["/api", "/api/*"],
    },
    compatibility: { date: "2026-07-19" },
    domain: configuration.stageOrigin.hostname,
    env: {
      ACCESS_AUDIENCE: access.aud,
    },
    main: import.meta.url,
    url: false,
  };
});

/** Effect-native Gateway Worker hosting the Catalog and Project objects. */
export class Gateway extends Cloudflare.Worker<
  Gateway,
  {},
  WorkspaceCatalog | ProjectObject
>()("Gateway") {}

const GatewayLive = Gateway.make(
  GatewayProps,
  Effect.gen(function* () {
    const configuration = yield* GatewayRuntimeConfiguration;
    const accessAudience = Config.schema(AccessAudience, "ACCESS_AUDIENCE");

    yield* WorkspaceCatalog.from(Gateway);
    yield* ProjectObject.from(Gateway);

    const fetch = yield* makeGatewayApplication(
      configuration,
      accessAudience,
    ).pipe(
      Effect.provide(
        accessAssertionVerifierLayer(configuration.accessIssuer),
      ),
    );

    return { fetch };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(WorkspaceCatalogLive, ProjectObjectLive),
    ),
  ),
);

export default GatewayLive;
