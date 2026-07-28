import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CommandAttribution } from "../../domain/actor.ts";
import { IssueId, ProjectId } from "../../domain/entity-id.ts";
import { IdempotencyKey } from "../../domain/idempotency.ts";
import {
  Issue,
  IssueBody,
  IssueNumber,
  IssueReference,
  IssueRevision,
  IssueTimelineEntry,
  IssueTitle,
} from "../../domain/issue.ts";
import { IssueNotFound, ProjectIdempotencyKeyReused } from "../issues/issue-discovery.ts";

/** Plain input for idempotent Issue creation over private RPC. */
export const CreateIssueRpcInput = Schema.Struct({
  projectId: ProjectId,
  title: IssueTitle,
  body: Schema.NullOr(IssueBody),
  idempotencyKey: IdempotencyKey,
  attribution: CommandAttribution,
});

/** Plain input for idempotent Issue creation over private RPC. */
export interface CreateIssueRpcInput extends Schema.Schema.Type<typeof CreateIssueRpcInput> {}

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
    input: CreateIssueRpcInput,
  ) => Effect.Effect<
    CreateIssueRpcResult,
    ProjectIdempotencyKeyReused | ProjectRemotePersistenceError
  >;
  readonly readIssue: (
    issueId: IssueId,
  ) => Effect.Effect<Issue, IssueNotFound | ProjectRemotePersistenceError>;
  readonly readIssueByNumber: (
    number: IssueNumber,
  ) => Effect.Effect<Issue, IssueNotFound | ProjectRemotePersistenceError>;
  readonly readIssueRevisions: (
    issueId: IssueId,
  ) => Effect.Effect<ReadonlyArray<IssueRevision>, IssueNotFound | ProjectRemotePersistenceError>;
  readonly readIssueTimeline: (
    issueId: IssueId,
  ) => Effect.Effect<
    ReadonlyArray<IssueTimelineEntry>,
    IssueNotFound | ProjectRemotePersistenceError
  >;
  readonly readIssueReferences: (
    issueId: IssueId,
  ) => Effect.Effect<IssueReferencesRpcResult, IssueNotFound | ProjectRemotePersistenceError>;
};

/** Gateway-facing operations provided by the Project RPC adapter. */
export type ProjectClient = {
  readonly createIssue: (
    input: CreateIssueRpcInput,
  ) => Effect.Effect<
    CreateIssueRpcResult,
    ProjectIdempotencyKeyReused | ProjectRemotePersistenceError | ProjectRpcCallFailed
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
