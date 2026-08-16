import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Option } from "effect";
import apiWorkerLayer, { ApiWorker } from "./src/api-worker.ts";
import { OverseerApiAccessDeployment } from "./src/overseer-api-access.ts";

/** Provision the production Access-protected API or start its local workerd implementation. */
export default Alchemy.Stack(
  "Overseer",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* ApiWorker;
    const access = yield* OverseerApiAccessDeployment;

    return Option.match(access, {
      onNone: () => ({ url: api.url }),
      onSome: ({ agentToken, application }) => ({
        url: api.url,
        accessAudience: application.aud,
        agentClientId: agentToken.clientId,
        agentClientSecret: agentToken.clientSecret,
      }),
    });
  }).pipe(Effect.provide(apiWorkerLayer)),
);
