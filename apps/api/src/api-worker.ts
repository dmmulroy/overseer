import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/** Return the basic API identity as an Effect HTTP response. */
export const apiIdentityResponse = Effect.succeed(HttpServerResponse.text("Overseer API"));

/** Run the API locally in workerd or deploy it as a production Cloudflare Worker. */
export default Cloudflare.Worker(
  "Api",
  {
    main: import.meta.url,
    dev: {
      port: 8787,
      strictPort: true,
    },
  },
  Effect.succeed({
    fetch: apiIdentityResponse,
  }),
);
