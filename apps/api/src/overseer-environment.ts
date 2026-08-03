import { Config, Schema } from "effect";

/** Worker environment selected exclusively by the trusted Alchemy composition root. */
export const OverseerEnvironment = Schema.Literals(["development", "production"]);

/** Parsed Worker environment selected by Alchemy. */
export type OverseerEnvironment = typeof OverseerEnvironment.Type;

/** Reads the Alchemy-bound Overseer Worker environment. */
export const OverseerEnvironmentConfig = Config.schema(OverseerEnvironment, "OVERSEER_ENVIRONMENT");
