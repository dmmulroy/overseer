import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CommandAttribution } from "../../domain/actor.ts";
import { IssueId, LabelId, ProjectId, TimelineEventId } from "../../domain/entity-id.ts";
import { IdempotencyKey } from "../../domain/idempotency.ts";
import {
  Assignee,
  Issue,
  IssueBody,
  IssueNumber,
  IssueReference,
  IssueRevision,
  IssueTimelineEvent,
  IssueTitle,
  TimelinePosition,
} from "../../domain/issue.ts";
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
  TimelineCursor,
  TimelinePageLimit,
} from "../../domain/pagination.ts";
import type { SteerIssueStateInput, SteerIssueStateResult } from "../issues/issue-steering.ts";
import {
  type CreateIssueInput,
  type CreateIssueResult,
  type IssueCursorInvalid,
  type IssueNotFound,
  type IssuePage,
  type IssueReferences,
  type IssueTimelinePage,
  type ListIssuesInput,
  type ProjectIdempotencyKeyReused,
  type ReadIssueTimelineInput,
  type TimelineCursorInvalid,
} from "../issues/issue-discovery.ts";

/** Structured-clone representation for idempotent Issue creation. */
export const CreateIssueRpcInput = Schema.Struct({
  projectId: ProjectId,
  title: IssueTitle,
  body: Schema.OptionFromNullOr(IssueBody),
  idempotencyKey: IdempotencyKey,
  attribution: CommandAttribution,
});
/** Trusted same-deployment input for idempotent Issue creation. */
export type CreateIssueRpcInput = CreateIssueInput;
/** Structured-clone representation for a successful Issue creation. */
export const CreateIssueRpcResult = Schema.Struct({ issue: Issue, replayed: Schema.Boolean });
/** Trusted same-deployment successful Issue creation result. */
export type CreateIssueRpcResult = CreateIssueResult;
/** Structured-clone representation for one Issue state action. */
export const SteerIssueStateRpcInput = Schema.Struct({
  issueId: IssueId,
  idempotencyKey: IdempotencyKey,
  attribution: CommandAttribution,
});
/** Trusted same-deployment input for one Issue close or reopen action. */
export type SteerIssueStateRpcInput = SteerIssueStateInput;
/** Structured-clone representation for one Issue state result. */
export const SteerIssueStateRpcResult = Schema.Struct({ issue: Issue, replayed: Schema.Boolean });
/** Trusted same-deployment close or reopen result. */
export type SteerIssueStateRpcResult = SteerIssueStateResult;
/** Structured-clone representation for one normalized Issue page request. */
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
/** Trusted same-deployment normalized Project Issue page request. */
export type ListIssuesRpcInput = ListIssuesInput;
/** Structured-clone representation for one exact Issue page. */
export const ListIssuesRpcResult = Schema.Struct({
  issues: Schema.Array(Issue),
  previousCursor: Schema.OptionFromNullOr(IssueCursor),
  nextCursor: Schema.OptionFromNullOr(IssueCursor),
});
/** Trusted same-deployment exact Project Issue page. */
export type ListIssuesRpcResult = IssuePage;
/** Structured-clone representation for one Timeline page request. */
export const ReadIssueTimelineRpcInput = Schema.Struct({
  issueId: IssueId,
  cursor: Schema.OptionFromNullOr(TimelineCursor),
  limit: TimelinePageLimit,
});
/** Structured-clone representation for one Timeline page. */
export const IssueTimelinePageRpcResult = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      position: TimelinePosition,
      event: IssueTimelineEvent,
    }),
  ),
  previousCursor: Schema.OptionFromNullOr(TimelineCursor),
  nextCursor: Schema.OptionFromNullOr(TimelineCursor),
});
/** Structured-clone representation for Issue Revision results. */
export const IssueRevisionsRpcResult = Schema.Array(IssueRevision);
/** Structured-clone representation for reciprocal Issue references. */
export const IssueReferencesRpcResult = Schema.Struct({
  outgoing: Schema.Array(IssueReference),
  incoming: Schema.Array(IssueReference),
});

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
      "closeIssue",
      "reopenIssue",
      "listIssues",
      "readIssue",
      "readIssueByNumber",
      "readIssueRevisions",
      "readIssueTimeline",
      "readTimelineEvent",
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

/** Operation-specific structured-clone RPC implemented by one Project object. */
export type ProjectRpc = {
  readonly createIssue: (
    input: typeof CreateIssueRpcInput.Encoded,
  ) => Effect.Effect<
    typeof CreateIssueRpcResult.Encoded,
    ProjectIdempotencyKeyReused | ProjectRemotePersistenceError
  >;
  readonly closeIssue: (
    input: typeof SteerIssueStateRpcInput.Encoded,
  ) => Effect.Effect<
    typeof SteerIssueStateRpcResult.Encoded,
    IssueNotFound | ProjectIdempotencyKeyReused | ProjectRemotePersistenceError
  >;
  readonly reopenIssue: (
    input: typeof SteerIssueStateRpcInput.Encoded,
  ) => Effect.Effect<
    typeof SteerIssueStateRpcResult.Encoded,
    IssueNotFound | ProjectIdempotencyKeyReused | ProjectRemotePersistenceError
  >;
  readonly listIssues: (
    input: typeof ListIssuesRpcInput.Encoded,
  ) => Effect.Effect<
    typeof ListIssuesRpcResult.Encoded,
    IssueCursorInvalid | ProjectRemotePersistenceError
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
    input: typeof ReadIssueTimelineRpcInput.Encoded,
  ) => Effect.Effect<
    typeof IssueTimelinePageRpcResult.Encoded,
    TimelineCursorInvalid | IssueNotFound | ProjectRemotePersistenceError
  >;
  readonly readTimelineEvent: (
    issueId: IssueId,
    eventId: TimelineEventId,
  ) => Effect.Effect<
    typeof IssueTimelineEvent.Encoded,
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
    input: CreateIssueInput,
  ) => Effect.Effect<
    CreateIssueResult,
    ProjectIdempotencyKeyReused | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
  readonly closeIssue: (
    projectId: ProjectId,
    input: SteerIssueStateInput,
  ) => Effect.Effect<
    SteerIssueStateResult,
    | IssueNotFound
    | ProjectIdempotencyKeyReused
    | ProjectRemotePersistenceError
    | ProjectRpcCallFailed
  >;
  readonly reopenIssue: (
    projectId: ProjectId,
    input: SteerIssueStateInput,
  ) => Effect.Effect<
    SteerIssueStateResult,
    | IssueNotFound
    | ProjectIdempotencyKeyReused
    | ProjectRemotePersistenceError
    | ProjectRpcCallFailed
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
    input: ReadIssueTimelineInput,
  ) => Effect.Effect<
    IssueTimelinePage,
    TimelineCursorInvalid | IssueNotFound | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
  readonly readTimelineEvent: (
    projectId: ProjectId,
    issueId: IssueId,
    eventId: TimelineEventId,
  ) => Effect.Effect<
    IssueTimelineEvent,
    IssueNotFound | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
  readonly readIssueReferences: (
    projectId: ProjectId,
    issueId: IssueId,
  ) => Effect.Effect<
    IssueReferences,
    IssueNotFound | ProjectRemotePersistenceError | ProjectRpcCallFailed
  >;
};

/** Effect service exposing Gateway-facing Project operations. */
export class ProjectClientService extends Context.Service<ProjectClientService, ProjectClient>()(
  "@overseer/application/ProjectClient",
) {}
