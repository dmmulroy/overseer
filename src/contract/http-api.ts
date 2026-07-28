import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import {
  AgentDeploymentId,
  AgentSessionId,
  EmailAddress,
  HarnessName,
  HumanPrincipalId,
  RequestId,
} from "../domain/actor.ts";
import { IssueId, ProjectId, TimelineEventId, WorkspaceId } from "../domain/entity-id.ts";
import { IdempotencyKey } from "../domain/idempotency.ts";
import {
  ProjectCursor,
  ProjectPageLimitFromString,
  WorkspaceCursor,
  WorkspacePageLimitFromString,
} from "../domain/pagination.ts";
import {
  IssueBody,
  IssueNumber,
  IssueNumberFromString,
  IssueTimestamp,
  IssueTitle,
  RevisionNumber,
  TimelinePosition,
} from "../domain/issue.ts";
import { ProjectName, ProjectTimestamp } from "../domain/project.ts";
import { WorkspaceName, WorkspaceTimestamp } from "../domain/workspace.ts";
import {
  CreateIssueRequest,
  MoveProjectRequest,
  ProjectNameRequest,
  WorkspaceNameRequest,
} from "./request-schemas.ts";

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

export { IssueSchemaPaths, ProjectSchemaPaths, WorkspaceSchemaPaths } from "./request-schemas.ts";

const LinkMethod = Schema.Literals(["GET", "POST", "PATCH"]);
const RequestSchemaReference = Schema.String.check(
  Schema.isPattern(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/[a-z][a-z0-9_]*$/),
);

/** Link to a discoverable REST resource or operation. */
export const Link = Schema.Struct({
  href: Schema.String,
  method: Schema.optionalKey(LinkMethod),
  schema: Schema.optionalKey(RequestSchemaReference),
}).annotate({ identifier: "Link" });

/** Link to a discoverable REST resource or operation. */
export interface Link extends Schema.Schema.Type<typeof Link> {}

/** Authenticated API discovery response body. */
export const DiscoveryDocument = Schema.Struct({
  name: Schema.Literal("Overseer"),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "DiscoveryDocument" });

/** Authenticated API discovery response body. */
export interface DiscoveryDocument extends Schema.Schema.Type<typeof DiscoveryDocument> {}

/** Content-addressed request-schema index response. */
export const SchemaIndex = Schema.Struct({
  items: Schema.Array(Link),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "SchemaIndex" });

/** Content-addressed request-schema index response. */
export interface SchemaIndex extends Schema.Schema.Type<typeof SchemaIndex> {}

/** Stable problem codes introduced by the public Gateway contract. */
export const ProblemCode = Schema.Literals([
  "agent_session_invalid",
  "agent_session_required",
  "action_not_applicable",
  "authentication_required",
  "authentication_unavailable",
  "gateway_unavailable",
  "idempotency_key_reused",
  "internal_error",
  "malformed_request",
  "method_not_allowed",
  "payload_too_large",
  "origin_not_allowed",
  "response_type_not_acceptable",
  "request_body_unreadable",
  "resource_not_found",
  "service_unavailable",
  "unsupported_media_type",
  "validation_failed",
]);

/** Stable problem codes introduced by the Gateway bootstrap contract. */
export type ProblemCode = typeof ProblemCode.Type;

/** HTTP failure statuses introduced by the public Gateway contract. */
export const ProblemStatus = Schema.Literals([
  400, 401, 403, 404, 405, 406, 409, 413, 415, 422, 500, 503,
]);

/** HTTP failure statuses introduced by the Gateway bootstrap contract. */
export type ProblemStatus = typeof ProblemStatus.Type;

const problemDocumentFields = {
  type: Schema.String,
  title: Schema.String,
  detail: Schema.String,
  code: ProblemCode,
  request_id: RequestId,
  retryable: Schema.Boolean,
  errors: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        code: Schema.String,
        path: Schema.String,
        message: Schema.String,
      }),
    ),
  ),
  details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  links: Schema.optionalKey(Schema.Record(Schema.String, Link)),
};

const problemDocumentAtStatus = <const Status extends ProblemStatus>(status: Status) =>
  Schema.Struct({
    ...problemDocumentFields,
    status: Schema.Literal(status),
  });

const Problem400 = problemDocumentAtStatus(400);
const Problem401 = problemDocumentAtStatus(401);
const Problem403 = problemDocumentAtStatus(403);
const Problem404 = problemDocumentAtStatus(404);
const Problem405 = problemDocumentAtStatus(405);
const Problem406 = problemDocumentAtStatus(406);
const Problem409 = problemDocumentAtStatus(409);
const Problem413 = problemDocumentAtStatus(413);
const Problem415 = problemDocumentAtStatus(415);
const Problem422 = problemDocumentAtStatus(422);
const Problem500 = problemDocumentAtStatus(500);
const Problem503 = problemDocumentAtStatus(503);

/** RFC 9457 error response body shared by all API failures. */
export const ProblemDocument = Schema.Union([
  Problem400,
  Problem401,
  Problem403,
  Problem404,
  Problem405,
  Problem406,
  Problem409,
  Problem413,
  Problem415,
  Problem422,
  Problem500,
  Problem503,
]).annotate({ identifier: "Problem" });

/** RFC 9457 error response body shared by all API failures. */
export type ProblemDocument = typeof ProblemDocument.Type;

const problemAtStatus = <const Status extends ProblemStatus>(status: Status) =>
  problemDocumentAtStatus(status).pipe(
    HttpApiSchema.asJson({ contentType: DiscoveryMediaTypes.problem }),
    HttpApiSchema.status(status),
  );
const errorsAtStatuses = <const Statuses extends ReadonlyArray<ProblemStatus>>(
  statuses: Statuses,
) => statuses.map(problemAtStatus);
const apiDocumentReadProblems = errorsAtStatuses([406, 500, 503]);
const requestSchemaReadProblems = errorsAtStatuses([404, 406, 500, 503]);
const workspaceListProblems = errorsAtStatuses([400, 406, 500, 503]);
const workspaceCreateProblems = errorsAtStatuses([400, 403, 409, 413, 415, 422, 500, 503]);
const workspaceReadProblems = errorsAtStatuses([400, 404, 406, 500, 503]);
const workspaceRenameProblems = errorsAtStatuses([400, 403, 404, 413, 415, 422, 500, 503]);
const projectListProblems = errorsAtStatuses([400, 404, 406, 500, 503]);
const projectCreateProblems = errorsAtStatuses([400, 403, 404, 409, 413, 415, 422, 500, 503]);
const projectReadProblems = errorsAtStatuses([400, 404, 406, 500, 503]);
const projectRenameProblems = errorsAtStatuses([400, 403, 404, 413, 415, 422, 500, 503]);
const projectMoveProblems = errorsAtStatuses([400, 403, 404, 409, 413, 415, 422, 500, 503]);
const issueCreateProblems = errorsAtStatuses([400, 403, 404, 409, 413, 415, 422, 500, 503]);
const issueReadProblems = errorsAtStatuses([400, 404, 406, 500, 503]);
const cacheValidationHeaders = {
  accept: Schema.optionalKey(Schema.String),
  "if-none-match": Schema.optionalKey(Schema.String),
};
const NotModified = HttpApiSchema.Empty(304);
const OpenApiDocument = Schema.Unknown.pipe(
  HttpApiSchema.asJson({ contentType: DiscoveryMediaTypes.openapi }),
);
const JsonSchemaDocument = Schema.Unknown.pipe(
  HttpApiSchema.asJson({ contentType: DiscoveryMediaTypes.schema }),
);

export {
  CreateIssueRequest,
  MoveProjectRequest,
  ProjectNameRequest,
  WorkspaceNameRequest,
} from "./request-schemas.ts";

/** Full Workspace API response body. */
export const WorkspaceResponse = Schema.Struct({
  id: WorkspaceId,
  name: WorkspaceName,
  lifecycle: Schema.Literal("active"),
  created_at: WorkspaceTimestamp,
  updated_at: WorkspaceTimestamp,
  archived_at: Schema.Null,
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "Workspace" });

/** Full Workspace API response body. */
export interface WorkspaceResponse extends Schema.Schema.Type<typeof WorkspaceResponse> {}

/** Exact active Workspace collection page. */
export const WorkspaceCollection = Schema.Struct({
  items: Schema.Array(WorkspaceResponse),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "WorkspaceCollection" });

/** Exact active Workspace collection page. */
export interface WorkspaceCollection extends Schema.Schema.Type<typeof WorkspaceCollection> {}

/** Full Project API response body. */
export const ProjectResponse = Schema.Struct({
  id: ProjectId,
  workspace_id: WorkspaceId,
  name: ProjectName,
  lifecycle: Schema.Literal("active"),
  created_at: ProjectTimestamp,
  updated_at: ProjectTimestamp,
  archived_at: Schema.Null,
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "Project" });

/** Full Project API response body. */
export interface ProjectResponse extends Schema.Schema.Type<typeof ProjectResponse> {}

/** Exact active Project collection page. */
export const ProjectCollection = Schema.Struct({
  items: Schema.Array(ProjectResponse),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "ProjectCollection" });

/** Exact active Project collection page. */
export interface ProjectCollection extends Schema.Schema.Type<typeof ProjectCollection> {}

const ApiActor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("human"), subject: HumanPrincipalId, email: EmailAddress }),
  Schema.Struct({ kind: Schema.Literal("agent_deployment"), deployment_id: AgentDeploymentId }),
]);
const ApiAgentSession = Schema.Struct({
  session_id: AgentSessionId,
  harness: Schema.NullOr(HarnessName),
});

/** Full canonical Issue API response body. */
export const IssueResponse = Schema.Struct({
  id: IssueId,
  project_id: ProjectId,
  number: IssueNumber,
  title: IssueTitle,
  body: Schema.NullOr(IssueBody),
  state: Schema.Literal("open"),
  lifecycle: Schema.Literal("active"),
  created_at: IssueTimestamp,
  updated_at: IssueTimestamp,
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "Issue" });

/** Full canonical Issue API response body. */
export interface IssueResponse extends Schema.Schema.Type<typeof IssueResponse> {}

/** Immutable Issue title/body Revision returned by the API. */
export const IssueRevisionResponse = Schema.Struct({
  field: Schema.Literals(["title", "body"]),
  number: RevisionNumber,
  value: Schema.NullOr(Schema.String),
  actor: ApiActor,
  agent_session: Schema.NullOr(ApiAgentSession),
  created_at: IssueTimestamp,
}).annotate({ identifier: "IssueRevision" });

/** Immutable Issue title/body Revision returned by the API. */
export interface IssueRevisionResponse extends Schema.Schema.Type<typeof IssueRevisionResponse> {}

/** Complete initial Revision history for one Issue. */
export const IssueRevisionCollection = Schema.Struct({
  items: Schema.Array(IssueRevisionResponse),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "IssueRevisionCollection" });

/** Complete initial Revision history for one Issue. */
export interface IssueRevisionCollection extends Schema.Schema.Type<
  typeof IssueRevisionCollection
> {}

/** Structured Timeline event projected at one Issue-local position. */
export const IssueTimelineEntryResponse = Schema.Struct({
  position: TimelinePosition,
  event: Schema.Struct({
    id: TimelineEventId,
    kind: Schema.Literals(["issue_created", "internal_reference_added"]),
    source_issue_id: IssueId,
    target_issue_id: Schema.NullOr(IssueId),
    actor: ApiActor,
    agent_session: Schema.NullOr(ApiAgentSession),
    created_at: IssueTimestamp,
  }),
}).annotate({ identifier: "IssueTimelineEntry" });

/** Structured Timeline event projected at one Issue-local position. */
export interface IssueTimelineEntryResponse extends Schema.Schema.Type<
  typeof IssueTimelineEntryResponse
> {}

/** Complete structured Timeline introduced for one Issue. */
export const IssueTimelineCollection = Schema.Struct({
  items: Schema.Array(IssueTimelineEntryResponse),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "IssueTimelineCollection" });

/** Complete structured Timeline introduced for one Issue. */
export interface IssueTimelineCollection extends Schema.Schema.Type<
  typeof IssueTimelineCollection
> {}

const IssueReferenceResponse = Schema.Struct({
  source_issue_id: IssueId,
  target_issue_id: IssueId,
});

/** Current reciprocal same-Project references derived from Issue Markdown. */
export const IssueReferenceCollection = Schema.Struct({
  outgoing: Schema.Array(IssueReferenceResponse),
  incoming: Schema.Array(IssueReferenceResponse),
  links: Schema.Record(Schema.String, Link),
}).annotate({ identifier: "IssueReferenceCollection" });

/** Current reciprocal same-Project references derived from Issue Markdown. */
export interface IssueReferenceCollection extends Schema.Schema.Type<
  typeof IssueReferenceCollection
> {}

const workspacePath = { workspace_id: WorkspaceId };
const mutationHeaders = {
  accept: Schema.optionalKey(Schema.String),
  "content-type": Schema.optionalKey(Schema.String),
};
const idempotentMutationHeaders = {
  ...mutationHeaders,
  "idempotency-key": IdempotencyKey,
};
const workspaceCreated = WorkspaceResponse.pipe(HttpApiSchema.status(201));
const discover = HttpApiEndpoint.get("discover", DiscoveryPaths.root, {
  headers: cacheValidationHeaders,
  success: [DiscoveryDocument, NotModified],
  error: apiDocumentReadProblems,
});
const headDiscovery = HttpApiEndpoint.head("headDiscovery", DiscoveryPaths.root, {
  headers: cacheValidationHeaders,
  success: [DiscoveryDocument, NotModified],
  error: apiDocumentReadProblems,
});
const discoverSchemas = HttpApiEndpoint.get("discoverSchemas", DiscoveryPaths.schemas, {
  headers: cacheValidationHeaders,
  success: [SchemaIndex, NotModified],
  error: apiDocumentReadProblems,
});
const headSchemas = HttpApiEndpoint.head("headSchemas", DiscoveryPaths.schemas, {
  headers: cacheValidationHeaders,
  success: [SchemaIndex, NotModified],
  error: apiDocumentReadProblems,
});
const openApi = HttpApiEndpoint.get("openApi", DiscoveryPaths.openapi, {
  headers: cacheValidationHeaders,
  success: [OpenApiDocument, NotModified],
  error: apiDocumentReadProblems,
});
const headOpenApi = HttpApiEndpoint.head("headOpenApi", DiscoveryPaths.openapi, {
  headers: cacheValidationHeaders,
  success: [OpenApiDocument, NotModified],
  error: apiDocumentReadProblems,
});
const readRequestSchema = HttpApiEndpoint.get(
  "readRequestSchema",
  "/api/schemas/:content_hash/:schema_name",
  {
    params: { content_hash: Schema.String, schema_name: Schema.String },
    headers: cacheValidationHeaders,
    success: [JsonSchemaDocument, NotModified],
    error: requestSchemaReadProblems,
  },
);
const headRequestSchema = HttpApiEndpoint.head(
  "headRequestSchema",
  "/api/schemas/:content_hash/:schema_name",
  {
    params: { content_hash: Schema.String, schema_name: Schema.String },
    headers: cacheValidationHeaders,
    success: [JsonSchemaDocument, NotModified],
    error: requestSchemaReadProblems,
  },
);

const workspaceListQuery = Schema.Struct({
  cursor: Schema.optionalKey(WorkspaceCursor),
  limit: Schema.optionalKey(WorkspacePageLimitFromString),
}).pipe(
  Schema.flip,
  Schema.check(
    Schema.makeFilter(
      (query) => Object.keys(query).every((key) => key === "cursor" || key === "limit"),
      { expected: "an object containing only cursor and limit fields" },
    ),
  ),
  Schema.flip,
);

const listWorkspaces = HttpApiEndpoint.get("listWorkspaces", DiscoveryPaths.workspaces, {
  headers: cacheValidationHeaders,
  query: workspaceListQuery,
  success: [WorkspaceCollection, NotModified],
  error: workspaceListProblems,
});
const headWorkspaces = HttpApiEndpoint.head("headWorkspaces", DiscoveryPaths.workspaces, {
  headers: cacheValidationHeaders,
  query: workspaceListQuery,
  success: [WorkspaceCollection, NotModified],
  error: workspaceListProblems,
});
const createWorkspace = HttpApiEndpoint.post("createWorkspace", DiscoveryPaths.workspaces, {
  headers: idempotentMutationHeaders,
  payload: WorkspaceNameRequest,
  success: workspaceCreated,
  error: workspaceCreateProblems,
});
const readWorkspace = HttpApiEndpoint.get("readWorkspace", "/api/workspaces/:workspace_id", {
  params: workspacePath,
  headers: cacheValidationHeaders,
  success: [WorkspaceResponse, NotModified],
  error: workspaceReadProblems,
});
const headWorkspace = HttpApiEndpoint.head("headWorkspace", "/api/workspaces/:workspace_id", {
  params: workspacePath,
  headers: cacheValidationHeaders,
  success: [WorkspaceResponse, NotModified],
  error: workspaceReadProblems,
});
const renameWorkspace = HttpApiEndpoint.patch("renameWorkspace", "/api/workspaces/:workspace_id", {
  params: workspacePath,
  headers: mutationHeaders,
  payload: WorkspaceNameRequest,
  success: WorkspaceResponse,
  error: workspaceRenameProblems,
});

const projectListQuery = Schema.Struct({
  cursor: Schema.optionalKey(ProjectCursor),
  limit: Schema.optionalKey(ProjectPageLimitFromString),
}).pipe(
  Schema.flip,
  Schema.check(
    Schema.makeFilter(
      (query) => Object.keys(query).every((key) => key === "cursor" || key === "limit"),
      { expected: "an object containing only cursor and limit fields" },
    ),
  ),
  Schema.flip,
);
const projectPath = { project_id: ProjectId };
const workspaceProjectsPath = { workspace_id: WorkspaceId };
const projectCreated = ProjectResponse.pipe(HttpApiSchema.status(201));
const listProjects = HttpApiEndpoint.get("listProjects", DiscoveryPaths.projects, {
  headers: cacheValidationHeaders,
  query: projectListQuery,
  success: [ProjectCollection, NotModified],
  error: projectListProblems,
});
const headProjects = HttpApiEndpoint.head("headProjects", DiscoveryPaths.projects, {
  headers: cacheValidationHeaders,
  query: projectListQuery,
  success: [ProjectCollection, NotModified],
  error: projectListProblems,
});
const listWorkspaceProjects = HttpApiEndpoint.get(
  "listWorkspaceProjects",
  "/api/workspaces/:workspace_id/projects",
  {
    params: workspaceProjectsPath,
    headers: cacheValidationHeaders,
    query: projectListQuery,
    success: [ProjectCollection, NotModified],
    error: projectListProblems,
  },
);
const headWorkspaceProjects = HttpApiEndpoint.head(
  "headWorkspaceProjects",
  "/api/workspaces/:workspace_id/projects",
  {
    params: workspaceProjectsPath,
    headers: cacheValidationHeaders,
    query: projectListQuery,
    success: [ProjectCollection, NotModified],
    error: projectListProblems,
  },
);
const createProject = HttpApiEndpoint.post(
  "createProject",
  "/api/workspaces/:workspace_id/projects",
  {
    params: workspaceProjectsPath,
    headers: idempotentMutationHeaders,
    payload: ProjectNameRequest,
    success: projectCreated,
    error: projectCreateProblems,
  },
);
const readProject = HttpApiEndpoint.get("readProject", "/api/projects/:project_id", {
  params: projectPath,
  headers: cacheValidationHeaders,
  success: [ProjectResponse, NotModified],
  error: projectReadProblems,
});
const headProject = HttpApiEndpoint.head("headProject", "/api/projects/:project_id", {
  params: projectPath,
  headers: cacheValidationHeaders,
  success: [ProjectResponse, NotModified],
  error: projectReadProblems,
});
const renameProject = HttpApiEndpoint.patch("renameProject", "/api/projects/:project_id", {
  params: projectPath,
  headers: mutationHeaders,
  payload: ProjectNameRequest,
  success: ProjectResponse,
  error: projectRenameProblems,
});
const moveProject = HttpApiEndpoint.post("moveProject", "/api/projects/:project_id/move", {
  params: projectPath,
  headers: idempotentMutationHeaders,
  payload: MoveProjectRequest,
  success: ProjectResponse,
  error: projectMoveProblems,
});

const issuePath = { issue_id: IssueId };
const numberedIssuePath = { project_id: ProjectId, issue_number: IssueNumberFromString };
const issueCreated = IssueResponse.pipe(HttpApiSchema.status(201));
const createIssue = HttpApiEndpoint.post("createIssue", "/api/projects/:project_id/issues", {
  params: projectPath,
  headers: idempotentMutationHeaders,
  payload: CreateIssueRequest,
  success: issueCreated,
  error: issueCreateProblems,
});
const readIssue = HttpApiEndpoint.get("readIssue", "/api/issues/:issue_id", {
  params: issuePath,
  headers: cacheValidationHeaders,
  success: [IssueResponse, NotModified],
  error: issueReadProblems,
});
const headIssue = HttpApiEndpoint.head("headIssue", "/api/issues/:issue_id", {
  params: issuePath,
  headers: cacheValidationHeaders,
  success: [IssueResponse, NotModified],
  error: issueReadProblems,
});
const readNumberedIssue = HttpApiEndpoint.get(
  "readNumberedIssue",
  "/api/projects/:project_id/issues/:issue_number",
  {
    params: numberedIssuePath,
    headers: cacheValidationHeaders,
    success: [IssueResponse, NotModified],
    error: issueReadProblems,
  },
);
const headNumberedIssue = HttpApiEndpoint.head(
  "headNumberedIssue",
  "/api/projects/:project_id/issues/:issue_number",
  {
    params: numberedIssuePath,
    headers: cacheValidationHeaders,
    success: [IssueResponse, NotModified],
    error: issueReadProblems,
  },
);
const readIssueRevisions = HttpApiEndpoint.get(
  "readIssueRevisions",
  "/api/issues/:issue_id/revisions",
  {
    params: issuePath,
    headers: cacheValidationHeaders,
    success: [IssueRevisionCollection, NotModified],
    error: issueReadProblems,
  },
);
const readIssueTimeline = HttpApiEndpoint.get(
  "readIssueTimeline",
  "/api/issues/:issue_id/timeline",
  {
    params: issuePath,
    headers: cacheValidationHeaders,
    success: [IssueTimelineCollection, NotModified],
    error: issueReadProblems,
  },
);
const readIssueReferences = HttpApiEndpoint.get(
  "readIssueReferences",
  "/api/issues/:issue_id/references",
  {
    params: issuePath,
    headers: cacheValidationHeaders,
    success: [IssueReferenceCollection, NotModified],
    error: issueReadProblems,
  },
);

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

/** Project endpoints in the public Overseer API. */
export class ProjectGroup extends HttpApiGroup.make("projects")
  .add(listProjects)
  .add(headProjects)
  .add(listWorkspaceProjects)
  .add(headWorkspaceProjects)
  .add(createProject)
  .add(readProject)
  .add(headProject)
  .add(renameProject)
  .add(moveProject) {}

/** Issue discovery endpoints in the public Overseer API. */
export class IssueGroup extends HttpApiGroup.make("issues")
  .add(createIssue)
  .add(readIssue)
  .add(headIssue)
  .add(readNumberedIssue)
  .add(headNumberedIssue)
  .add(readIssueRevisions)
  .add(readIssueTimeline)
  .add(readIssueReferences) {}

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
  .add(ProjectGroup)
  .add(IssueGroup)
  .middleware(CloudflareAccess) {}
