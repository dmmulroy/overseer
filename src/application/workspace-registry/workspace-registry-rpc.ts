import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { WorkspaceId } from "../../domain/entity-id.ts";
import { IdempotencyKey, IdempotencyScope } from "../../domain/idempotency.ts";
import { WorkspaceCursor, WorkspacePageLimit } from "../../domain/pagination.ts";
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
  idempotencyScope: IdempotencyScope,
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

/** A Workspace page cursor could not be decoded. */
export class WorkspaceRegistryCursorInvalid extends Schema.TaggedErrorClass<WorkspaceRegistryCursorInvalid>()(
  "WorkspaceRegistryCursorInvalid",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The Workspace page cursor is invalid";
}

/** The requested Workspace does not exist. */
export class WorkspaceNotFound extends Schema.TaggedErrorClass<WorkspaceNotFound>()(
  "WorkspaceNotFound",
  { workspaceId: WorkspaceId },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The requested Workspace does not exist";
}

/** An idempotency key was reused for a different Workspace creation. */
export class IdempotencyKeyReused extends Schema.TaggedErrorClass<IdempotencyKeyReused>()(
  "IdempotencyKeyReused",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The idempotency key was reused for a different request";
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
};
