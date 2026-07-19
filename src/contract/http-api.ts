import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

/** Link to a discoverable REST resource or operation. */
export const Link = Schema.Struct({
  href: Schema.String,
  method: Schema.optionalKey(Schema.String),
  schema: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Link" });

/** Link to a discoverable REST resource or operation. */
export interface Link extends Schema.Schema.Type<typeof Link> {}

/** Authenticated API discovery representation. */
export const DiscoveryDocument = Schema.Struct({
  name: Schema.Literal("Overseer"),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "DiscoveryDocument" });

/** Authenticated API discovery representation. */
export interface DiscoveryDocument extends Schema.Schema.Type<typeof DiscoveryDocument> {}

/** Content-addressed request-schema discovery representation. */
export const SchemaIndex = Schema.Struct({
  items: Schema.Array(Link),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "SchemaIndex" });

/** Content-addressed request-schema discovery representation. */
export interface SchemaIndex extends Schema.Schema.Type<typeof SchemaIndex> {}

const discover = HttpApiEndpoint.get("discover", "/api", {
  success: DiscoveryDocument,
});
const headDiscovery = HttpApiEndpoint.head("headDiscovery", "/api", {
  success: Schema.Void,
});
const discoverSchemas = HttpApiEndpoint.get("discoverSchemas", "/api/schemas", {
  success: SchemaIndex,
});
const headSchemas = HttpApiEndpoint.head("headSchemas", "/api/schemas", {
  success: Schema.Void,
});
const openApi = HttpApiEndpoint.get("openApi", "/api/openapi.json", {
  success: Schema.Unknown,
});
const headOpenApi = HttpApiEndpoint.head("headOpenApi", "/api/openapi.json", {
  success: Schema.Void,
});

/** Discovery endpoints in the public Overseer API. */
export class DiscoveryGroup extends HttpApiGroup.make("discovery")
  .add(discover)
  .add(headDiscovery)
  .add(discoverSchemas)
  .add(headSchemas)
  .add(openApi)
  .add(headOpenApi) {}

/** The single declarative wire-contract source for Overseer's public REST API. */
export class OverseerApi extends HttpApi.make("overseer").add(DiscoveryGroup) {}
