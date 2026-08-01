import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { ALCHEMY_DEV, ALCHEMY_PHASE } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { layer as projectOperationsLayer } from "../application/gateway/project-operations.ts";
import {
  layer as ulidGeneratorLayer,
  UlidGeneratorService,
} from "../application/ulid-generator.ts";
import {
  layer as accessAssertionVerifierLayer,
  layerLocalHuman as localHumanAccessAssertionVerifierLayer,
} from "../adapters/gateway/access-principal.ts";
import {
  GatewayAccessDeploymentConfiguration,
  GatewayAuthenticationModeConfiguration,
  GatewayDeploymentConfiguration,
  GatewayLocalDevelopmentConfiguration,
  GatewayRuntimeResourceConfiguration,
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
import { layer as projectClientLayer } from "../adapters/gateway/project-rpc-client.ts";
import { layer as workspaceRegistryClientLayer } from "../adapters/gateway/workspace-registry-rpc-client.ts";
import { makeRequestId } from "../domain/actor.ts";
import { Gateway } from "./gateway-resource.ts";
import ProjectObjectLive from "./project.ts";
import WorkspaceRegistryObjectLive from "./workspace-registry.ts";

/** Service token provisioned for authenticated Agents. */
export const AgentToken = Cloudflare.Access.ServiceToken("Agent", {
  duration: "8760h",
});

const GatewayProps = Effect.gen(function* () {
  const configuration = yield* GatewayDeploymentConfiguration;
  const phase = yield* ALCHEMY_PHASE;
  const dev = phase === "plan" ? yield* ALCHEMY_DEV : false;

  const runtimeConfiguration =
    phase === "runtime" ? yield* GatewayRuntimeResourceConfiguration : undefined;
  const localConfiguration =
    phase === "plan" && dev ? yield* GatewayLocalDevelopmentConfiguration : undefined;

  const accessAudience = yield* runtimeConfiguration !== undefined
    ? Effect.succeed(runtimeConfiguration.accessAudience)
    : localConfiguration !== undefined
      ? Effect.succeed(localConfiguration.accessAudience)
      : Effect.gen(function* () {
          const accessConfiguration = yield* GatewayAccessDeploymentConfiguration;
          const agentToken = yield* AgentToken;
          const humanPolicy = yield* Cloudflare.Access.Policy("Human", {
            decision: "allow",
            include: [{ email: { email: accessConfiguration.ownerEmail } }],
          });
          const agentPolicy = yield* Cloudflare.Access.Policy("Agent", {
            decision: "non_identity",
            include: [{ serviceToken: { tokenId: agentToken.serviceTokenId } }],
          });
          const access = yield* Cloudflare.Access.Application("Gateway", {
            type: "self_hosted",
            domain: configuration.stageOrigin.hostname,
            policies: [humanPolicy.policyId, agentPolicy.policyId],
            sessionDuration: "24h",
          });
          return access.aud;
        });

  const allowedOrigin =
    runtimeConfiguration?.allowedOrigin ??
    localConfiguration?.allowedOrigin.origin ??
    configuration.stageOrigin.origin;
  const authenticationMode =
    runtimeConfiguration?.authenticationMode ?? (dev ? "local-human" : "cloudflare-access");

  return {
    assets: {
      directory: "dist",
      notFoundHandling: "single-page-application" as const,
      // Local workerd needs assets-first routing to serve the SPA; missing API assets fall through.
      runWorkerFirst: dev ? false : ["/api", "/api/*"],
    },
    compatibility: {
      date: "2026-07-19",
      flags: ["nodejs_compat"],
    },
    dev: {
      host: "localhost",
      port: 1337,
      strictPort: true,
    },
    domain: configuration.stageOrigin.hostname,
    env: {
      ACCESS_AUDIENCE: accessAudience,
      OVERSEER_ALLOWED_ORIGIN: allowedOrigin,
      OVERSEER_HOSTNAME: configuration.stageOrigin.hostname,
      OVERSEER_AUTHENTICATION_MODE: authenticationMode,
    },
    main: import.meta.url,
    url: false,
  };
});

const ProblemResponseLive = problemResponseLayer.pipe(Layer.provide(gatewayConfigurationLayer));

const ProductionAccessVerifierLive = accessAssertionVerifierLayer.pipe(
  Layer.provide(gatewayConfigurationLayer),
);

const AccessVerifierLive = Layer.unwrap(
  GatewayAuthenticationModeConfiguration.pipe(
    Effect.map((mode) =>
      mode === "local-human"
        ? localHumanAccessAssertionVerifierLayer
        : ProductionAccessVerifierLive,
    ),
  ),
);

const ProjectOperationsLive = projectOperationsLayer.pipe(
  Layer.provide([workspaceRegistryClientLayer, projectClientLayer]),
);

const GatewayApiLive = gatewayApiLayer.pipe(
  Layer.provide([ProblemResponseLive, workspaceRegistryClientLayer, ProjectOperationsLive]),
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
    Effect.provide(ProjectObjectLive),
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
