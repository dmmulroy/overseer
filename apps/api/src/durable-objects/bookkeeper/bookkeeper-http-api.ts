import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { Issue } from "../../domain/issue.ts";
import { Project } from "../../domain/project.ts";
import { Workspace } from "../../domain/workspace.ts";
import { PaginationPage, PaginationRequest } from "../../pagination.ts";

/** Reserved stable identity of the singleton Bookkeeper Durable Object. */
export type BookkeeperId = "bookkeeper";

/** Reserved namespace key of the singleton Bookkeeper Durable Object. */
export const BOOKKEEPER_ID: BookkeeperId = "bookkeeper";

/** Bookkeeper projection of Workspace identity, timestamps, and deletion state. */
export const BookkeeperWorkspace = Schema.Struct({
  id: Workspace.fields.id,
  createdAt: Workspace.fields.createdAt,
  updatedAt: Workspace.fields.updatedAt,
  deletedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});

/** Parsed Bookkeeper Workspace projection. */
export interface BookkeeperWorkspace extends Schema.Schema.Type<typeof BookkeeperWorkspace> {}

/** Bookkeeper projection of Project ownership, timestamps, and deletion state. */
export const BookkeeperProject = Schema.Struct({
  id: Project.fields.id,
  workspaceId: Project.fields.workspaceId,
  createdAt: Project.fields.createdAt,
  updatedAt: Project.fields.updatedAt,
  deletedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});

/** Parsed Bookkeeper Project projection. */
export interface BookkeeperProject extends Schema.Schema.Type<typeof BookkeeperProject> {}

/** Bookkeeper projection of Issue ownership, timestamps, and deletion state. */
export const BookkeeperIssue = Schema.Struct({
  id: Issue.fields.id,
  projectId: Issue.fields.projectId,
  createdAt: Issue.fields.createdAt,
  updatedAt: Issue.fields.updatedAt,
  deletedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});

/** Parsed Bookkeeper Issue projection. */
export interface BookkeeperIssue extends Schema.Schema.Type<typeof BookkeeperIssue> {}

/** Live entity totals returned without enumerating Bookkeeper collections. */
export const BookkeeperCounts = Schema.Struct({
  workspaces: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  projects: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  issues: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

/** Parsed live Bookkeeper entity totals. */
export interface BookkeeperCounts extends Schema.Schema.Type<typeof BookkeeperCounts> {}

const ListFailureReason = Schema.Literals([
  "InvalidCursor",
  "PersistenceFailed",
  "StoredDataInvalid",
]);
const GetFailureReason = Schema.Literals(["PersistenceFailed", "StoredDataInvalid"]);
const RegisterFailureReason = Schema.Literals([
  "IdentityMismatch",
  "OwnershipChanged",
  "UpdatedAtMovedBackward",
  "ParentNotFound",
  "ParentDeleted",
  "DeletedEntityCannotBeRestored",
  "PersistenceFailed",
  "StoredDataInvalid",
]);
const DeleteFailureReason = Schema.Literals([
  "NotFound",
  "LiveChildren",
  "PersistenceFailed",
  "StoredDataInvalid",
]);

/** Failure to list Workspace projections, including invalid collection cursors. */
export class ListWorkspacesError extends Schema.TaggedErrorClass<ListWorkspacesError>()(
  "ListWorkspacesError",
  { reason: ListFailureReason, message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** Failure to read one Workspace projection. */
export class GetWorkspaceError extends Schema.TaggedErrorClass<GetWorkspaceError>()(
  "GetWorkspaceError",
  { reason: GetFailureReason, message: Schema.String },
  { httpApiStatus: 500 },
) {}

/** Failure to register or refresh a Workspace projection. */
export class RegisterWorkspaceError extends Schema.TaggedErrorClass<RegisterWorkspaceError>()(
  "RegisterWorkspaceError",
  { reason: RegisterFailureReason, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Failure to tombstone a Workspace projection. */
export class DeleteWorkspaceError extends Schema.TaggedErrorClass<DeleteWorkspaceError>()(
  "DeleteWorkspaceError",
  { reason: DeleteFailureReason, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Failure to list Project projections for a Workspace. */
export class ListProjectsError extends Schema.TaggedErrorClass<ListProjectsError>()(
  "ListProjectsError",
  { reason: ListFailureReason, message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** Failure to read one Project projection. */
export class GetProjectError extends Schema.TaggedErrorClass<GetProjectError>()(
  "GetProjectError",
  { reason: GetFailureReason, message: Schema.String },
  { httpApiStatus: 500 },
) {}

/** Failure to register or refresh a Project projection. */
export class RegisterProjectError extends Schema.TaggedErrorClass<RegisterProjectError>()(
  "RegisterProjectError",
  { reason: RegisterFailureReason, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Failure to tombstone a Project projection. */
export class DeleteProjectError extends Schema.TaggedErrorClass<DeleteProjectError>()(
  "DeleteProjectError",
  { reason: DeleteFailureReason, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Failure to list Issue projections for a Project. */
export class ListIssuesError extends Schema.TaggedErrorClass<ListIssuesError>()(
  "ListIssuesError",
  { reason: ListFailureReason, message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** Failure to read one Issue projection. */
export class GetIssueError extends Schema.TaggedErrorClass<GetIssueError>()(
  "GetIssueError",
  { reason: GetFailureReason, message: Schema.String },
  { httpApiStatus: 500 },
) {}

/** Failure to register or refresh an Issue projection. */
export class RegisterIssueError extends Schema.TaggedErrorClass<RegisterIssueError>()(
  "RegisterIssueError",
  { reason: RegisterFailureReason, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Failure to tombstone an Issue projection. */
export class DeleteIssueError extends Schema.TaggedErrorClass<DeleteIssueError>()(
  "DeleteIssueError",
  { reason: DeleteFailureReason, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Failure to count live Bookkeeper projections. */
export class GetBookkeeperCountsError extends Schema.TaggedErrorClass<GetBookkeeperCountsError>()(
  "GetBookkeeperCountsError",
  {
    reason: Schema.Literals(["PersistenceFailed", "StoredDataInvalid"]),
    message: Schema.String,
  },
  { httpApiStatus: 500 },
) {}

const WorkspaceParams = Schema.Struct({ workspaceId: Workspace.fields.id });
const ProjectParams = Schema.Struct({ projectId: Project.fields.id });
const IssueParams = Schema.Struct({ issueId: Issue.fields.id });
const ProjectListQuery = Schema.Struct({
  workspaceId: Workspace.fields.id,
  ...PaginationRequest.fields,
});
const IssueListQuery = Schema.Struct({
  projectId: Project.fields.id,
  ...PaginationRequest.fields,
});

const listWorkspaces = HttpApiEndpoint.get("listWorkspaces", "/workspaces", {
  query: PaginationRequest,
  success: PaginationPage(BookkeeperWorkspace),
  error: ListWorkspacesError,
});
const getWorkspace = HttpApiEndpoint.get("getWorkspace", "/workspaces/:workspaceId", {
  params: WorkspaceParams,
  success: Schema.OptionFromNullOr(BookkeeperWorkspace),
  error: GetWorkspaceError,
});
const registerWorkspace = HttpApiEndpoint.put("registerWorkspace", "/workspaces/:workspaceId", {
  params: WorkspaceParams,
  payload: BookkeeperWorkspace,
  success: BookkeeperWorkspace,
  error: RegisterWorkspaceError,
});
const deleteWorkspace = HttpApiEndpoint.delete("deleteWorkspace", "/workspaces/:workspaceId", {
  params: WorkspaceParams,
  success: BookkeeperWorkspace,
  error: DeleteWorkspaceError,
});
const listProjects = HttpApiEndpoint.get("listProjects", "/projects", {
  query: ProjectListQuery,
  success: PaginationPage(BookkeeperProject),
  error: ListProjectsError,
});
const getProject = HttpApiEndpoint.get("getProject", "/projects/:projectId", {
  params: ProjectParams,
  success: Schema.OptionFromNullOr(BookkeeperProject),
  error: GetProjectError,
});
const registerProject = HttpApiEndpoint.put("registerProject", "/projects/:projectId", {
  params: ProjectParams,
  payload: BookkeeperProject,
  success: BookkeeperProject,
  error: RegisterProjectError,
});
const deleteProject = HttpApiEndpoint.delete("deleteProject", "/projects/:projectId", {
  params: ProjectParams,
  success: BookkeeperProject,
  error: DeleteProjectError,
});
const listIssues = HttpApiEndpoint.get("listIssues", "/issues", {
  query: IssueListQuery,
  success: PaginationPage(BookkeeperIssue),
  error: ListIssuesError,
});
const getIssue = HttpApiEndpoint.get("getIssue", "/issues/:issueId", {
  params: IssueParams,
  success: Schema.OptionFromNullOr(BookkeeperIssue),
  error: GetIssueError,
});
const registerIssue = HttpApiEndpoint.put("registerIssue", "/issues/:issueId", {
  params: IssueParams,
  payload: BookkeeperIssue,
  success: BookkeeperIssue,
  error: RegisterIssueError,
});
const deleteIssue = HttpApiEndpoint.delete("deleteIssue", "/issues/:issueId", {
  params: IssueParams,
  success: BookkeeperIssue,
  error: DeleteIssueError,
});
const getCounts = HttpApiEndpoint.get("getCounts", "/counts", {
  success: BookkeeperCounts,
  error: GetBookkeeperCountsError,
});

/** Versioned internal HTTP operations exposed by the Bookkeeper service. */
export class BookkeeperHttpApiGroup extends HttpApiGroup.make("bookkeeper")
  .add(listWorkspaces)
  .add(getWorkspace)
  .add(registerWorkspace)
  .add(deleteWorkspace)
  .add(listProjects)
  .add(getProject)
  .add(registerProject)
  .add(deleteProject)
  .add(listIssues)
  .add(getIssue)
  .add(registerIssue)
  .add(deleteIssue)
  .add(getCounts) {}

/** Shared versioned HTTP contract used by the Bookkeeper server and client. */
export class BookkeeperHttpApi extends HttpApi.make("BookkeeperHttpApi")
  .add(BookkeeperHttpApiGroup)
  .prefix("/v1") {}
