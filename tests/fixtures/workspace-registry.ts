/// <reference types="@cloudflare/workers-types" />

import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { DurableObject } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { layer as migrationLayer } from "../../src/adapters/workspace-registry-sqlite/workspace-registry-migrations.ts";
import { layer as sqliteStateLayer } from "../../src/adapters/workspace-registry-sqlite/workspace-registry-sqlite-state.ts";
import { layer as ulidGeneratorLayer } from "../../src/application/ulid-generator.ts";
import {
  layer as workspaceRegistryLayer,
  type WorkspaceRegistryLocal,
  type WorkspaceRegistryPersistenceError,
  WorkspaceRegistryLocalService,
  WorkspaceRegistryPersistenceUnavailable,
  WorkspaceRegistryStoredRecordCorrupt,
} from "../../src/application/workspace-registry/workspace-registry.ts";
import {
  type CreateProjectRpcInput,
  type CreateProjectRpcResult,
  type CreateWorkspaceRpcInput,
  type CreateWorkspaceRpcResult,
  type IdempotencyKeyReused,
  type ListProjectsRpcInput,
  type ListProjectsRpcResult,
  type ListWorkspacesRpcInput,
  type ListWorkspacesRpcResult,
  type ProjectNotFound,
  type RenameProjectRpcInput,
  type RenameWorkspaceRpcInput,
  type WorkspaceNotFound,
  type WorkspaceRegistryCursorInvalid,
  WorkspaceRegistryRecordCorrupt,
  type WorkspaceRegistryRemotePersistenceError,
  WorkspaceRegistryStateUnavailable,
} from "../../src/application/workspace-registry/workspace-registry-rpc.ts";
import type { ProjectId, WorkspaceId } from "../../src/domain/entity-id.ts";
import type { Project } from "../../src/domain/project.ts";
import type { Workspace } from "../../src/domain/workspace.ts";

type LocalExpectedError =
  | WorkspaceRegistryCursorInvalid
  | WorkspaceNotFound
  | ProjectNotFound
  | IdempotencyKeyReused;

function exposeRemotePersistenceFailure<A>(
  operation: "listWorkspaces",
  effect: Effect.Effect<A, WorkspaceRegistryCursorInvalid | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, WorkspaceRegistryCursorInvalid | WorkspaceRegistryRemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "readWorkspace" | "renameWorkspace",
  effect: Effect.Effect<A, WorkspaceNotFound | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, WorkspaceNotFound | WorkspaceRegistryRemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "createWorkspace",
  effect: Effect.Effect<A, IdempotencyKeyReused | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, IdempotencyKeyReused | WorkspaceRegistryRemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "listProjects",
  effect: Effect.Effect<
    A,
    WorkspaceRegistryCursorInvalid | WorkspaceNotFound | WorkspaceRegistryPersistenceError
  >,
): Effect.Effect<
  A,
  WorkspaceRegistryCursorInvalid | WorkspaceNotFound | WorkspaceRegistryRemotePersistenceError
>;
function exposeRemotePersistenceFailure<A>(
  operation: "readProject" | "renameProject",
  effect: Effect.Effect<A, ProjectNotFound | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, ProjectNotFound | WorkspaceRegistryRemotePersistenceError>;
function exposeRemotePersistenceFailure<A>(
  operation: "createProject",
  effect: Effect.Effect<
    A,
    WorkspaceNotFound | IdempotencyKeyReused | WorkspaceRegistryPersistenceError
  >,
): Effect.Effect<
  A,
  WorkspaceNotFound | IdempotencyKeyReused | WorkspaceRegistryRemotePersistenceError
>;
function exposeRemotePersistenceFailure<A>(
  _operation:
    | "listWorkspaces"
    | "readWorkspace"
    | "createWorkspace"
    | "renameWorkspace"
    | "listProjects"
    | "readProject"
    | "createProject"
    | "renameProject",
  effect: Effect.Effect<A, LocalExpectedError | WorkspaceRegistryPersistenceError>,
): Effect.Effect<A, LocalExpectedError | WorkspaceRegistryRemotePersistenceError> {
  const corrupt = (_error: WorkspaceRegistryStoredRecordCorrupt) =>
    Effect.fail(new WorkspaceRegistryRecordCorrupt());
  const unavailable = (_error: WorkspaceRegistryPersistenceUnavailable) =>
    Effect.fail(new WorkspaceRegistryStateUnavailable());

  return effect.pipe(
    Effect.catchTag("WorkspaceRegistryStoredRecordCorrupt", corrupt),
    Effect.catchTag("WorkspaceRegistryPersistenceUnavailable", unavailable),
  );
}

/** Representative SQLite Workspace Registry Durable Object used by fast Gateway tests. */
export class TestWorkspaceRegistry extends DurableObject<Readonly<Record<never, never>>> {
  readonly #ready: Promise<WorkspaceRegistryLocal>;
  readonly #run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

  constructor(ctx: DurableObjectState, env: Readonly<Record<never, never>>) {
    super(ctx, env);
    const SqlLive = SqliteClient.layer({ storage: ctx.storage });
    const StateLive = sqliteStateLayer.pipe(Layer.provide(SqlLive));
    const MigrationLive = migrationLayer.pipe(Layer.provide(SqlLive));
    const RegistryLive = workspaceRegistryLayer.pipe(
      Layer.provide([StateLive, ulidGeneratorLayer]),
      Layer.provide(BrowserCrypto.layer),
    );
    const runtime = ManagedRuntime.make(Layer.merge(RegistryLive, MigrationLive));
    this.#run = (effect) =>
      runtime.runPromise(Effect.result(effect)).then((result) => {
        if (Result.isFailure(result)) throw result.failure;
        return result.success;
      });
    this.#ready = ctx.blockConcurrencyWhile(() =>
      runtime.runPromise(WorkspaceRegistryLocalService),
    );
  }

  /** List one bounded Workspace page through the operation-specific seam. */
  async listWorkspaces(input: ListWorkspacesRpcInput): Promise<ListWorkspacesRpcResult> {
    const registry = await this.#ready;
    const page = await this.#run(
      exposeRemotePersistenceFailure("listWorkspaces", registry.listWorkspaces(input)),
    );
    return {
      workspaces: page.workspaces,
      cursor: Option.getOrNull(page.cursor),
      nextCursor: Option.getOrNull(page.nextCursor),
      limit: page.limit,
    };
  }

  /** Read one Workspace through the operation-specific seam. */
  async readWorkspace(workspaceId: WorkspaceId): Promise<Workspace> {
    const registry = await this.#ready;
    return this.#run(
      exposeRemotePersistenceFailure("readWorkspace", registry.readWorkspace(workspaceId)),
    );
  }

  /** Create one Workspace through the operation-specific seam. */
  async createWorkspace(input: CreateWorkspaceRpcInput): Promise<CreateWorkspaceRpcResult> {
    const registry = await this.#ready;
    return this.#run(
      exposeRemotePersistenceFailure("createWorkspace", registry.createWorkspace(input)),
    );
  }

  /** Rename one Workspace through the operation-specific seam. */
  async renameWorkspace(input: RenameWorkspaceRpcInput): Promise<Workspace> {
    const registry = await this.#ready;
    return this.#run(
      exposeRemotePersistenceFailure(
        "renameWorkspace",
        registry.renameWorkspace(input.workspaceId, input.name),
      ),
    );
  }

  /** List one bounded Project page through the operation-specific seam. */
  async listProjects(input: ListProjectsRpcInput): Promise<ListProjectsRpcResult> {
    const registry = await this.#ready;
    const page = await this.#run(
      exposeRemotePersistenceFailure("listProjects", registry.listProjects(input)),
    );
    return {
      projects: page.projects,
      cursor: Option.getOrNull(page.cursor),
      nextCursor: Option.getOrNull(page.nextCursor),
      limit: page.limit,
    };
  }

  /** Read one Project through the operation-specific seam. */
  async readProject(projectId: ProjectId): Promise<Project> {
    const registry = await this.#ready;
    return this.#run(
      exposeRemotePersistenceFailure("readProject", registry.readProject(projectId)),
    );
  }

  /** Create one Project through the operation-specific seam. */
  async createProject(input: CreateProjectRpcInput): Promise<CreateProjectRpcResult> {
    const registry = await this.#ready;
    return this.#run(
      exposeRemotePersistenceFailure("createProject", registry.createProject(input)),
    );
  }

  /** Rename one Project through the operation-specific seam. */
  async renameProject(input: RenameProjectRpcInput): Promise<Project> {
    const registry = await this.#ready;
    return this.#run(
      exposeRemotePersistenceFailure(
        "renameProject",
        registry.renameProject(input.projectId, input.name),
      ),
    );
  }
}
