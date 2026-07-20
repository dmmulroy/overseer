import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { GatewayDeploymentConfiguration } from "./src/adapters/gateway/gateway-configuration.ts";
import GatewayLive, {
  AgentDeploymentToken,
  Gateway,
} from "./src/runtime/gateway.ts";

/** Provision one isolated Overseer stage and its Access-protected Gateway. */
export default Alchemy.Stack(
  "Overseer",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const gateway = yield* Gateway;
    const agentToken = yield* AgentDeploymentToken;
    const configuration = yield* GatewayDeploymentConfiguration;

    return {
      gateway,
      hostname: configuration.stageOrigin.hostname,
      agentClientId: agentToken.clientId,
      agentClientSecret: agentToken.clientSecret,
    };
  }).pipe(
    Effect.provide(GatewayLive),
  ),
);
