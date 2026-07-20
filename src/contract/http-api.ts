import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import { RequestId } from "../domain/actor.ts";
import { WorkspaceId } from "../domain/entity-id.ts";
import { IdempotencyKey } from "../domain/idempotency.ts";
import { WorkspaceCursor } from "../domain/pagination.ts";
import {
  WorkspaceName,
  WorkspaceTimestamp,
} from "../domain/workspace.ts";

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
  schema: "application/schema+json",
} as const;

/** Canonical content-addressed request-schema paths for Workspace operations. */
export const WorkspaceSchemaPaths = {
  create: "/api/schemas/sha256-c8aabdb8c675c0dcacec739982adb32587a2957f6f49f55ea498b9865386f85e/create_workspace",
  rename: "/api/schemas/sha256-5fa6ff48fcff72fb74d0d49e4d7881e8b1df11208bee60d63a8127d0e0e4d550/rename_workspace",
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

/** Stable problem codes introduced by the public Gateway contract. */
export const ProblemCode = Schema.Literals([
  "agent_session_invalid",
  "agent_session_required",
  "authentication_required",
  "authentication_unavailable",
  "gateway_unavailable",
  "idempotency_key_reused",
  "internal_error",
  "malformed_request",
  "method_not_allowed",
  "origin_not_allowed",
  "representation_not_acceptable",
  "resource_not_found",
  "service_unavailable",
  "unsupported_media_type",
  "validation_failed",
]);

/** Stable problem codes introduced by the Gateway bootstrap contract. */
export type ProblemCode = typeof ProblemCode.Type;

/** HTTP failure statuses introduced by the public Gateway contract. */
export const ProblemStatus = Schema.Literals([400, 401, 403, 404, 405, 406, 409, 415, 422, 500, 503]);

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
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({
    code: Schema.String,
    path: Schema.String,
    message: Schema.String,
  }))),
  details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  links: Schema.optionalKey(Schema.Record(Schema.String, Link)),
}).annotate({ identifier: "Problem" });

/** RFC 9457 problem representation shared by all API failures. */
export interface ProblemDocument extends Schema.Schema.Type<typeof ProblemDocument> {}

const problemAtStatus = (status: ProblemStatus) =>
  ProblemDocument.pipe(
    HttpApiSchema.asJson({ contentType: DiscoveryMediaTypes.problem }),
    HttpApiSchema.status(status),
  );
const endpointProblems = ([400, 404, 405, 406, 409, 415, 422, 503] as const).map(problemAtStatus);
const conditionalReadHeaders = {
  accept: Schema.optionalKey(Schema.String),
  "if-none-match": Schema.optionalKey(Schema.String),
};
const OpenApiDocument = Schema.Unknown.pipe(
  HttpApiSchema.asJson({ contentType: DiscoveryMediaTypes.openapi }),
);
const JsonSchemaDocument = Schema.Unknown.pipe(
  HttpApiSchema.asJson({ contentType: DiscoveryMediaTypes.schema }),
);

/** Body accepted when creating or renaming a Workspace. */
export const WorkspaceNameRequest = Schema.Struct({ name: WorkspaceName }).pipe(
  Schema.flip,
  Schema.check(Schema.makeFilter(
    (body) => Object.keys(body).length === 1,
    { expected: "an object containing only the name field" },
  )),
  Schema.flip,
);

/** Body accepted when creating or renaming a Workspace. */
export interface WorkspaceNameRequest extends Schema.Schema.Type<typeof WorkspaceNameRequest> {}

/** Full Workspace REST representation. */
export const WorkspaceRepresentation = Schema.Struct({
  id: WorkspaceId,
  name: WorkspaceName,
  lifecycle: Schema.Literal("active"),
  created_at: WorkspaceTimestamp,
  updated_at: WorkspaceTimestamp,
  archived_at: Schema.Null,
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "Workspace" });

/** Full Workspace REST representation. */
export interface WorkspaceRepresentation extends Schema.Schema.Type<typeof WorkspaceRepresentation> {}

/** Exact active Workspace collection page. */
export const WorkspaceCollection = Schema.Struct({
  items: Schema.Array(WorkspaceRepresentation),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "WorkspaceCollection" });

/** Exact active Workspace collection page. */
export interface WorkspaceCollection extends Schema.Schema.Type<typeof WorkspaceCollection> {}

const workspacePath = { workspace_id: WorkspaceId };
const workspaceMutationHeaders = {
  accept: Schema.optionalKey(Schema.String),
  "content-type": Schema.optionalKey(Schema.String),
};
const workspaceCreateHeaders = {
  ...workspaceMutationHeaders,
  "idempotency-key": IdempotencyKey,
};
const workspaceCreated = WorkspaceRepresentation.pipe(HttpApiSchema.status(201));
const discover = HttpApiEndpoint.get("discover", DiscoveryPaths.root, {
  headers: conditionalReadHeaders,
  success: DiscoveryDocument,
  error: endpointProblems,
});
const headDiscovery = HttpApiEndpoint.head("headDiscovery", DiscoveryPaths.root, {
  headers: conditionalReadHeaders,
  success: DiscoveryDocument,
  error: endpointProblems,
});
const discoverSchemas = HttpApiEndpoint.get("discoverSchemas", DiscoveryPaths.schemas, {
  headers: conditionalReadHeaders,
  success: SchemaIndex,
  error: endpointProblems,
});
const headSchemas = HttpApiEndpoint.head("headSchemas", DiscoveryPaths.schemas, {
  headers: conditionalReadHeaders,
  success: SchemaIndex,
  error: endpointProblems,
});
const openApi = HttpApiEndpoint.get("openApi", DiscoveryPaths.openapi, {
  headers: conditionalReadHeaders,
  success: OpenApiDocument,
  error: endpointProblems,
});
const headOpenApi = HttpApiEndpoint.head("headOpenApi", DiscoveryPaths.openapi, {
  headers: conditionalReadHeaders,
  success: OpenApiDocument,
  error: endpointProblems,
});
const readRequestSchema = HttpApiEndpoint.get(
  "readRequestSchema",
  "/api/schemas/:content_hash/:schema_name",
  {
    params: { content_hash: Schema.String, schema_name: Schema.String },
    headers: conditionalReadHeaders,
    success: JsonSchemaDocument,
    error: endpointProblems,
  },
);
const headRequestSchema = HttpApiEndpoint.head(
  "headRequestSchema",
  "/api/schemas/:content_hash/:schema_name",
  {
    params: { content_hash: Schema.String, schema_name: Schema.String },
    headers: conditionalReadHeaders,
    success: JsonSchemaDocument,
    error: endpointProblems,
  },
);

const workspaceListQuery = {
  cursor: Schema.optionalKey(WorkspaceCursor),
  limit: Schema.optionalKey(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: 100 }),
    ),
  ),
};

const listWorkspaces = HttpApiEndpoint.get("listWorkspaces", DiscoveryPaths.workspaces, {
  headers: conditionalReadHeaders,
  query: workspaceListQuery,
  success: WorkspaceCollection,
  error: endpointProblems,
});
const headWorkspaces = HttpApiEndpoint.head("headWorkspaces", DiscoveryPaths.workspaces, {
  headers: conditionalReadHeaders,
  query: workspaceListQuery,
  success: WorkspaceCollection,
  error: endpointProblems,
});
const createWorkspace = HttpApiEndpoint.post("createWorkspace", DiscoveryPaths.workspaces, {
  headers: workspaceCreateHeaders,
  payload: WorkspaceNameRequest,
  success: workspaceCreated,
  error: endpointProblems,
});
const readWorkspace = HttpApiEndpoint.get("readWorkspace", "/api/workspaces/:workspace_id", {
  params: workspacePath,
  headers: conditionalReadHeaders,
  success: WorkspaceRepresentation,
  error: endpointProblems,
});
const headWorkspace = HttpApiEndpoint.head("headWorkspace", "/api/workspaces/:workspace_id", {
  params: workspacePath,
  headers: conditionalReadHeaders,
  success: WorkspaceRepresentation,
  error: endpointProblems,
});
const renameWorkspace = HttpApiEndpoint.patch("renameWorkspace", "/api/workspaces/:workspace_id", {
  params: workspacePath,
  headers: workspaceMutationHeaders,
  payload: WorkspaceNameRequest,
  success: WorkspaceRepresentation,
  error: endpointProblems,
});

/** Discovery endpoints in the public Overseer API. */
export class DiscoveryGroup extends HttpApiGroup.make("discovery")
  .add(discover)
  .add(headDiscovery)
  .add(discoverSchemas)
  .add(headSchemas)
  .add(openApi)
  .add(headOpenApi)
  .add(readRequestSchema)
  .add(headRequestSchema) {}

/** Workspace endpoints in the public Overseer API. */
export class WorkspaceGroup extends HttpApiGroup.make("workspaces")
  .add(listWorkspaces)
  .add(headWorkspaces)
  .add(createWorkspace)
  .add(readWorkspace)
  .add(headWorkspace)
  .add(renameWorkspace) {}

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
  .add(WorkspaceGroup)
  .middleware(CloudflareAccess) {}
