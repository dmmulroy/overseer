import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  layer as ulidGeneratorLayer,
  UlidGeneratorService,
} from "../application/ulid-generator.ts";
import { layer as accessAssertionVerifierLayer } from "../adapters/gateway/access-principal.ts";
import {
  GatewayDeploymentConfiguration,
  layer as gatewayConfigurationLayer,
} from "../adapters/gateway/gateway-configuration.ts";
import {
  GatewayApplication,
  layer as gatewayApplicationLayer,
} from "../adapters/gateway/gateway-application.ts";
import { layer as gatewayApiLayer } from "../adapters/gateway/gateway-http.ts";
import {
  layer as problemResponseLayer,
  renderGatewayConfigurationUnavailable,
} from "../adapters/gateway/problem-response.ts";
import { layer as workspaceRegistryClientLayer } from "../adapters/gateway/workspace-registry-rpc-client.ts";
import { makeRequestId } from "../domain/actor.ts";
import { Gateway } from "./gateway-resource.ts";
import WorkspaceRegistryObjectLive from "./workspace-registry.ts";

/** Service token provisioned for authenticated Agent deployments. */
export const AgentDeploymentToken = Cloudflare.Access.ServiceToken("AgentDeployment", {
  duration: "8760h",
});

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
    compatibility: {
      date: "2026-07-19",
      flags: ["nodejs_compat"],
    },
    domain: configuration.stageOrigin.hostname,
    env: {
      ACCESS_AUDIENCE: access.aud,
    },
    main: import.meta.url,
    url: false,
  };
});

const ProblemResponseLive = problemResponseLayer.pipe(Layer.provide(gatewayConfigurationLayer));

const AccessVerifierLive = accessAssertionVerifierLayer.pipe(
  Layer.provide(gatewayConfigurationLayer),
);

const GatewayApiLive = gatewayApiLayer.pipe(
  Layer.provide([ProblemResponseLive, workspaceRegistryClientLayer]),
);

const GatewayApplicationLive = gatewayApplicationLayer.pipe(
  Layer.provide([
    gatewayConfigurationLayer,
    AccessVerifierLive,
    GatewayApiLive,
    ProblemResponseLive,
    ulidGeneratorLayer,
  ]),
  Layer.provide(BrowserCrypto.layer),
);

const GatewayLive = Gateway.make(
  GatewayProps,
  Effect.gen(function* () {
    const application = yield* GatewayApplication;
    return { fetch: application.fetch };
  }).pipe(
    Effect.provide(GatewayApplicationLive),
    Effect.provide(WorkspaceRegistryObjectLive),
    Effect.catchTag("ConfigError", () =>
      Effect.logError("Gateway runtime configuration invalid").pipe(
        Effect.as({
          fetch: Effect.gen(function* () {
            const ulids = yield* UlidGeneratorService;
            return renderGatewayConfigurationUnavailable(makeRequestId(yield* ulids.next()));
          }).pipe(Effect.provide(ulidGeneratorLayer), Effect.provide(BrowserCrypto.layer)),
        }),
      ),
    ),
  ),
);

export default GatewayLive;
