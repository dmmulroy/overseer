import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import ApiWorkerLive, {
  ApiWorker,
  OverseerApiAccessApplication,
  OverseerApiAgentAccessToken,
} from "./src/api-worker.ts";

/** Service token provisioned for authenticated Agent requests. */
export { OverseerApiAgentAccessToken } from "./src/api-worker.ts";

/** Provision the production Access-protected API or start its local workerd implementation. */
export default Alchemy.Stack(
  "OverseerApi",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { dev } = yield* Alchemy.AlchemyContext;
    const api = yield* ApiWorker.pipe(Effect.provide(ApiWorkerLive));

    if (dev === true) {
      return { url: api.url };
    }

    const agentToken = yield* OverseerApiAgentAccessToken;
    const accessApplication = yield* OverseerApiAccessApplication;

    return {
      url: api.url,
      accessAudience: accessApplication.aud,
      agentClientId: agentToken.clientId,
      agentClientSecret: agentToken.clientSecret,
    };
  }),
);
