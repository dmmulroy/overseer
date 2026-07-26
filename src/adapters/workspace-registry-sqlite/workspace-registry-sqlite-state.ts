import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  IdempotencyFingerprint,
  WorkspaceRegistryPersistenceUnavailable,
  WorkspaceRegistryStateService,
  WorkspaceRegistryStoredRecordCorrupt,
} from "../../application/workspace-registry/workspace-registry.ts";
import { WorkspaceRegistryCursorInvalid } from "../../application/workspace-registry/workspace-registry-rpc.ts";
import { ProjectId, WorkspaceId } from "../../domain/entity-id.ts";
import {
  ProjectCursor,
  type ProjectCursor as ProjectCursorType,
  WorkspaceCursor,
  type WorkspaceCursor as WorkspaceCursorType,
} from "../../domain/pagination.ts";
import { Project, type Project as ProjectType, ProjectName } from "../../domain/project.ts";
import {
  Workspace,
  type Workspace as WorkspaceType,
  WorkspaceName,
} from "../../domain/workspace.ts";

type WorkspaceRow = {
  readonly id: unknown;
  readonly name: unknown;
  readonly lifecycle: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly archived_at: unknown;
};
type ProjectRow = {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly name: unknown;
  readonly lifecycle: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly archived_at: unknown;
};
type IdempotencyRow = {
  readonly fingerprint: unknown;
  readonly workspace_json: unknown;
  readonly project_json: unknown;
};

const WorkspaceCursorState = Schema.Struct({ name: WorkspaceName, workspaceId: WorkspaceId });
const ProjectCursorState = Schema.Struct({
  scopeWorkspaceId: Schema.NullOr(WorkspaceId),
  name: ProjectName,
  projectId: ProjectId,
});
const WorkspaceRowSchema = Schema.Struct({
  id: Workspace.fields.id,
  name: Workspace.fields.name,
  lifecycle: Workspace.fields.lifecycle,
  created_at: Workspace.fields.createdAt,
  updated_at: Workspace.fields.updatedAt,
  archived_at: Schema.Null,
}).pipe(
  Schema.decodeTo(
    Schema.toType(Workspace),
    SchemaTransformation.transform({
      decode: (row) => ({
        id: row.id,
        name: row.name,
        lifecycle: row.lifecycle,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
      encode: (value) => ({
        id: value.id,
        name: value.name,
        lifecycle: value.lifecycle,
        created_at: value.createdAt,
        updated_at: value.updatedAt,
        archived_at: null,
      }),
    }),
  ),
);
const ProjectRowSchema = Schema.Struct({
  id: Project.fields.id,
  workspace_id: Project.fields.workspaceId,
  name: Project.fields.name,
  lifecycle: Project.fields.lifecycle,
  created_at: Project.fields.createdAt,
  updated_at: Project.fields.updatedAt,
  archived_at: Schema.Null,
}).pipe(
  Schema.decodeTo(
    Schema.toType(Project),
    SchemaTransformation.transform({
      decode: (row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        lifecycle: row.lifecycle,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
      encode: (value) => ({
        id: value.id,
        workspace_id: value.workspaceId,
        name: value.name,
        lifecycle: value.lifecycle,
        created_at: value.createdAt,
        updated_at: value.updatedAt,
        archived_at: null,
      }),
    }),
  ),
);
const WorkspaceJson = Schema.fromJsonString(Workspace);
const ProjectJson = Schema.fromJsonString(Project);
const WorkspaceCursorJson = Schema.fromJsonString(WorkspaceCursorState);
const ProjectCursorJson = Schema.fromJsonString(ProjectCursorState);
type WorkspaceCursorState = typeof WorkspaceCursorState.Type;
type ProjectCursorState = typeof ProjectCursorState.Type;

function parseStored<A>(
  schema: Schema.Decoder<A>,
  input: unknown,
  recordType: "workspace" | "project" | "idempotency",
): Effect.Effect<A, WorkspaceRegistryStoredRecordCorrupt> {
  return Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((cause) => new WorkspaceRegistryStoredRecordCorrupt({ recordType, cause })),
  );
}
function decodeWorkspaceCursor(cursor: WorkspaceCursorType): Option.Option<WorkspaceCursorState> {
  const decoded = Encoding.decodeBase64UrlString(cursor);
  return Result.isSuccess(decoded)
    ? Schema.decodeUnknownOption(WorkspaceCursorJson)(decoded.success)
    : Option.none();
}
function encodeWorkspaceCursor(workspace: WorkspaceType): WorkspaceCursorType {
  return WorkspaceCursor.make(
    Encoding.encodeBase64Url(
      Schema.encodeSync(WorkspaceCursorJson)(
        WorkspaceCursorState.make({ name: workspace.name, workspaceId: workspace.id }),
      ),
    ),
  );
}
function decodeProjectCursor(cursor: ProjectCursorType): Option.Option<ProjectCursorState> {
  const decoded = Encoding.decodeBase64UrlString(cursor);
  return Result.isSuccess(decoded)
    ? Schema.decodeUnknownOption(ProjectCursorJson)(decoded.success)
    : Option.none();
}
function encodeProjectCursor(
  project: ProjectType,
  scopeWorkspaceId: WorkspaceId | null,
): ProjectCursorType {
  return ProjectCursor.make(
    Encoding.encodeBase64Url(
      Schema.encodeSync(ProjectCursorJson)(
        ProjectCursorState.make({ scopeWorkspaceId, name: project.name, projectId: project.id }),
      ),
    ),
  );
}
const unavailable = (operation: string) => (cause: unknown) =>
  Effect.fail(new WorkspaceRegistryPersistenceUnavailable({ operation, cause }));

/** Construct SQLite-backed Workspace Registry persistence. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const findWorkspace = Effect.fn("WorkspaceRegistrySqliteState.findWorkspace")(
    function* (workspaceId) {
      const row =
        (yield* sql<WorkspaceRow>`SELECT id, name, lifecycle, created_at, updated_at, archived_at FROM workspaces WHERE id = ${workspaceId}`)[0];
      return row === undefined
        ? Option.none()
        : Option.some(yield* parseStored(WorkspaceRowSchema, row, "workspace"));
    },
    Effect.catchTag("SqlError", unavailable("findWorkspace")),
  );
  const findProject = Effect.fn("WorkspaceRegistrySqliteState.findProject")(
    function* (projectId) {
      const row =
        (yield* sql<ProjectRow>`SELECT id, workspace_id, name, lifecycle, created_at, updated_at, archived_at FROM projects WHERE id = ${projectId}`)[0];
      return row === undefined
        ? Option.none()
        : Option.some(yield* parseStored(ProjectRowSchema, row, "project"));
    },
    Effect.catchTag("SqlError", unavailable("findProject")),
  );
  const idempotencyRow = Effect.fn("WorkspaceRegistrySqliteState.findIdempotencyRow")(
    (scope, key) =>
      sql<IdempotencyRow>`SELECT fingerprint, workspace_json, project_json FROM workspace_registry_idempotency WHERE scope = ${scope} AND idempotency_key = ${key}`.pipe(
        Effect.map((rows) => Option.fromNullishOr(rows[0])),
        Effect.catchTag("SqlError", unavailable("findIdempotency")),
      ),
  );

  return WorkspaceRegistryStateService.of({
    transaction: Effect.fn("WorkspaceRegistrySqliteState.transaction")(
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        sql.withTransaction(effect).pipe(Effect.catchTag("SqlError", unavailable("transaction"))),
    ),
    listWorkspaces: Effect.fn("WorkspaceRegistrySqliteState.listWorkspaces")(
      function* (request) {
        const requested = Option.fromNullishOr(request.cursor);
        const cursor = Option.flatMap(requested, decodeWorkspaceCursor);
        if (Option.isSome(requested) && Option.isNone(cursor))
          return yield* new WorkspaceRegistryCursorInvalid();
        const size = request.limit + 1;
        const rows = Option.isSome(cursor)
          ? yield* sql<WorkspaceRow>`SELECT id, name, lifecycle, created_at, updated_at, archived_at FROM workspaces WHERE lifecycle = 'active' AND (name > ${cursor.value.name} OR (name = ${cursor.value.name} AND id > ${cursor.value.workspaceId})) ORDER BY name, id LIMIT ${size}`
          : yield* sql<WorkspaceRow>`SELECT id, name, lifecycle, created_at, updated_at, archived_at FROM workspaces WHERE lifecycle = 'active' ORDER BY name, id LIMIT ${size}`;
        const parsed: Array<WorkspaceType> = [];
        for (const row of rows)
          parsed.push(yield* parseStored(WorkspaceRowSchema, row, "workspace"));
        const workspaces = parsed.slice(0, request.limit);
        const last = workspaces.at(-1);
        return {
          workspaces,
          cursor: requested,
          nextCursor:
            parsed.length > request.limit && last !== undefined
              ? Option.some(encodeWorkspaceCursor(last))
              : Option.none<WorkspaceCursorType>(),
          limit: request.limit,
        };
      },
      Effect.catchTag("SqlError", unavailable("listWorkspaces")),
    ),
    listProjects: Effect.fn("WorkspaceRegistrySqliteState.listProjects")(
      function* (request) {
        const requested = Option.fromNullishOr(request.cursor);
        const cursor = Option.flatMap(requested, decodeProjectCursor);
        const scope = request.workspaceId ?? null;
        if (
          Option.isSome(requested) &&
          (Option.isNone(cursor) || cursor.value.scopeWorkspaceId !== scope)
        )
          return yield* new WorkspaceRegistryCursorInvalid();
        const size = request.limit + 1;
        let rows: ReadonlyArray<ProjectRow>;
        if (request.workspaceId !== undefined) {
          rows = Option.isSome(cursor)
            ? yield* sql<ProjectRow>`SELECT id, workspace_id, name, lifecycle, created_at, updated_at, archived_at FROM projects WHERE lifecycle = 'active' AND workspace_id = ${request.workspaceId} AND (name > ${cursor.value.name} OR (name = ${cursor.value.name} AND id > ${cursor.value.projectId})) ORDER BY name, id LIMIT ${size}`
            : yield* sql<ProjectRow>`SELECT id, workspace_id, name, lifecycle, created_at, updated_at, archived_at FROM projects WHERE lifecycle = 'active' AND workspace_id = ${request.workspaceId} ORDER BY name, id LIMIT ${size}`;
        } else {
          rows = Option.isSome(cursor)
            ? yield* sql<ProjectRow>`SELECT id, workspace_id, name, lifecycle, created_at, updated_at, archived_at FROM projects WHERE lifecycle = 'active' AND (name > ${cursor.value.name} OR (name = ${cursor.value.name} AND id > ${cursor.value.projectId})) ORDER BY name, id LIMIT ${size}`
            : yield* sql<ProjectRow>`SELECT id, workspace_id, name, lifecycle, created_at, updated_at, archived_at FROM projects WHERE lifecycle = 'active' ORDER BY name, id LIMIT ${size}`;
        }
        const parsed: Array<ProjectType> = [];
        for (const row of rows) parsed.push(yield* parseStored(ProjectRowSchema, row, "project"));
        const projects = parsed.slice(0, request.limit);
        const last = projects.at(-1);
        return {
          projects,
          cursor: requested,
          nextCursor:
            parsed.length > request.limit && last !== undefined
              ? Option.some(encodeProjectCursor(last, scope))
              : Option.none<ProjectCursorType>(),
          limit: request.limit,
        };
      },
      Effect.catchTag("SqlError", unavailable("listProjects")),
    ),
    findIdempotencyFingerprint: (scope, key) =>
      idempotencyRow(scope, key).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none()),
            onSome: (row) =>
              parseStored(IdempotencyFingerprint, row.fingerprint, "idempotency").pipe(
                Effect.map(Option.some),
              ),
          }),
        ),
      ),
    findWorkspaceCreation: (scope, key) =>
      idempotencyRow(scope, key).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none()),
            onSome: (row) =>
              parseStored(
                Schema.Struct({ fingerprint: IdempotencyFingerprint, workspace: WorkspaceJson }),
                { fingerprint: row.fingerprint, workspace: row.workspace_json },
                "idempotency",
              ).pipe(Effect.map(Option.some)),
          }),
        ),
      ),
    findProjectCreation: (scope, key) =>
      idempotencyRow(scope, key).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none()),
            onSome: (row) =>
              parseStored(
                Schema.Struct({ fingerprint: IdempotencyFingerprint, project: ProjectJson }),
                { fingerprint: row.fingerprint, project: row.project_json },
                "idempotency",
              ).pipe(Effect.map(Option.some)),
          }),
        ),
      ),
    insertWorkspaceCreation: Effect.fn("WorkspaceRegistrySqliteState.insertWorkspaceCreation")(
      function* (workspace, scope, key, fingerprint) {
        yield* sql`INSERT INTO workspaces (id, name, lifecycle, created_at, updated_at, archived_at) VALUES (${workspace.id}, ${workspace.name}, 'active', ${workspace.createdAt}, ${workspace.updatedAt}, NULL)`;
        yield* sql`INSERT INTO workspace_registry_idempotency (scope, idempotency_key, fingerprint, workspace_json, project_json, created_at) VALUES (${scope}, ${key}, ${fingerprint}, ${Schema.encodeSync(WorkspaceJson)(workspace)}, NULL, ${workspace.createdAt})`;
      },
      Effect.catchTag("SqlError", unavailable("insertWorkspaceCreation")),
    ),
    insertProjectCreation: Effect.fn("WorkspaceRegistrySqliteState.insertProjectCreation")(
      function* (project, scope, key, fingerprint) {
        const encodedProject = Schema.encodeSync(ProjectJson)(project);
        yield* sql`INSERT INTO projects (id, workspace_id, name, lifecycle, created_at, updated_at, archived_at) VALUES (${project.id}, ${project.workspaceId}, ${project.name}, 'active', ${project.createdAt}, ${project.updatedAt}, NULL)`;
        // workspace_json remains populated for compatibility with the original non-null column;
        // the fingerprint selects project_json before any replay payload is decoded.
        yield* sql`INSERT INTO workspace_registry_idempotency (scope, idempotency_key, fingerprint, workspace_json, project_json, created_at) VALUES (${scope}, ${key}, ${fingerprint}, ${encodedProject}, ${encodedProject}, ${project.createdAt})`;
      },
      Effect.catchTag("SqlError", unavailable("insertProjectCreation")),
    ),
    findWorkspace,
    findProject,
    updateWorkspaceName: Effect.fn("WorkspaceRegistrySqliteState.updateWorkspaceName")(
      (workspace) =>
        sql`UPDATE workspaces SET name = ${workspace.name}, updated_at = ${workspace.updatedAt} WHERE id = ${workspace.id}`.pipe(
          Effect.asVoid,
          Effect.catchTag("SqlError", unavailable("updateWorkspaceName")),
        ),
    ),
    updateProjectName: Effect.fn("WorkspaceRegistrySqliteState.updateProjectName")((project) =>
      sql`UPDATE projects SET name = ${project.name}, updated_at = ${project.updatedAt} WHERE id = ${project.id}`.pipe(
        Effect.asVoid,
        Effect.catchTag("SqlError", unavailable("updateProjectName")),
      ),
    ),
  });
});
/** SQLite-backed Workspace Registry persistence layer. */
export const layer = Layer.effect(WorkspaceRegistryStateService, make);
