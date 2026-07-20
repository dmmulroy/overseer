import * as Config from "effect/Config";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { EmailAddress } from "../../domain/actor.ts";

const dnsHostname =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** An exact HTTP origin without credentials, a path, query, or fragment. */
export const ExactOrigin = Schema.URLFromString.check(
  Schema.makeFilter((url) =>
    (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.href === `${url.origin}/`
      ? undefined
      : "must be an exact HTTP or HTTPS origin"
  ),
);

/** An exact HTTPS origin without credentials, a path, query, or fragment. */
export const HttpsOrigin = ExactOrigin.check(
  Schema.makeFilter((url) =>
    url.protocol === "https:" ? undefined : "must use HTTPS"
  ),
);

/** A stage origin decoded from its DNS hostname. */
export const StageOriginFromHostname = Schema.String.pipe(
  Schema.decodeTo(
    HttpsOrigin.check(
      Schema.makeFilter((url) =>
        dnsHostname.test(url.hostname)
          ? undefined
          : "must contain a valid DNS hostname"
      ),
    ),
    SchemaTransformation.transform({
      decode: (hostname) => `https://${hostname}`,
      encode: (origin) => origin.slice("https://".length, -1),
    }),
  ),
);

const stageOrigin = Config.schema(
  StageOriginFromHostname,
  "OVERSEER_HOSTNAME",
);
const accessIssuer = Config.schema(
  HttpsOrigin,
  "CLOUDFLARE_ACCESS_TEAM_DOMAIN",
);

/** Deploy-time values used to provision the Gateway and Access application. */
export const GatewayDeploymentConfiguration = Config.all({
  stageOrigin,
  accessIssuer,
  ownerEmail: Config.schema(EmailAddress, "OVERSEER_OWNER_EMAIL"),
});

/** Parsed runtime configuration shared by every request in one Worker isolate. */
export const GatewayRuntimeConfiguration = Config.all({
  accessIssuer,
  allowedOrigin: stageOrigin,
  problemTypeBaseUrl: stageOrigin.pipe(
    Config.map((origin) => new URL("/problems/", origin)),
  ),
});

/** Parsed runtime configuration shared by every request in one Worker isolate. */
export interface GatewayRuntimeConfiguration extends
  Config.Success<typeof GatewayRuntimeConfiguration> {}
