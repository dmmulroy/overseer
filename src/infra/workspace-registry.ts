import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { layer as migrationLayer } from "../adapters/workspace-registry-sqlite/workspace-registry-migrations.ts";
import { layer as sqliteStateLayer } from "../adapters/workspace-registry-sqlite/workspace-registry-sqlite-state.ts";
import { layer as ulidGeneratorLayer } from "../application/ulid-generator.ts";
import {
  layer as workspaceRegistryLayer,
  WorkspaceRegistryLocalService,
  type WorkspaceRegistryPersistenceError,
  WorkspaceRegistryPersistenceUnavailable,
  WorkspaceRegistryStoredRecordCorrupt,
} from "../application/workspace-registry/workspace-registry.ts";
import {
  type CreateProjectRpcInput,
  type CreateWorkspaceRpcInput,
  IdempotencyKeyReused,
  type ListProjectsRpcInput,
  type ListWorkspacesRpcInput,
  type MoveProjectRpcInput,
  ProjectMoveNotApplicable,
  ProjectNotFound,
  type RenameProjectRpcInput,
  type RenameWorkspaceRpcInput,
  WorkspaceNotFound,
  WorkspaceRegistryCursorInvalid,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryStateUnavailable,
} from "../application/workspace-registry/workspace-registry-rpc.ts";
import type { ProjectId, WorkspaceId } from "../domain/entity-id.ts";
import { WorkspaceRegistryObject } from "./workspace-registry-resource.ts";

function persistenceCauseType(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tag = cause._tag;
    return typeof tag === "string" ? tag : "TaggedCause";
  }
  return cause instanceof Error ? cause.name : typeof cause;
}

type RemotePersistenceError = WorkspaceRegistryRecordCorrupt | WorkspaceRegistryStateUnavailable;
type LocalExpectedError =
  | WorkspaceRegistryCursorInvalid
  | WorkspaceNotFound
  | ProjectNotFound
  | ProjectMoveNotApplicable
  | IdempotencyKeyReused;

function exposeRemotePersistenceFailure<A>(
  operation: "listWorkspaces",
  effect: Effect.Effect<A, WorkspaceRegistryCursorInvalid | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, WorkspaceRegistryCursorInvalid | RemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "readWorkspace" | "renameWorkspace",
  effect: Effect.Effect<A, WorkspaceNotFound | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, WorkspaceNotFound | RemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "createWorkspace",
  effect: Effect.Effect<A, IdempotencyKeyReused | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, IdempotencyKeyReused | RemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "listProjects",
  effect: Effect.Effect<
    A,
    WorkspaceRegistryCursorInvalid | WorkspaceNotFound | WorkspaceRegistryPersistenceError
  >,
): Effect.Effect<A, WorkspaceRegistryCursorInvalid | WorkspaceNotFound | RemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "readProject" | "renameProject",
  effect: Effect.Effect<A, ProjectNotFound | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, ProjectNotFound | RemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "createProject",
  effect: Effect.Effect<
    A,
    WorkspaceNotFound | IdempotencyKeyReused | WorkspaceRegistryPersistenceError
  >,
): Effect.Effect<A, WorkspaceNotFound | IdempotencyKeyReused | RemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "moveProject",
  effect: Effect.Effect<
    A,
    | WorkspaceNotFound
    | ProjectNotFound
    | ProjectMoveNotApplicable
    | IdempotencyKeyReused
    | WorkspaceRegistryPersistenceError
  >,
): Effect.Effect<
  A,
  | WorkspaceNotFound
  | ProjectNotFound
  | ProjectMoveNotApplicable
  | IdempotencyKeyReused
  | RemotePersistenceError
>;
function exposeRemotePersistenceFailure<A>(
  operation:
    | "listWorkspaces"
    | "readWorkspace"
    | "createWorkspace"
    | "renameWorkspace"
    | "listProjects"
    | "readProject"
    | "createProject"
    | "renameProject"
    | "moveProject",
  effect: Effect.Effect<A, LocalExpectedError | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, LocalExpectedError | RemotePersistenceError> {
  const recordCorrupt = (error: WorkspaceRegistryStoredRecordCorrupt) =>
    Effect.logError(error.message).pipe(
      Effect.annotateLogs({
        error_type: error._tag,
        operation,
        persistence_cause_type: persistenceCauseType(error.cause),
        record_type: error.recordType,
      }),
      Effect.andThen(Effect.fail(new WorkspaceRegistryRecordCorrupt())),
    );
  const stateUnavailable = (error: WorkspaceRegistryPersistenceUnavailable) =>
    Effect.logError(error.message).pipe(
      Effect.annotateLogs({
        error_type: error._tag,
        operation,
        persistence_cause_type: persistenceCauseType(error.cause),
        persistence_operation: error.operation,
      }),
      Effect.andThen(Effect.fail(new WorkspaceRegistryStateUnavailable())),
    );

  return effect.pipe(
    Effect.catchTag("WorkspaceRegistryStoredRecordCorrupt", recordCorrupt),
    Effect.catchTag("WorkspaceRegistryPersistenceUnavailable", stateUnavailable),
  );
}

/** Alchemy V2 implementation layer for the SQLite-backed Workspace Registry. */
const WorkspaceRegistryObjectLive = WorkspaceRegistryObject.make<never>(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const sql = yield* Effect.scoped(
        SqliteClient.make({ storage: state.raw.storage }).pipe(Effect.provide(Reactivity.layer)),
      );
      const SqlLive = Layer.succeed(SqlClient.SqlClient, sql);
      const MigrationLive = migrationLayer.pipe(Layer.provide(SqlLive));
      const StateLive = sqliteStateLayer.pipe(Layer.provide(SqlLive));
      const RegistryLive = workspaceRegistryLayer.pipe(
        Layer.provide([StateLive, ulidGeneratorLayer]),
        Layer.provide(BrowserCrypto.layer),
      );
      const workspaceRegistry = yield* WorkspaceRegistryLocalService.pipe(
        Effect.provide([RegistryLive, MigrationLive]),
        Effect.catchTag("WorkspaceRegistryMigrationFailed", (error) =>
          Effect.logError(error.message).pipe(
            Effect.annotateLogs({
              error_type: error._tag,
              persistence_cause_type: persistenceCauseType(error.cause),
            }),
            Effect.andThen(Effect.die(new Error("Workspace Registry initialization failed"))),
          ),
        ),
      );

      return {
        listWorkspaces: (input: ListWorkspacesRpcInput) =>
          exposeRemotePersistenceFailure(
            "listWorkspaces",
            workspaceRegistry.listWorkspaces(input),
          ).pipe(
            Effect.map((page) => ({
              workspaces: page.workspaces,
              cursor: Option.getOrNull(page.cursor),
              nextCursor: Option.getOrNull(page.nextCursor),
              limit: page.limit,
            })),
          ),
        readWorkspace: (workspaceId: WorkspaceId) =>
          exposeRemotePersistenceFailure(
            "readWorkspace",
            workspaceRegistry.readWorkspace(workspaceId),
          ),
        createWorkspace: (input: CreateWorkspaceRpcInput) =>
          exposeRemotePersistenceFailure(
            "createWorkspace",
            workspaceRegistry.createWorkspace(input),
          ),
        renameWorkspace: (input: RenameWorkspaceRpcInput) =>
          exposeRemotePersistenceFailure(
            "renameWorkspace",
            workspaceRegistry.renameWorkspace(input.workspaceId, input.name),
          ),
        listProjects: (input: ListProjectsRpcInput) =>
          exposeRemotePersistenceFailure(
            "listProjects",
            workspaceRegistry.listProjects(input),
          ).pipe(
            Effect.map((page) => ({
              projects: page.projects,
              cursor: Option.getOrNull(page.cursor),
              nextCursor: Option.getOrNull(page.nextCursor),
              limit: page.limit,
            })),
          ),
        readProject: (projectId: ProjectId) =>
          exposeRemotePersistenceFailure("readProject", workspaceRegistry.readProject(projectId)),
        createProject: (input: CreateProjectRpcInput) =>
          exposeRemotePersistenceFailure("createProject", workspaceRegistry.createProject(input)),
        renameProject: (input: RenameProjectRpcInput) =>
          exposeRemotePersistenceFailure(
            "renameProject",
            workspaceRegistry.renameProject(input.projectId, input.name),
          ),
        moveProject: (input: MoveProjectRpcInput) =>
          exposeRemotePersistenceFailure("moveProject", workspaceRegistry.moveProject(input)),
      };
    });
  }),
);

export default WorkspaceRegistryObjectLive;
