import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** Maximum number of Workspaces accepted and returned by one page request. */
export const WorkspacePageLimit = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
).pipe(Schema.brand("WorkspacePageLimit"));

/** Maximum number of Workspaces accepted and returned by one page request. */
export type WorkspacePageLimit = typeof WorkspacePageLimit.Type;

/** Parse a decimal query value into a branded Workspace page limit. */
export const WorkspacePageLimitFromString = Schema.NumberFromString.pipe(
  Schema.decodeTo(WorkspacePageLimit, SchemaTransformation.passthrough()),
);

/** Opaque keyset cursor for one Workspace collection page. */
export const WorkspaceCursor = Schema.String.pipe(Schema.brand("WorkspaceCursor"));

/** Opaque keyset cursor for one Workspace collection page. */
export type WorkspaceCursor = typeof WorkspaceCursor.Type;

/** Maximum number of Projects accepted and returned by one page request. */
export const ProjectPageLimit = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
).pipe(Schema.brand("ProjectPageLimit"));

/** Maximum number of Projects accepted and returned by one page request. */
export type ProjectPageLimit = typeof ProjectPageLimit.Type;

/** Parse a decimal query value into a branded Project page limit. */
export const ProjectPageLimitFromString = Schema.NumberFromString.pipe(
  Schema.decodeTo(ProjectPageLimit, SchemaTransformation.passthrough()),
);

/** Opaque keyset cursor bound to one Project collection scope. */
export const ProjectCursor = Schema.String.pipe(Schema.brand("ProjectCursor"));

/** Opaque keyset cursor bound to one Project collection scope. */
export type ProjectCursor = typeof ProjectCursor.Type;

/** Maximum number of Issues accepted and returned by one Project page request. */
export const IssuePageLimit = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
).pipe(Schema.brand("IssuePageLimit"));

/** Maximum number of Issues accepted and returned by one Project page request. */
export type IssuePageLimit = typeof IssuePageLimit.Type;

/** Parse a decimal query value into a branded Issue page limit. */
export const IssuePageLimitFromString = Schema.NumberFromString.pipe(
  Schema.decodeTo(IssuePageLimit, SchemaTransformation.passthrough()),
);

/** Opaque keyset cursor bound to one exact filtered and ordered Issue page. */
export const IssueCursor = Schema.String.pipe(Schema.brand("IssueCursor"));

/** Opaque keyset cursor bound to one exact filtered and ordered Issue page. */
export type IssueCursor = typeof IssueCursor.Type;

/** Project Issue state filter. */
export const IssueStateFilter = Schema.Literals(["open", "closed", "all"]);

/** Project Issue state filter. */
export type IssueStateFilter = typeof IssueStateFilter.Type;

/** Project Issue lifecycle filter. */
export const IssueLifecycleFilter = Schema.Literals(["live", "deleted", "all"]);

/** Project Issue lifecycle filter. */
export type IssueLifecycleFilter = typeof IssueLifecycleFilter.Type;

/** Project Issue assignee-presence filter. */
export const IssueAssigneeStatusFilter = Schema.Literals(["assigned", "unassigned", "any"]);

/** Project Issue assignee-presence filter. */
export type IssueAssigneeStatusFilter = typeof IssueAssigneeStatusFilter.Type;

/** Repeated Label matching policy for a Project Issue page. */
export const IssueLabelMatchFilter = Schema.Literals(["any", "all"]);

/** Repeated Label matching policy for a Project Issue page. */
export type IssueLabelMatchFilter = typeof IssueLabelMatchFilter.Type;

/** Active-blocker status filter for a Project Issue page. */
export const IssueBlockingStatusFilter = Schema.Literals(["blocked", "unblocked", "any"]);

/** Active-blocker status filter for a Project Issue page. */
export type IssueBlockingStatusFilter = typeof IssueBlockingStatusFilter.Type;

/** Documented sort keys for Project Issue pages. */
export const IssueSort = Schema.Literals(["number", "created_at", "updated_at"]);

/** Documented sort keys for Project Issue pages. */
export type IssueSort = typeof IssueSort.Type;

/** Sort direction for Project Issue pages. */
export const IssueSortDirection = Schema.Literals(["asc", "desc"]);

/** Sort direction for Project Issue pages. */
export type IssueSortDirection = typeof IssueSortDirection.Type;
