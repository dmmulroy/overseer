import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProjectId, WorkspaceId } from "../../domain/entity-id.ts";
import { IdempotencyKey } from "../../domain/idempotency.ts";
import {
  ProjectCursor,
  ProjectPageLimit,
  WorkspaceCursor,
  WorkspacePageLimit,
} from "../../domain/pagination.ts";
import { Project, ProjectName } from "../../domain/project.ts";
import { Workspace, WorkspaceName } from "../../domain/workspace.ts";

/** Stable name of the singleton Workspace Registry Durable Object. */
export const WORKSPACE_REGISTRY_SINGLETON_NAME = "default";

/** Plain input for listing one bounded Workspace page over private RPC. */
export const ListWorkspacesRpcInput = Schema.Struct({
  cursor: Schema.optionalKey(WorkspaceCursor),
  limit: WorkspacePageLimit,
});
/** Plain input for listing one bounded Workspace page over private RPC. */
export interface ListWorkspacesRpcInput extends Schema.Schema.Type<typeof ListWorkspacesRpcInput> {}

/** Plain Workspace page returned over private RPC. */
export const ListWorkspacesRpcResult = Schema.Struct({
  workspaces: Schema.Array(Workspace),
  cursor: Schema.NullOr(WorkspaceCursor),
  nextCursor: Schema.NullOr(WorkspaceCursor),
  limit: WorkspacePageLimit,
});
/** Plain Workspace page returned over private RPC. */
export interface ListWorkspacesRpcResult extends Schema.Schema.Type<
  typeof ListWorkspacesRpcResult
> {}

/** Plain input for idempotent Workspace creation over private RPC. */
export const CreateWorkspaceRpcInput = Schema.Struct({
  name: WorkspaceName,
  idempotencyKey: IdempotencyKey,
});
/** Plain input for idempotent Workspace creation over private RPC. */
export interface CreateWorkspaceRpcInput extends Schema.Schema.Type<
  typeof CreateWorkspaceRpcInput
> {}

/** Plain successful Workspace creation returned over private RPC. */
export const CreateWorkspaceRpcResult = Schema.Struct({
  workspace: Workspace,
  replayed: Schema.Boolean,
});
/** Plain successful Workspace creation returned over private RPC. */
export interface CreateWorkspaceRpcResult extends Schema.Schema.Type<
  typeof CreateWorkspaceRpcResult
> {}

/** Plain input for a Workspace rename over private RPC. */
export const RenameWorkspaceRpcInput = Schema.Struct({
  workspaceId: WorkspaceId,
  name: WorkspaceName,
});
/** Plain input for a Workspace rename over private RPC. */
export interface RenameWorkspaceRpcInput extends Schema.Schema.Type<
  typeof RenameWorkspaceRpcInput
> {}

/** Plain input for listing one bounded Project page over private RPC. */
export const ListProjectsRpcInput = Schema.Struct({
  workspaceId: Schema.optionalKey(WorkspaceId),
  cursor: Schema.optionalKey(ProjectCursor),
  limit: ProjectPageLimit,
});
/** Plain input for listing one bounded Project page over private RPC. */
export interface ListProjectsRpcInput extends Schema.Schema.Type<typeof ListProjectsRpcInput> {}

/** Plain Project page returned over private RPC. */
export const ListProjectsRpcResult = Schema.Struct({
  projects: Schema.Array(Project),
  cursor: Schema.NullOr(ProjectCursor),
  nextCursor: Schema.NullOr(ProjectCursor),
  limit: ProjectPageLimit,
});
/** Plain Project page returned over private RPC. */
export interface ListProjectsRpcResult extends Schema.Schema.Type<typeof ListProjectsRpcResult> {}

/** Plain input for idempotent Project creation over private RPC. */
export const CreateProjectRpcInput = Schema.Struct({
  workspaceId: WorkspaceId,
  name: ProjectName,
  idempotencyKey: IdempotencyKey,
});
/** Plain input for idempotent Project creation over private RPC. */
export interface CreateProjectRpcInput extends Schema.Schema.Type<typeof CreateProjectRpcInput> {}

/** Plain successful Project creation returned over private RPC. */
export const CreateProjectRpcResult = Schema.Struct({ project: Project, replayed: Schema.Boolean });
/** Plain successful Project creation returned over private RPC. */
export interface CreateProjectRpcResult extends Schema.Schema.Type<typeof CreateProjectRpcResult> {}

/** Plain input for a Project rename over private RPC. */
export const RenameProjectRpcInput = Schema.Struct({ projectId: ProjectId, name: ProjectName });
/** Plain input for a Project rename over private RPC. */
export interface RenameProjectRpcInput extends Schema.Schema.Type<typeof RenameProjectRpcInput> {}

/** Plain input for an idempotent Project move over private RPC. */
export const MoveProjectRpcInput = Schema.Struct({
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  idempotencyKey: IdempotencyKey,
});
/** Plain input for an idempotent Project move over private RPC. */
export interface MoveProjectRpcInput extends Schema.Schema.Type<typeof MoveProjectRpcInput> {}

/** Plain successful Project move returned over private RPC. */
export const MoveProjectRpcResult = Schema.Struct({ project: Project, replayed: Schema.Boolean });
/** Plain successful Project move returned over private RPC. */
export interface MoveProjectRpcResult extends Schema.Schema.Type<typeof MoveProjectRpcResult> {}

/** A collection page cursor could not be decoded. */
export class WorkspaceRegistryCursorInvalid extends Schema.TaggedErrorClass<WorkspaceRegistryCursorInvalid>()(
  "WorkspaceRegistryCursorInvalid",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The Workspace Registry page cursor is invalid";
}
/** The requested Workspace does not exist. */
export class WorkspaceNotFound extends Schema.TaggedErrorClass<WorkspaceNotFound>()(
  "WorkspaceNotFound",
  { workspaceId: WorkspaceId },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The requested Workspace does not exist";
}
/** The requested Project does not exist. */
export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()("ProjectNotFound", {
  projectId: ProjectId,
}) {
  /** Stable safe diagnostic message. */
  override readonly message = "The requested Project does not exist";
}
/** An idempotency key already identifies another Workspace Registry operation. */
export class IdempotencyKeyReused extends Schema.TaggedErrorClass<IdempotencyKeyReused>()(
  "IdempotencyKeyReused",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The idempotency key identifies another Workspace Registry operation";
}
/** A Project move already has the requested membership. */
export class ProjectMoveNotApplicable extends Schema.TaggedErrorClass<ProjectMoveNotApplicable>()(
  "ProjectMoveNotApplicable",
  { project: Project, targetWorkspaceId: WorkspaceId },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The Project already belongs to the requested Workspace";
}
/** A persisted Workspace Registry record is corrupt. */
export class WorkspaceRegistryRecordCorrupt extends Schema.TaggedErrorClass<WorkspaceRegistryRecordCorrupt>()(
  "WorkspaceRegistryRecordCorrupt",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A persisted Workspace Registry record is corrupt";
}
/** Workspace Registry persistence is unavailable. */
export class WorkspaceRegistryStateUnavailable extends Schema.TaggedErrorClass<WorkspaceRegistryStateUnavailable>()(
  "WorkspaceRegistryStateUnavailable",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "Workspace Registry persistence is unavailable";
}
/** One same-deployment schemaless RPC call could not complete. */
export class WorkspaceRegistryRpcCallFailed extends Schema.TaggedErrorClass<WorkspaceRegistryRpcCallFailed>()(
  "WorkspaceRegistryRpcCallFailed",
  {
    operation: Schema.Literals([
      "listWorkspaces",
      "readWorkspace",
      "createWorkspace",
      "renameWorkspace",
      "listProjects",
      "readProject",
      "createProject",
      "renameProject",
      "moveProject",
    ]),
    cause: Schema.Defect(),
  },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The Workspace Registry RPC call failed";
}

/** Safe persistence failures that may cross private RPC. */
export type WorkspaceRegistryRemotePersistenceError =
  | WorkspaceRegistryRecordCorrupt
  | WorkspaceRegistryStateUnavailable;

/** Operation-specific schemaless RPC implemented by the Workspace Registry object. */
export type WorkspaceRegistryRpc = {
  readonly listWorkspaces: (
    input: ListWorkspacesRpcInput,
  ) => Effect.Effect<
    ListWorkspacesRpcResult,
    WorkspaceRegistryCursorInvalid | WorkspaceRegistryRemotePersistenceError
  >;
  readonly readWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Workspace, WorkspaceNotFound | WorkspaceRegistryRemotePersistenceError>;
  readonly createWorkspace: (
    input: CreateWorkspaceRpcInput,
  ) => Effect.Effect<
    CreateWorkspaceRpcResult,
    IdempotencyKeyReused | WorkspaceRegistryRemotePersistenceError
  >;
  readonly renameWorkspace: (
    input: RenameWorkspaceRpcInput,
  ) => Effect.Effect<Workspace, WorkspaceNotFound | WorkspaceRegistryRemotePersistenceError>;
  readonly listProjects: (
    input: ListProjectsRpcInput,
  ) => Effect.Effect<
    ListProjectsRpcResult,
    WorkspaceRegistryCursorInvalid | WorkspaceNotFound | WorkspaceRegistryRemotePersistenceError
  >;
  readonly readProject: (
    projectId: ProjectId,
  ) => Effect.Effect<Project, ProjectNotFound | WorkspaceRegistryRemotePersistenceError>;
  readonly createProject: (
    input: CreateProjectRpcInput,
  ) => Effect.Effect<
    CreateProjectRpcResult,
    WorkspaceNotFound | IdempotencyKeyReused | WorkspaceRegistryRemotePersistenceError
  >;
  readonly renameProject: (
    input: RenameProjectRpcInput,
  ) => Effect.Effect<Project, ProjectNotFound | WorkspaceRegistryRemotePersistenceError>;
  readonly moveProject: (
    input: MoveProjectRpcInput,
  ) => Effect.Effect<
    MoveProjectRpcResult,
    | WorkspaceNotFound
    | ProjectNotFound
    | ProjectMoveNotApplicable
    | IdempotencyKeyReused
    | WorkspaceRegistryRemotePersistenceError
  >;
};
