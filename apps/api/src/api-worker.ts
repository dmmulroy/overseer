import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import {
  AccessAuthenticationMiddleware,
  accessAuthenticationMiddlewareLayer,
} from "./access-authentication-middleware.ts";

/** Effect-native API Worker shared by local development and every deployed stage. */
export class ApiWorker extends Cloudflare.Worker<ApiWorker, {}>()("Api") {}

/** Return the basic API identity as an Effect HTTP response. */
export const apiIdentityResponse = Effect.succeed(HttpServerResponse.text("Overseer API"));

/** Run the API locally in workerd or deploy it with production Access verification. */
export default ApiWorker.make(
  { main: import.meta.url },
  Effect.gen(function* () {
    const phase = yield* Alchemy.ALCHEMY_PHASE;

    if (phase === "runtime") {
      yield* AccessAuthenticationMiddleware.pipe(
        Effect.provide(accessAuthenticationMiddlewareLayer),
      );
    }

    return {
      fetch: apiIdentityResponse,
    };
  }),
);
