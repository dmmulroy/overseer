import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  makeProjectId,
  makeWorkspaceId,
  type ProjectId,
  WorkspaceId,
} from "../../domain/entity-id.ts";
import type { IdempotencyKey, IdempotencyScope } from "../../domain/idempotency.ts";
import type {
  ProjectCursor,
  ProjectPageLimit,
  WorkspaceCursor,
  WorkspacePageLimit,
} from "../../domain/pagination.ts";
import {
  Project,
  ProjectTimestamp,
  advanceProjectTimestamp,
  type Project as ProjectType,
  type ProjectName,
} from "../../domain/project.ts";
import {
  Workspace,
  WorkspaceTimestamp,
  advanceWorkspaceTimestamp,
  type Workspace as WorkspaceType,
  type WorkspaceName,
} from "../../domain/workspace.ts";
import { UlidGeneratorService } from "../ulid-generator.ts";
import {
  type CreateProjectRpcInput,
  type CreateProjectRpcResult,
  type CreateWorkspaceRpcInput,
  type CreateWorkspaceRpcResult,
  IdempotencyKeyReused,
  type ListProjectsRpcInput,
  type ListWorkspacesRpcInput,
  ProjectNotFound,
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
/** Inputs selecting one bounded Project collection page. */
export type ListProjectsInput = {
  readonly workspaceId: Option.Option<WorkspaceId>;
  readonly cursor: Option.Option<ProjectCursor>;
  readonly limit: ProjectPageLimit;
};
/** Parsed Project page returned by the Workspace Registry. */
export type ProjectPage = {
  readonly projects: ReadonlyArray<ProjectType>;
  readonly cursor: Option.Option<ProjectCursor>;
  readonly nextCursor: Option.Option<ProjectCursor>;
  readonly limit: ProjectPageLimit;
};

/** A stored record failed parsing inside the owning persistence adapter. */
export class WorkspaceRegistryStoredRecordCorrupt extends Schema.TaggedErrorClass<WorkspaceRegistryStoredRecordCorrupt>()(
  "WorkspaceRegistryStoredRecordCorrupt",
  { recordType: Schema.Literals(["workspace", "project", "idempotency"]), cause: Schema.Defect() },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A stored Workspace Registry record could not be decoded";
}
/** A Workspace Registry persistence operation failed. */
export class WorkspaceRegistryPersistenceUnavailable extends Schema.TaggedErrorClass<WorkspaceRegistryPersistenceUnavailable>()(
  "WorkspaceRegistryPersistenceUnavailable",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A Workspace Registry persistence operation failed";
}
/** Detailed persistence failures retained inside the Durable Object. */
export type WorkspaceRegistryPersistenceError =
  | WorkspaceRegistryStoredRecordCorrupt
  | WorkspaceRegistryPersistenceUnavailable;
/** Retained successful Workspace creation used for idempotent replay. */
export type RetainedWorkspaceCreation = {
  readonly fingerprint: IdempotencyFingerprint;
  readonly workspace: WorkspaceType;
};
/** Retained successful Project creation used for idempotent replay. */
export type RetainedProjectCreation = {
  readonly fingerprint: IdempotencyFingerprint;
  readonly project: ProjectType;
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
  readonly listProjects: (
    request: ListProjectsRpcInput,
  ) => Effect.Effect<
    ProjectPage,
    WorkspaceRegistryCursorInvalid | WorkspaceRegistryPersistenceError
  >;
  readonly findIdempotencyFingerprint: (
    scope: IdempotencyScope,
    key: IdempotencyKey,
  ) => Effect.Effect<Option.Option<IdempotencyFingerprint>, WorkspaceRegistryPersistenceError>;
  readonly findWorkspaceCreation: (
    scope: IdempotencyScope,
    key: IdempotencyKey,
  ) => Effect.Effect<Option.Option<RetainedWorkspaceCreation>, WorkspaceRegistryPersistenceError>;
  readonly findProjectCreation: (
    scope: IdempotencyScope,
    key: IdempotencyKey,
  ) => Effect.Effect<Option.Option<RetainedProjectCreation>, WorkspaceRegistryPersistenceError>;
  readonly insertWorkspaceCreation: (
    workspace: WorkspaceType,
    scope: IdempotencyScope,
    key: IdempotencyKey,
    fingerprint: IdempotencyFingerprint,
  ) => Effect.Effect<void, WorkspaceRegistryPersistenceError>;
  readonly insertProjectCreation: (
    project: ProjectType,
    scope: IdempotencyScope,
    key: IdempotencyKey,
    fingerprint: IdempotencyFingerprint,
  ) => Effect.Effect<void, WorkspaceRegistryPersistenceError>;
  readonly findWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Option.Option<WorkspaceType>, WorkspaceRegistryPersistenceError>;
  readonly findProject: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<ProjectType>, WorkspaceRegistryPersistenceError>;
  readonly updateWorkspaceName: (
    workspace: WorkspaceType,
  ) => Effect.Effect<void, WorkspaceRegistryPersistenceError>;
  readonly updateProjectName: (
    project: ProjectType,
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
  readonly listProjects: (
    input: ListProjectsRpcInput,
  ) => Effect.Effect<
    ProjectPage,
    WorkspaceRegistryCursorInvalid | WorkspaceNotFound | WorkspaceRegistryPersistenceError
  >;
  readonly readProject: (
    projectId: ProjectId,
  ) => Effect.Effect<ProjectType, ProjectNotFound | WorkspaceRegistryPersistenceError>;
  readonly createProject: (
    input: CreateProjectRpcInput,
  ) => Effect.Effect<
    CreateProjectRpcResult,
    WorkspaceNotFound | IdempotencyKeyReused | WorkspaceRegistryPersistenceError
  >;
  readonly renameProject: (
    projectId: ProjectId,
    name: ProjectName,
  ) => Effect.Effect<ProjectType, ProjectNotFound | WorkspaceRegistryPersistenceError>;
};
/** Effect service for object-local Workspace Registry operations. */
export class WorkspaceRegistryLocalService extends Context.Service<
  WorkspaceRegistryLocalService,
  WorkspaceRegistryLocal
>()("@overseer/application/WorkspaceRegistryLocal") {}

const CreateWorkspaceFingerprint = Schema.fromJsonString(
  Schema.Tuple([Schema.Literal("CreateWorkspace"), Workspace.fields.name]),
);
const CreateProjectFingerprint = Schema.fromJsonString(
  Schema.Tuple([Schema.Literal("CreateProject"), WorkspaceId, Project.fields.name]),
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
      const found = yield* state.findWorkspace(workspaceId);
      if (Option.isNone(found)) return yield* new WorkspaceNotFound({ workspaceId });
      return found.value;
    }),
    createWorkspace: Effect.fn("WorkspaceRegistry.createWorkspace")(function* (input) {
      return yield* state.transaction(
        Effect.gen(function* () {
          const fingerprint = IdempotencyFingerprint.make(
            Schema.encodeSync(CreateWorkspaceFingerprint)(["CreateWorkspace", input.name]),
          );
          const retainedFingerprint = yield* state.findIdempotencyFingerprint(
            input.idempotencyScope,
            input.idempotencyKey,
          );
          if (Option.isSome(retainedFingerprint)) {
            if (retainedFingerprint.value !== fingerprint) return yield* new IdempotencyKeyReused();
            const retained = yield* state.findWorkspaceCreation(
              input.idempotencyScope,
              input.idempotencyKey,
            );
            if (Option.isNone(retained))
              return yield* new WorkspaceRegistryStoredRecordCorrupt({
                recordType: "idempotency",
                cause: "Workspace replay payload missing",
              });
            return { workspace: retained.value.workspace, replayed: true };
          }
          const timestamp = WorkspaceTimestamp.make(DateTime.formatIso(yield* DateTime.now));
          const workspace = Workspace.make({
            id: makeWorkspaceId(yield* ulids.next()),
            name: input.name,
            lifecycle: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          yield* state.insertWorkspaceCreation(
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
          const found = yield* state.findWorkspace(workspaceId);
          if (Option.isNone(found)) return yield* new WorkspaceNotFound({ workspaceId });
          if (found.value.name === name) return found.value;
          const candidate = WorkspaceTimestamp.make(DateTime.formatIso(yield* DateTime.now));
          const workspace = Workspace.make({
            ...found.value,
            name,
            updatedAt: advanceWorkspaceTimestamp(found.value.updatedAt, candidate),
          });
          yield* state.updateWorkspaceName(workspace);
          return workspace;
        }),
      );
    }),
    listProjects: Effect.fn("WorkspaceRegistry.listProjects")(function* (input) {
      if (input.workspaceId !== undefined) {
        const workspace = yield* state.findWorkspace(input.workspaceId);
        if (Option.isNone(workspace))
          return yield* new WorkspaceNotFound({ workspaceId: input.workspaceId });
      }
      return yield* state.listProjects(input);
    }),
    readProject: Effect.fn("WorkspaceRegistry.readProject")(function* (projectId) {
      const found = yield* state.findProject(projectId);
      if (Option.isNone(found)) return yield* new ProjectNotFound({ projectId });
      return found.value;
    }),
    createProject: Effect.fn("WorkspaceRegistry.createProject")(function* (input) {
      return yield* state.transaction(
        Effect.gen(function* () {
          const workspace = yield* state.findWorkspace(input.workspaceId);
          if (Option.isNone(workspace))
            return yield* new WorkspaceNotFound({ workspaceId: input.workspaceId });
          const fingerprint = IdempotencyFingerprint.make(
            Schema.encodeSync(CreateProjectFingerprint)([
              "CreateProject",
              input.workspaceId,
              input.name,
            ]),
          );
          const retainedFingerprint = yield* state.findIdempotencyFingerprint(
            input.idempotencyScope,
            input.idempotencyKey,
          );
          if (Option.isSome(retainedFingerprint)) {
            if (retainedFingerprint.value !== fingerprint) return yield* new IdempotencyKeyReused();
            const retained = yield* state.findProjectCreation(
              input.idempotencyScope,
              input.idempotencyKey,
            );
            if (Option.isNone(retained))
              return yield* new WorkspaceRegistryStoredRecordCorrupt({
                recordType: "idempotency",
                cause: "Project replay payload missing",
              });
            return { project: retained.value.project, replayed: true };
          }
          const timestamp = ProjectTimestamp.make(DateTime.formatIso(yield* DateTime.now));
          const project = Project.make({
            id: makeProjectId(yield* ulids.next()),
            workspaceId: input.workspaceId,
            name: input.name,
            lifecycle: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          yield* state.insertProjectCreation(
            project,
            input.idempotencyScope,
            input.idempotencyKey,
            fingerprint,
          );
          return { project, replayed: false };
        }),
      );
    }),
    renameProject: Effect.fn("WorkspaceRegistry.renameProject")(function* (projectId, name) {
      return yield* state.transaction(
        Effect.gen(function* () {
          const found = yield* state.findProject(projectId);
          if (Option.isNone(found)) return yield* new ProjectNotFound({ projectId });
          if (found.value.name === name) return found.value;
          const candidate = ProjectTimestamp.make(DateTime.formatIso(yield* DateTime.now));
          const project = Project.make({
            ...found.value,
            name,
            updatedAt: advanceProjectTimestamp(found.value.updatedAt, candidate),
          });
          yield* state.updateProjectName(project);
          return project;
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
  readonly listProjects: (
    input: ListProjectsInput,
  ) => Effect.Effect<
    ProjectPage,
    | WorkspaceRegistryCursorInvalid
    | WorkspaceNotFound
    | WorkspaceRegistryRemotePersistenceError
    | WorkspaceRegistryRpcCallFailed
  >;
  readonly readProject: (
    projectId: ProjectId,
  ) => Effect.Effect<
    ProjectType,
    ProjectNotFound | WorkspaceRegistryRemotePersistenceError | WorkspaceRegistryRpcCallFailed
  >;
  readonly createProject: (
    input: CreateProjectRpcInput,
  ) => Effect.Effect<
    CreateProjectRpcResult,
    | WorkspaceNotFound
    | IdempotencyKeyReused
    | WorkspaceRegistryRemotePersistenceError
    | WorkspaceRegistryRpcCallFailed
  >;
  readonly renameProject: (
    projectId: ProjectId,
    name: ProjectName,
  ) => Effect.Effect<
    ProjectType,
    ProjectNotFound | WorkspaceRegistryRemotePersistenceError | WorkspaceRegistryRpcCallFailed
  >;
};
/** Effect service exposing Gateway-facing Workspace Registry operations. */
export class WorkspaceRegistryService extends Context.Service<
  WorkspaceRegistryService,
  WorkspaceRegistry
>()("@overseer/application/WorkspaceRegistry") {}
