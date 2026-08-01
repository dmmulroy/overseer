import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CommandAttribution } from "../../domain/actor.ts";
import { IssueId, LabelId, ProjectId } from "../../domain/entity-id.ts";
import { IdempotencyKey } from "../../domain/idempotency.ts";
import {
  Assignee,
  Issue,
  IssueBody,
  IssueNumber,
  IssueReference,
  IssueRevision,
  IssueTimelineEntry,
  IssueTitle,
} from "../../domain/issue.ts";
import {
  IssueCursorInvalid,
  IssueNotFound,
  ProjectIdempotencyKeyReused,
  type IssuePage,
  type ListIssuesInput,
} from "../issues/issue-discovery.ts";
import {
  IssueAssigneeStatusFilter,
  IssueBlockingStatusFilter,
  IssueCursor,
  IssueLabelMatchFilter,
  IssueLifecycleFilter,
  IssuePageLimit,
  IssueSort,
  IssueSortDirection,
  IssueStateFilter,
} from "../../domain/pagination.ts";

/** Plain input for idempotent Issue creation over private RPC. */
export const CreateIssueRpcInput = Schema.Struct({
  projectId: ProjectId,
  title: IssueTitle,
  body: Schema.OptionFromNullOr(IssueBody),
  idempotencyKey: IdempotencyKey,
  attribution: CommandAttribution,
});

/** Plain input for idempotent Issue creation over private RPC. */
export interface CreateIssueRpcInput extends Schema.Schema.Type<typeof CreateIssueRpcInput> {}

/** Plain normalized Project Issue page request over private RPC. */
export const ListIssuesRpcInput = Schema.Struct({
  projectId: ProjectId,
  state: IssueStateFilter,
  lifecycle: IssueLifecycleFilter,
  assignee: Schema.OptionFromNullOr(Assignee),
  assigneeStatus: IssueAssigneeStatusFilter,
  labelIds: Schema.Array(LabelId),
  labelMatch: IssueLabelMatchFilter,
  parent: Schema.OptionFromNullOr(Schema.Union([Schema.Literal("root"), IssueId])),
  blockingStatus: IssueBlockingStatusFilter,
  number: Schema.OptionFromNullOr(IssueNumber),
  sort: IssueSort,
  direction: IssueSortDirection,
  cursor: Schema.OptionFromNullOr(IssueCursor),
  limit: IssuePageLimit,
});

/** Plain normalized Project Issue page request over private RPC. */
export interface ListIssuesRpcInput extends Schema.Schema.Type<typeof ListIssuesRpcInput> {}

/** Plain exact Project Issue page returned over private RPC. */
export const ListIssuesRpcResult = Schema.Struct({
  issues: Schema.Array(Issue),
  previousCursor: Schema.OptionFromNullOr(IssueCursor),
  nextCursor: Schema.OptionFromNullOr(IssueCursor),
});

/** Plain exact Project Issue page returned over private RPC. */
export interface ListIssuesRpcResult extends Schema.Schema.Type<typeof ListIssuesRpcResult> {}

/** Plain successful Issue creation returned over private RPC. */
export const CreateIssueRpcResult = Schema.Struct({ issue: Issue, replayed: Schema.Boolean });

/** Plain successful Issue creation returned over private RPC. */
export interface CreateIssueRpcResult extends Schema.Schema.Type<typeof CreateIssueRpcResult> {}

/** A persisted Project record is corrupt. */
export class ProjectRecordCorrupt extends Schema.TaggedErrorClass<ProjectRecordCorrupt>()(
  "ProjectRecordCorrupt",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A persisted Project record is corrupt";
}

/** Project persistence is unavailable. */
export class ProjectStateUnavailable extends Schema.TaggedErrorClass<ProjectStateUnavailable>()(
  "ProjectStateUnavailable",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "Project persistence is unavailable";
}

/** One same-deployment Project RPC call could not complete. */
export class ProjectRpcCallFailed extends Schema.TaggedErrorClass<ProjectRpcCallFailed>()(
  "ProjectRpcCallFailed",
  {
    operation: Schema.Literals([
      "createIssue",
      "listIssues",
      "readIssue",
      "readIssueByNumber",
      "readIssueRevisions",
      "readIssueTimeline",
      "readIssueReferences",
    ]),
    cause: Schema.Defect(),
  },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The Project RPC call failed";
}

/** Safe Project persistence failures that may cross private RPC. */
export type ProjectRemotePersistenceError = ProjectRecordCorrupt | ProjectStateUnavailable;

/** Issue Revisions returned over private RPC. */
export const IssueRevisionsRpcResult = Schema.Array(IssueRevision);

/** Issue Timeline entries returned over private RPC. */
export const IssueTimelineRpcResult = Schema.Array(IssueTimelineEntry);

/** Current same-Project references returned over private RPC. */
export const IssueReferencesRpcResult = Schema.Struct({
  outgoing: Schema.Array(IssueReference),
  incoming: Schema.Array(IssueReference),
});

/** Current same-Project references returned over private RPC. */
export interface IssueReferencesRpcResult extends Schema.Schema.Type<
  typeof IssueReferencesRpcResult
> {}

/** Operation-specific schemaless RPC implemented by one Project object. */
export type ProjectRpc = {
  readonly createIssue: (
    input: typeof CreateIssueRpcInput.Encoded,
  ) => Effect.Effect<
    typeof CreateIssueRpcResult.Encoded,
    ProjectIdempotencyKeyReused | ProjectRemotePersistenceError
  >;
  readonly listIssues: (
    input: typeof ListIssuesRpcInput.Encoded,
  ) => Effect.Effect<
    typeof ListIssuesRpcResult.Encoded,
    IssueCursorInvalid | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
  readonly readIssue: (
    issueId: IssueId,
  ) => Effect.Effect<typeof Issue.Encoded, IssueNotFound | ProjectRemotePersistenceError>;
  readonly readIssueByNumber: (
    number: IssueNumber,
  ) => Effect.Effect<typeof Issue.Encoded, IssueNotFound | ProjectRemotePersistenceError>;
  readonly readIssueRevisions: (
    issueId: IssueId,
  ) => Effect.Effect<
    typeof IssueRevisionsRpcResult.Encoded,
    IssueNotFound | ProjectRemotePersistenceError
  >;
  readonly readIssueTimeline: (
    issueId: IssueId,
  ) => Effect.Effect<
    typeof IssueTimelineRpcResult.Encoded,
    IssueNotFound | ProjectRemotePersistenceError
  >;
  readonly readIssueReferences: (
    issueId: IssueId,
  ) => Effect.Effect<
    typeof IssueReferencesRpcResult.Encoded,
    IssueNotFound | ProjectRemotePersistenceError
  >;
};

/** Gateway-facing operations provided by the Project RPC adapter. */
export type ProjectClient = {
  readonly createIssue: (
    input: CreateIssueRpcInput,
  ) => Effect.Effect<
    CreateIssueRpcResult,
    ProjectIdempotencyKeyReused | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
  readonly listIssues: (
    input: ListIssuesInput,
  ) => Effect.Effect<
    IssuePage,
    IssueCursorInvalid | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
  readonly readIssue: (
    projectId: ProjectId,
    issueId: IssueId,
  ) => Effect.Effect<Issue, IssueNotFound | ProjectRemotePersistenceError | ProjectRpcCallFailed>;
  readonly readIssueByNumber: (
    projectId: ProjectId,
    number: IssueNumber,
  ) => Effect.Effect<Issue, IssueNotFound | ProjectRemotePersistenceError | ProjectRpcCallFailed>;
  readonly readIssueRevisions: (
    projectId: ProjectId,
    issueId: IssueId,
  ) => Effect.Effect<
    ReadonlyArray<IssueRevision>,
    IssueNotFound | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
  readonly readIssueTimeline: (
    projectId: ProjectId,
    issueId: IssueId,
  ) => Effect.Effect<
    ReadonlyArray<IssueTimelineEntry>,
    IssueNotFound | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
  readonly readIssueReferences: (
    projectId: ProjectId,
    issueId: IssueId,
  ) => Effect.Effect<
    IssueReferencesRpcResult,
    IssueNotFound | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
};

/** Effect service exposing Gateway-facing Project operations. */
export class ProjectClientService extends Context.Service<ProjectClientService, ProjectClient>()(
  "@overseer/application/ProjectClient",
) {}
