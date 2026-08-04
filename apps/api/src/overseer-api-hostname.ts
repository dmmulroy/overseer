import * as Alchemy from "alchemy";
import { Effect, Schema } from "effect";

/** Canonical production API hostname or an isolated stage-prefixed API hostname. */
export const OverseerApiHostnameSchema = Schema.String.check(
  Schema.isPattern(/^api(?:-[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?)?\.overseer\.mulroy\.ai$/),
).pipe(Schema.brand("OverseerApiHostname"));

/** Parsed hostname shared by the API Worker custom domain and Cloudflare Access application. */
export type OverseerApiHostname = typeof OverseerApiHostnameSchema.Type;

/** Derives the production or isolated API hostname from the current Alchemy stage. */
export const OverseerApiHostname = Alchemy.Stage.pipe(
  Effect.map((stage) => {
    const hostnameStage = stage.replaceAll("_", "-");

    return OverseerApiHostnameSchema.make(
      stage === "production" ? "api.overseer.mulroy.ai" : `api-${hostnameStage}.overseer.mulroy.ai`,
    );
  }),
);

// TODO: Create an overseer-config.ts file + service + layers
