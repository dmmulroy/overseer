import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import { RequestId } from "../domain/actor.ts";

/** Stable paths owned by the discovery contract. */
export const DiscoveryPaths = {
  root: "/api",
  schemas: "/api/schemas",
  openapi: "/api/openapi.json",
  workspaces: "/api/workspaces",
  projects: "/api/projects",
} as const;

/** Response media types owned by the discovery contract. */
export const DiscoveryMediaTypes = {
  json: "application/json",
  openapi: "application/vnd.oai.openapi+json;version=3.1",
  problem: "application/problem+json",
} as const;

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

/** Stable problem codes introduced by the Gateway bootstrap contract. */
export const ProblemCode = Schema.Literals([
  "agent_session_invalid",
  "agent_session_required",
  "authentication_required",
  "authentication_unavailable",
  "gateway_unavailable",
  "internal_error",
  "method_not_allowed",
  "origin_not_allowed",
  "representation_not_acceptable",
  "resource_not_found",
]);

/** Stable problem codes introduced by the Gateway bootstrap contract. */
export type ProblemCode = typeof ProblemCode.Type;

/** HTTP failure statuses introduced by the Gateway bootstrap contract. */
export const ProblemStatus = Schema.Literals([400, 401, 403, 404, 405, 406, 500, 503]);

/** HTTP failure statuses introduced by the Gateway bootstrap contract. */
export type ProblemStatus = typeof ProblemStatus.Type;

/** RFC 9457 problem representation shared by all API failures. */
export const ProblemDocument = Schema.Struct({
  type: Schema.String,
  title: Schema.String,
  status: ProblemStatus,
  detail: Schema.String,
  code: ProblemCode,
  request_id: RequestId,
  retryable: Schema.Boolean,
}).annotate({ identifier: "Problem" });

/** RFC 9457 problem representation shared by all API failures. */
export interface ProblemDocument extends Schema.Schema.Type<typeof ProblemDocument> {}

const problemAtStatus = (status: ProblemStatus) =>
  ProblemDocument.pipe(
    HttpApiSchema.asJson({ contentType: DiscoveryMediaTypes.problem }),
    HttpApiSchema.status(status),
  );
const endpointProblems = ([404, 405, 406, 503] as const).map(problemAtStatus);
const discover = HttpApiEndpoint.get("discover", DiscoveryPaths.root, {
  success: DiscoveryDocument,
  error: endpointProblems,
});
const headDiscovery = HttpApiEndpoint.head("headDiscovery", DiscoveryPaths.root, {
  success: Schema.Void,
  error: endpointProblems,
});
const discoverSchemas = HttpApiEndpoint.get("discoverSchemas", DiscoveryPaths.schemas, {
  success: SchemaIndex,
  error: endpointProblems,
});
const headSchemas = HttpApiEndpoint.head("headSchemas", DiscoveryPaths.schemas, {
  success: Schema.Void,
  error: endpointProblems,
});
const openApi = HttpApiEndpoint.get("openApi", DiscoveryPaths.openapi, {
  success: Schema.Unknown.pipe(
    HttpApiSchema.asJson({ contentType: DiscoveryMediaTypes.openapi }),
  ),
  error: endpointProblems,
});
const headOpenApi = HttpApiEndpoint.head("headOpenApi", DiscoveryPaths.openapi, {
  success: Schema.Void,
  error: endpointProblems,
});

/** Discovery endpoints in the public Overseer API. */
export class DiscoveryGroup extends HttpApiGroup.make("discovery")
  .add(discover)
  .add(headDiscovery)
  .add(discoverSchemas)
  .add(headSchemas)
  .add(openApi)
  .add(headOpenApi) {}

/** Cloudflare Access assertion scheme published in generated OpenAPI. */
export class CloudflareAccess extends HttpApiMiddleware.Service<CloudflareAccess>()(
  "CloudflareAccess",
  {
    error: problemAtStatus(401),
    security: {
      cloudflareAccess: HttpApiSecurity.apiKey({
        key: "Cf-Access-Jwt-Assertion",
        in: "header",
      }).pipe(
        HttpApiSecurity.annotate(
          OpenApi.Description,
          "Cloudflare Access injects this assertion after browser-session or Agent service-token authentication. Agent clients authenticate at the Access edge with CF-Access-Client-Id and CF-Access-Client-Secret; they do not create this assertion.",
        ),
      ),
    },
  },
) {}

/** The single declarative wire-contract source for Overseer's public REST API. */
export class OverseerApi extends HttpApi.make("overseer")
  .add(DiscoveryGroup)
  .middleware(CloudflareAccess) {}
