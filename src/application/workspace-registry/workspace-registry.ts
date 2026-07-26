import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { makeWorkspaceId, type WorkspaceId } from "../../domain/entity-id.ts";
import type { IdempotencyKey, IdempotencyScope } from "../../domain/idempotency.ts";
import type { WorkspaceCursor, WorkspacePageLimit } from "../../domain/pagination.ts";
import {
  Workspace,
  type Workspace as WorkspaceType,
  type WorkspaceName,
  WorkspaceTimestamp,
  advanceWorkspaceTimestamp,
} from "../../domain/workspace.ts";
import { UlidGeneratorService } from "../ulid-generator.ts";
import {
  type CreateWorkspaceRpcInput,
  type CreateWorkspaceRpcResult,
  IdempotencyKeyReused,
  type ListWorkspacesRpcInput,
  WorkspaceNotFound,
  WorkspaceRegistryCursorInvalid,
  type WorkspaceRegistryRemotePersistenceError,
  WorkspaceRegistryRpcCallFailed,
} from "./workspace-registry-rpc.ts";

/** Canonical fingerprint of one idempotent request. */
export const IdempotencyFingerprint = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1_000),
).pipe(Schema.brand("IdempotencyFingerprint"));

/** Canonical fingerprint of one idempotent request. */
export type IdempotencyFingerprint = typeof IdempotencyFingerprint.Type;

/** Inputs selecting one bounded Workspace collection page. */
export type ListWorkspacesInput = {
  readonly cursor: Option.Option<WorkspaceCursor>;
  readonly limit: WorkspacePageLimit;
};

/** Parsed Workspace page returned by the Workspace Registry. */
export type WorkspacePage = {
  readonly workspaces: ReadonlyArray<WorkspaceType>;
  readonly cursor: Option.Option<WorkspaceCursor>;
  readonly nextCursor: Option.Option<WorkspaceCursor>;
  readonly limit: WorkspacePageLimit;
};

/** A stored record failed parsing inside the owning persistence adapter. */
export class WorkspaceRegistryStoredRecordCorrupt extends Schema.TaggedErrorClass<WorkspaceRegistryStoredRecordCorrupt>()(
  "WorkspaceRegistryStoredRecordCorrupt",
  {
    recordType: Schema.Literals(["workspace", "idempotency"]),
    cause: Schema.Defect(),
  },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A stored Workspace Registry record could not be decoded";
}

/** A Workspace Registry persistence operation failed. */
export class WorkspaceRegistryPersistenceUnavailable extends Schema.TaggedErrorClass<WorkspaceRegistryPersistenceUnavailable>()(
  "WorkspaceRegistryPersistenceUnavailable",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A Workspace Registry persistence operation failed";
}

/** Detailed persistence failures retained inside the Durable Object. */
export type WorkspaceRegistryPersistenceError =
  | WorkspaceRegistryStoredRecordCorrupt
  | WorkspaceRegistryPersistenceUnavailable;

/** Retained successful creation used for idempotent replay. */
export type RetainedWorkspaceCreation = {
  readonly fingerprint: IdempotencyFingerprint;
  readonly workspace: WorkspaceType;
};

/** Transactional persistence capability required by Workspace Registry policy. */
export type WorkspaceRegistryState = {
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | WorkspaceRegistryPersistenceError, R>;
  readonly listWorkspaces: (
    request: ListWorkspacesRpcInput,
  ) => Effect.Effect<
    WorkspacePage,
    WorkspaceRegistryCursorInvalid | WorkspaceRegistryPersistenceError
  >;
  readonly findIdempotency: (
    scope: IdempotencyScope,
    key: IdempotencyKey,
  ) => Effect.Effect<Option.Option<RetainedWorkspaceCreation>, WorkspaceRegistryPersistenceError>;
  readonly insertCreation: (
    workspace: WorkspaceType,
    scope: IdempotencyScope,
    key: IdempotencyKey,
    fingerprint: IdempotencyFingerprint,
  ) => Effect.Effect<void, WorkspaceRegistryPersistenceError>;
  readonly findWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Option.Option<WorkspaceType>, WorkspaceRegistryPersistenceError>;
  readonly updateWorkspaceName: (
    workspace: WorkspaceType,
  ) => Effect.Effect<void, WorkspaceRegistryPersistenceError>;
};

/** Effect service for Workspace Registry persistence. */
export class WorkspaceRegistryStateService extends Context.Service<
  WorkspaceRegistryStateService,
  WorkspaceRegistryState
>()("@overseer/application/WorkspaceRegistryState") {}

/** Detailed operations executed inside the singleton Workspace Registry object. */
export type WorkspaceRegistryLocal = {
  readonly listWorkspaces: (
    input: ListWorkspacesRpcInput,
  ) => Effect.Effect<
    WorkspacePage,
    WorkspaceRegistryCursorInvalid | WorkspaceRegistryPersistenceError
  >;
  readonly readWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<WorkspaceType, WorkspaceNotFound | WorkspaceRegistryPersistenceError>;
  readonly createWorkspace: (
    input: CreateWorkspaceRpcInput,
  ) => Effect.Effect<
    CreateWorkspaceRpcResult,
    IdempotencyKeyReused | WorkspaceRegistryPersistenceError
  >;
  readonly renameWorkspace: (
    workspaceId: WorkspaceId,
    name: WorkspaceName,
  ) => Effect.Effect<WorkspaceType, WorkspaceNotFound | WorkspaceRegistryPersistenceError>;
};

/** Effect service for object-local Workspace Registry operations. */
export class WorkspaceRegistryLocalService extends Context.Service<
  WorkspaceRegistryLocalService,
  WorkspaceRegistryLocal
>()("@overseer/application/WorkspaceRegistryLocal") {}

const CreateWorkspaceFingerprint = Schema.fromJsonString(
  Schema.Tuple([Schema.Literal("CreateWorkspace"), Workspace.fields.name]),
);

/** Construct object-local Workspace Registry policy from its state and ID services. */
export const make = Effect.gen(function* () {
  const state = yield* WorkspaceRegistryStateService;
  const ulids = yield* UlidGeneratorService;

  return WorkspaceRegistryLocalService.of({
    listWorkspaces: Effect.fn("WorkspaceRegistry.listWorkspaces")((input) =>
      state.listWorkspaces(input),
    ),
    readWorkspace: Effect.fn("WorkspaceRegistry.readWorkspace")(function* (workspaceId) {
      const workspace = yield* state.findWorkspace(workspaceId);
      if (Option.isNone(workspace)) {
        return yield* new WorkspaceNotFound({ workspaceId });
      }
      return workspace.value;
    }),
    createWorkspace: Effect.fn("WorkspaceRegistry.createWorkspace")(function* (input) {
      return yield* state.transaction(
        Effect.gen(function* () {
          const fingerprint = IdempotencyFingerprint.make(
            Schema.encodeSync(CreateWorkspaceFingerprint)(["CreateWorkspace", input.name]),
          );
          const retained = yield* state.findIdempotency(
            input.idempotencyScope,
            input.idempotencyKey,
          );
          if (Option.isSome(retained)) {
            if (retained.value.fingerprint !== fingerprint) {
              return yield* new IdempotencyKeyReused();
            }
            return {
              workspace: retained.value.workspace,
              replayed: true,
            };
          }

          const now = yield* DateTime.now;
          const timestamp = WorkspaceTimestamp.make(DateTime.formatIso(now));
          const workspace = Workspace.make({
            id: makeWorkspaceId(yield* ulids.next()),
            name: input.name,
            lifecycle: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          yield* state.insertCreation(
            workspace,
            input.idempotencyScope,
            input.idempotencyKey,
            fingerprint,
          );
          return { workspace, replayed: false };
        }),
      );
    }),
    renameWorkspace: Effect.fn("WorkspaceRegistry.renameWorkspace")(function* (workspaceId, name) {
      return yield* state.transaction(
        Effect.gen(function* () {
          const current = yield* state.findWorkspace(workspaceId);
          if (Option.isNone(current)) {
            return yield* new WorkspaceNotFound({ workspaceId });
          }
          if (current.value.name === name) {
            return current.value;
          }
          const now = yield* DateTime.now;
          const candidateTimestamp = WorkspaceTimestamp.make(DateTime.formatIso(now));
          const workspace = Workspace.make({
            ...current.value,
            name,
            updatedAt: advanceWorkspaceTimestamp(current.value.updatedAt, candidateTimestamp),
          });
          yield* state.updateWorkspaceName(workspace);
          return workspace;
        }),
      );
    }),
  });
});

/** Production Workspace Registry policy layer. */
export const layer = Layer.effect(WorkspaceRegistryLocalService, make);

/** Workspace Registry operations used by the Gateway HTTP adapter. */
export type WorkspaceRegistry = {
  readonly listWorkspaces: (
    input: ListWorkspacesInput,
  ) => Effect.Effect<
    WorkspacePage,
    | WorkspaceRegistryCursorInvalid
    | WorkspaceRegistryRemotePersistenceError
    | WorkspaceRegistryRpcCallFailed
  >;
  readonly readWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<
    WorkspaceType,
    WorkspaceNotFound | WorkspaceRegistryRemotePersistenceError | WorkspaceRegistryRpcCallFailed
  >;
  readonly createWorkspace: (
    input: CreateWorkspaceRpcInput,
  ) => Effect.Effect<
    CreateWorkspaceRpcResult,
    IdempotencyKeyReused | WorkspaceRegistryRemotePersistenceError | WorkspaceRegistryRpcCallFailed
  >;
  readonly renameWorkspace: (
    workspaceId: WorkspaceId,
    name: WorkspaceName,
  ) => Effect.Effect<
    WorkspaceType,
    WorkspaceNotFound | WorkspaceRegistryRemotePersistenceError | WorkspaceRegistryRpcCallFailed
  >;
};

/** Effect service exposing Gateway-facing Workspace Registry operations. */
export class WorkspaceRegistryService extends Context.Service<
  WorkspaceRegistryService,
  WorkspaceRegistry
>()("@overseer/application/WorkspaceRegistry") {}
