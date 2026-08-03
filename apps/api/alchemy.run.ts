import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import ApiWorker from "./src/api-worker.ts";

/** Provision the production API or start its local workerd implementation. */
export default Alchemy.Stack(
  "OverseerApi",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* ApiWorker;

    return {
      url: api.url,
    };
  }),
);
