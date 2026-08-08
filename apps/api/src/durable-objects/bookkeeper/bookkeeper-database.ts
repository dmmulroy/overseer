import { SqliteMigrator } from "@effect/sql-sqlite-do";
import { Context, DateTime, Effect, Encoding, Layer, Option, Result, Schema } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";
import { IssueId } from "../../domain/issue.ts";
import { ProjectId } from "../../domain/project.ts";
import { WorkspaceId } from "../../domain/workspace.ts";
import { PaginationCursor, type PaginationPage, type PaginationRequest } from "../../pagination.ts";
import {
  type BookkeeperCounts,
  type BookkeeperIssue,
  type BookkeeperProject,
  type BookkeeperWorkspace,
  DeleteIssueError,
  DeleteProjectError,
  DeleteWorkspaceError,
  GetBookkeeperCountsError,
  GetIssueError,
  GetProjectError,
  GetWorkspaceError,
  ListIssuesError,
  ListProjectsError,
  ListWorkspacesError,
  RegisterIssueError,
  RegisterProjectError,
  RegisterWorkspaceError,
} from "./bookkeeper-http-api.ts";

/** Domain-shaped persistence capability for the singleton Bookkeeper index. */
export interface IBookkeeperDatabase {
  readonly listWorkspaces: (
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperWorkspace>, ListWorkspacesError>;
  readonly getWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Option.Option<BookkeeperWorkspace>, GetWorkspaceError>;
  readonly registerWorkspace: (
    workspace: BookkeeperWorkspace,
  ) => Effect.Effect<BookkeeperWorkspace, RegisterWorkspaceError>;
  readonly deleteWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<BookkeeperWorkspace, DeleteWorkspaceError>;
  readonly listProjects: (
    workspaceId: WorkspaceId,
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperProject>, ListProjectsError>;
  readonly getProject: (
    id: ProjectId,
  ) => Effect.Effect<Option.Option<BookkeeperProject>, GetProjectError>;
  readonly registerProject: (
    project: BookkeeperProject,
  ) => Effect.Effect<BookkeeperProject, RegisterProjectError>;
  readonly deleteProject: (id: ProjectId) => Effect.Effect<BookkeeperProject, DeleteProjectError>;
  readonly listIssues: (
    projectId: ProjectId,
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperIssue>, ListIssuesError>;
  readonly getIssue: (id: IssueId) => Effect.Effect<Option.Option<BookkeeperIssue>, GetIssueError>;
  readonly registerIssue: (
    issue: BookkeeperIssue,
  ) => Effect.Effect<BookkeeperIssue, RegisterIssueError>;
  readonly deleteIssue: (id: IssueId) => Effect.Effect<BookkeeperIssue, DeleteIssueError>;
  readonly getCounts: () => Effect.Effect<BookkeeperCounts, GetBookkeeperCountsError>;
}

/** Provides parsed Bookkeeper persistence without exposing SQL or table records. */
export class BookkeeperDatabase extends Context.Service<BookkeeperDatabase, IBookkeeperDatabase>()(
  "@overseer/BookkeeperDatabase",
) {}

const StoredWorkspaceRow = Schema.Struct({
  id: WorkspaceId,
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString,
  deleted_at: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});
const StoredProjectRow = Schema.Struct({
  id: ProjectId,
  workspace_id: WorkspaceId,
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString,
  deleted_at: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});
const StoredIssueRow = Schema.Struct({
  id: IssueId,
  project_id: ProjectId,
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString,
  deleted_at: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});
const StoredCountsRow = Schema.Struct({
  workspaces: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  projects: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  issues: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
const StoredProjectIdentityRow = Schema.Struct({ id: ProjectId });
const StoredIssueIdentityRow = Schema.Struct({ id: IssueId });

type StoredWorkspaceRow = typeof StoredWorkspaceRow.Type;
type StoredProjectRow = typeof StoredProjectRow.Type;
type StoredIssueRow = typeof StoredIssueRow.Type;
type EncodedStoredWorkspaceRow = typeof StoredWorkspaceRow.Encoded;
type EncodedStoredProjectRow = typeof StoredProjectRow.Encoded;
type EncodedStoredIssueRow = typeof StoredIssueRow.Encoded;
type EncodedStoredCountsRow = typeof StoredCountsRow.Encoded;
type EncodedStoredProjectIdentityRow = typeof StoredProjectIdentityRow.Encoded;
type EncodedStoredIssueIdentityRow = typeof StoredIssueIdentityRow.Encoded;

const parseStoredWorkspaceRows = Schema.decodeUnknownEffect(Schema.Array(StoredWorkspaceRow));
const parseStoredProjectRows = Schema.decodeUnknownEffect(Schema.Array(StoredProjectRow));
const parseStoredIssueRows = Schema.decodeUnknownEffect(Schema.Array(StoredIssueRow));
const parseStoredCountsRow = Schema.decodeUnknownEffect(StoredCountsRow);
const parseStoredProjectIdentityRows = Schema.decodeUnknownEffect(
  Schema.Array(StoredProjectIdentityRow),
);
const parseStoredIssueIdentityRows = Schema.decodeUnknownEffect(
  Schema.Array(StoredIssueIdentityRow),
);
const parseWorkspaceId = Schema.decodeUnknownEffect(WorkspaceId);
const parseProjectId = Schema.decodeUnknownEffect(ProjectId);
const parseIssueId = Schema.decodeUnknownEffect(IssueId);

const initialBookkeeperMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`PRAGMA foreign_keys = ON`;
  yield* sql`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;
  yield* sql`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;
  yield* sql`
    CREATE TABLE issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX projects_by_workspace
      ON projects (workspace_id, deleted_at, id)
  `;
  yield* sql`
    CREATE INDEX issues_by_project
      ON issues (project_id, deleted_at, id)
  `;
});

const bookkeeperMigrationLoader = SqliteMigrator.fromRecord({
  "1_initial_bookkeeper": initialBookkeeperMigration,
});

const workspaceFromStoredRow = (row: StoredWorkspaceRow): BookkeeperWorkspace => ({
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});
const projectFromStoredRow = (row: StoredProjectRow): BookkeeperProject => ({
  id: row.id,
  workspaceId: row.workspace_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});
const issueFromStoredRow = (row: StoredIssueRow): BookkeeperIssue => ({
  id: row.id,
  projectId: row.project_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

const formatBookkeeperTimestamp = DateTime.formatIso;
const encodeBookkeeperCursor = (scope: string, id: string): PaginationCursor =>
  PaginationCursor.make(Encoding.encodeBase64Url(`${scope}${id}`));

/** Construct Bookkeeper persistence after all bundled SQL migrations complete. */
export const makeBookkeeperDatabase: Effect.Effect<
  BookkeeperDatabase["Service"],
  SqliteMigrator.MigrationError | SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  yield* SqliteMigrator.run({
    loader: bookkeeperMigrationLoader,
    table: "schema_migrations",
  });

  const sql = yield* SqlClient.SqlClient;

  const findWorkspaceRow = Effect.fn("BookkeeperDatabase.findWorkspaceRow")(function* (
    id: WorkspaceId,
  ) {
    const rows = yield* sql<EncodedStoredWorkspaceRow>`
      SELECT id, created_at, updated_at, deleted_at
      FROM workspaces
      WHERE id = ${id}
      LIMIT 1
    `;
    const parsed = yield* parseStoredWorkspaceRows(rows);
    return Option.fromNullishOr(parsed[0]);
  });

  const findProjectRow = Effect.fn("BookkeeperDatabase.findProjectRow")(function* (id: ProjectId) {
    const rows = yield* sql<EncodedStoredProjectRow>`
      SELECT id, workspace_id, created_at, updated_at, deleted_at
      FROM projects
      WHERE id = ${id}
      LIMIT 1
    `;
    const parsed = yield* parseStoredProjectRows(rows);
    return Option.fromNullishOr(parsed[0]);
  });

  const findIssueRow = Effect.fn("BookkeeperDatabase.findIssueRow")(function* (id: IssueId) {
    const rows = yield* sql<EncodedStoredIssueRow>`
      SELECT id, project_id, created_at, updated_at, deleted_at
      FROM issues
      WHERE id = ${id}
      LIMIT 1
    `;
    const parsed = yield* parseStoredIssueRows(rows);
    return Option.fromNullishOr(parsed[0]);
  });

  const listWorkspaces = Effect.fn("BookkeeperDatabase.listWorkspaces")(
    function* (request: PaginationRequest) {
      const cursor = yield* Option.match(request.cursor, {
        onNone: () => Effect.succeedNone,
        onSome: (value) => {
          const decoded = Encoding.decodeBase64UrlString(value);
          if (Result.isFailure(decoded) || !decoded.success.startsWith("workspaces:")) {
            return Effect.fail(
              new ListWorkspacesError({
                reason: "InvalidCursor",
                message: "Bookkeeper Workspace cursor is invalid",
              }),
            );
          }
          return parseWorkspaceId(decoded.success.slice("workspaces:".length)).pipe(
            Effect.asSome,
            Effect.catchTag("SchemaError", () =>
              Effect.fail(
                new ListWorkspacesError({
                  reason: "InvalidCursor",
                  message: "Bookkeeper Workspace cursor is invalid",
                }),
              ),
            ),
          );
        },
      });
      const rowLimit = request.limit + 1;
      const rows = yield* Option.match(cursor, {
        onNone: () => sql<EncodedStoredWorkspaceRow>`
        SELECT id, created_at, updated_at, deleted_at
        FROM workspaces
        WHERE deleted_at IS NULL
        ORDER BY id ASC
        LIMIT ${rowLimit}
      `,
        onSome: (id) => sql<EncodedStoredWorkspaceRow>`
        SELECT id, created_at, updated_at, deleted_at
        FROM workspaces
        WHERE deleted_at IS NULL AND id > ${id}
        ORDER BY id ASC
        LIMIT ${rowLimit}
      `,
      });
      const parsed = yield* parseStoredWorkspaceRows(rows);
      const pageRows = parsed.slice(0, request.limit);
      const nextCursor =
        parsed.length > request.limit
          ? Option.map(Option.fromNullishOr(pageRows.at(-1)), (row) =>
              encodeBookkeeperCursor("workspaces:", row.id),
            )
          : Option.none<PaginationCursor>();
      return { items: pageRows.map(workspaceFromStoredRow), nextCursor };
    },
    Effect.catchTags({
      ListWorkspacesError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new ListWorkspacesError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to list Workspaces",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new ListWorkspacesError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to list Workspaces",
          }),
        ),
    }),
  );

  const getWorkspace = Effect.fn("BookkeeperDatabase.getWorkspace")(
    function* (id: WorkspaceId) {
      return Option.map(yield* findWorkspaceRow(id), workspaceFromStoredRow);
    },
    Effect.catchTags({
      SchemaError: () =>
        Effect.fail(
          new GetWorkspaceError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to get Workspace",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new GetWorkspaceError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to get Workspace",
          }),
        ),
    }),
  );

  const registerWorkspace = Effect.fn("BookkeeperDatabase.registerWorkspace")(
    function* (workspace: BookkeeperWorkspace) {
      if (Option.isSome(workspace.deletedAt)) {
        return yield* new RegisterWorkspaceError({
          reason: "DeletedEntityCannotBeRestored",
          message: "Bookkeeper cannot register a deleted Workspace",
        });
      }
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* findWorkspaceRow(workspace.id);
          if (Option.isSome(existing)) {
            if (Option.isSome(existing.value.deleted_at)) {
              return yield* new RegisterWorkspaceError({
                reason: "DeletedEntityCannotBeRestored",
                message: "Bookkeeper cannot restore a deleted Workspace",
              });
            }
            if (
              DateTime.toEpochMillis(workspace.updatedAt) <
              DateTime.toEpochMillis(existing.value.updated_at)
            ) {
              return yield* new RegisterWorkspaceError({
                reason: "UpdatedAtMovedBackward",
                message: "Bookkeeper Workspace updatedAt cannot move backward",
              });
            }
            yield* sql`
            UPDATE workspaces
            SET updated_at = ${formatBookkeeperTimestamp(workspace.updatedAt)}
            WHERE id = ${workspace.id}
          `;
          } else {
            yield* sql`
            INSERT INTO workspaces (id, created_at, updated_at, deleted_at)
            VALUES (
              ${workspace.id},
              ${formatBookkeeperTimestamp(workspace.createdAt)},
              ${formatBookkeeperTimestamp(workspace.updatedAt)},
              NULL
            )
          `;
          }
          const stored = yield* findWorkspaceRow(workspace.id);
          if (Option.isNone(stored)) {
            return yield* new RegisterWorkspaceError({
              reason: "PersistenceFailed",
              message: "Bookkeeper registered Workspace could not be read",
            });
          }
          return workspaceFromStoredRow(stored.value);
        }),
      );
    },
    Effect.catchTags({
      RegisterWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new RegisterWorkspaceError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to register Workspace",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new RegisterWorkspaceError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to register Workspace",
          }),
        ),
    }),
  );

  const deleteWorkspace = Effect.fn("BookkeeperDatabase.deleteWorkspace")(
    function* (id: WorkspaceId) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* findWorkspaceRow(id);
          if (Option.isNone(existing)) {
            return yield* new DeleteWorkspaceError({
              reason: "NotFound",
              message: "Bookkeeper cannot delete an unknown Workspace",
            });
          }
          if (Option.isSome(existing.value.deleted_at)) {
            return workspaceFromStoredRow(existing.value);
          }
          const children = yield* sql<EncodedStoredProjectIdentityRow>`
          SELECT id FROM projects
          WHERE workspace_id = ${id} AND deleted_at IS NULL
          LIMIT 1
        `;
          const parsedChildren = yield* parseStoredProjectIdentityRows(children);
          if (parsedChildren.length > 0) {
            return yield* new DeleteWorkspaceError({
              reason: "LiveChildren",
              message: "Bookkeeper cannot delete a Workspace with live Projects",
            });
          }
          const deletedAt = yield* DateTime.now;
          const timestamp = formatBookkeeperTimestamp(deletedAt);
          yield* sql`
          UPDATE workspaces
          SET updated_at = ${timestamp}, deleted_at = ${timestamp}
          WHERE id = ${id}
        `;
          const stored = yield* findWorkspaceRow(id);
          if (Option.isNone(stored)) {
            return yield* new DeleteWorkspaceError({
              reason: "PersistenceFailed",
              message: "Bookkeeper deleted Workspace could not be read",
            });
          }
          return workspaceFromStoredRow(stored.value);
        }),
      );
    },
    Effect.catchTags({
      DeleteWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new DeleteWorkspaceError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to delete Workspace",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new DeleteWorkspaceError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to delete Workspace",
          }),
        ),
    }),
  );

  const listProjects = Effect.fn("BookkeeperDatabase.listProjects")(
    function* (workspaceId: WorkspaceId, request: PaginationRequest) {
      const scope = `projects:${workspaceId}:`;
      const cursor = yield* Option.match(request.cursor, {
        onNone: () => Effect.succeedNone,
        onSome: (value) => {
          const decoded = Encoding.decodeBase64UrlString(value);
          if (Result.isFailure(decoded) || !decoded.success.startsWith(scope)) {
            return Effect.fail(
              new ListProjectsError({
                reason: "InvalidCursor",
                message: "Bookkeeper Project cursor is invalid",
              }),
            );
          }
          return parseProjectId(decoded.success.slice(scope.length)).pipe(
            Effect.asSome,
            Effect.catchTag("SchemaError", () =>
              Effect.fail(
                new ListProjectsError({
                  reason: "InvalidCursor",
                  message: "Bookkeeper Project cursor is invalid",
                }),
              ),
            ),
          );
        },
      });
      const rowLimit = request.limit + 1;
      const rows = yield* Option.match(cursor, {
        onNone: () => sql<EncodedStoredProjectRow>`
        SELECT id, workspace_id, created_at, updated_at, deleted_at
        FROM projects
        WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
        ORDER BY id ASC
        LIMIT ${rowLimit}
      `,
        onSome: (id) => sql<EncodedStoredProjectRow>`
        SELECT id, workspace_id, created_at, updated_at, deleted_at
        FROM projects
        WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL AND id > ${id}
        ORDER BY id ASC
        LIMIT ${rowLimit}
      `,
      });
      const parsed = yield* parseStoredProjectRows(rows);
      const pageRows = parsed.slice(0, request.limit);
      const nextCursor =
        parsed.length > request.limit
          ? Option.map(Option.fromNullishOr(pageRows.at(-1)), (row) =>
              encodeBookkeeperCursor(scope, row.id),
            )
          : Option.none<PaginationCursor>();
      return { items: pageRows.map(projectFromStoredRow), nextCursor };
    },
    Effect.catchTags({
      ListProjectsError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new ListProjectsError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to list Projects",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new ListProjectsError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to list Projects",
          }),
        ),
    }),
  );

  const getProject = Effect.fn("BookkeeperDatabase.getProject")(
    function* (id: ProjectId) {
      return Option.map(yield* findProjectRow(id), projectFromStoredRow);
    },
    Effect.catchTags({
      SchemaError: () =>
        Effect.fail(
          new GetProjectError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to get Project",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new GetProjectError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to get Project",
          }),
        ),
    }),
  );

  const registerProject = Effect.fn("BookkeeperDatabase.registerProject")(
    function* (project: BookkeeperProject) {
      if (Option.isSome(project.deletedAt)) {
        return yield* new RegisterProjectError({
          reason: "DeletedEntityCannotBeRestored",
          message: "Bookkeeper cannot register a deleted Project",
        });
      }
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const parent = yield* findWorkspaceRow(project.workspaceId);
          if (Option.isNone(parent)) {
            return yield* new RegisterProjectError({
              reason: "ParentNotFound",
              message: "Bookkeeper Project requires a registered Workspace",
            });
          }
          if (Option.isSome(parent.value.deleted_at)) {
            return yield* new RegisterProjectError({
              reason: "ParentDeleted",
              message: "Bookkeeper Project requires a live Workspace",
            });
          }
          const existing = yield* findProjectRow(project.id);
          if (Option.isSome(existing)) {
            if (existing.value.workspace_id !== project.workspaceId) {
              return yield* new RegisterProjectError({
                reason: "OwnershipChanged",
                message: "Bookkeeper Project Workspace ownership cannot change",
              });
            }
            if (Option.isSome(existing.value.deleted_at)) {
              return yield* new RegisterProjectError({
                reason: "DeletedEntityCannotBeRestored",
                message: "Bookkeeper cannot restore a deleted Project",
              });
            }
            if (
              DateTime.toEpochMillis(project.updatedAt) <
              DateTime.toEpochMillis(existing.value.updated_at)
            ) {
              return yield* new RegisterProjectError({
                reason: "UpdatedAtMovedBackward",
                message: "Bookkeeper Project updatedAt cannot move backward",
              });
            }
            yield* sql`
            UPDATE projects
            SET updated_at = ${formatBookkeeperTimestamp(project.updatedAt)}
            WHERE id = ${project.id}
          `;
          } else {
            yield* sql`
            INSERT INTO projects (id, workspace_id, created_at, updated_at, deleted_at)
            VALUES (
              ${project.id},
              ${project.workspaceId},
              ${formatBookkeeperTimestamp(project.createdAt)},
              ${formatBookkeeperTimestamp(project.updatedAt)},
              NULL
            )
          `;
          }
          const stored = yield* findProjectRow(project.id);
          if (Option.isNone(stored)) {
            return yield* new RegisterProjectError({
              reason: "PersistenceFailed",
              message: "Bookkeeper registered Project could not be read",
            });
          }
          return projectFromStoredRow(stored.value);
        }),
      );
    },
    Effect.catchTags({
      RegisterProjectError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new RegisterProjectError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to register Project",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new RegisterProjectError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to register Project",
          }),
        ),
    }),
  );

  const deleteProject = Effect.fn("BookkeeperDatabase.deleteProject")(
    function* (id: ProjectId) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* findProjectRow(id);
          if (Option.isNone(existing)) {
            return yield* new DeleteProjectError({
              reason: "NotFound",
              message: "Bookkeeper cannot delete an unknown Project",
            });
          }
          if (Option.isSome(existing.value.deleted_at)) {
            return projectFromStoredRow(existing.value);
          }
          const children = yield* sql<EncodedStoredIssueIdentityRow>`
          SELECT id FROM issues
          WHERE project_id = ${id} AND deleted_at IS NULL
          LIMIT 1
        `;
          const parsedChildren = yield* parseStoredIssueIdentityRows(children);
          if (parsedChildren.length > 0) {
            return yield* new DeleteProjectError({
              reason: "LiveChildren",
              message: "Bookkeeper cannot delete a Project with live Issues",
            });
          }
          const deletedAt = yield* DateTime.now;
          const timestamp = formatBookkeeperTimestamp(deletedAt);
          yield* sql`
          UPDATE projects
          SET updated_at = ${timestamp}, deleted_at = ${timestamp}
          WHERE id = ${id}
        `;
          const stored = yield* findProjectRow(id);
          if (Option.isNone(stored)) {
            return yield* new DeleteProjectError({
              reason: "PersistenceFailed",
              message: "Bookkeeper deleted Project could not be read",
            });
          }
          return projectFromStoredRow(stored.value);
        }),
      );
    },
    Effect.catchTags({
      DeleteProjectError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new DeleteProjectError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to delete Project",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new DeleteProjectError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to delete Project",
          }),
        ),
    }),
  );

  const listIssues = Effect.fn("BookkeeperDatabase.listIssues")(
    function* (projectId: ProjectId, request: PaginationRequest) {
      const scope = `issues:${projectId}:`;
      const cursor = yield* Option.match(request.cursor, {
        onNone: () => Effect.succeedNone,
        onSome: (value) => {
          const decoded = Encoding.decodeBase64UrlString(value);
          if (Result.isFailure(decoded) || !decoded.success.startsWith(scope)) {
            return Effect.fail(
              new ListIssuesError({
                reason: "InvalidCursor",
                message: "Bookkeeper Issue cursor is invalid",
              }),
            );
          }
          return parseIssueId(decoded.success.slice(scope.length)).pipe(
            Effect.asSome,
            Effect.catchTag("SchemaError", () =>
              Effect.fail(
                new ListIssuesError({
                  reason: "InvalidCursor",
                  message: "Bookkeeper Issue cursor is invalid",
                }),
              ),
            ),
          );
        },
      });
      const rowLimit = request.limit + 1;
      const rows = yield* Option.match(cursor, {
        onNone: () => sql<EncodedStoredIssueRow>`
        SELECT id, project_id, created_at, updated_at, deleted_at
        FROM issues
        WHERE project_id = ${projectId} AND deleted_at IS NULL
        ORDER BY id ASC
        LIMIT ${rowLimit}
      `,
        onSome: (id) => sql<EncodedStoredIssueRow>`
        SELECT id, project_id, created_at, updated_at, deleted_at
        FROM issues
        WHERE project_id = ${projectId} AND deleted_at IS NULL AND id > ${id}
        ORDER BY id ASC
        LIMIT ${rowLimit}
      `,
      });
      const parsed = yield* parseStoredIssueRows(rows);
      const pageRows = parsed.slice(0, request.limit);
      const nextCursor =
        parsed.length > request.limit
          ? Option.map(Option.fromNullishOr(pageRows.at(-1)), (row) =>
              encodeBookkeeperCursor(scope, row.id),
            )
          : Option.none<PaginationCursor>();
      return { items: pageRows.map(issueFromStoredRow), nextCursor };
    },
    Effect.catchTags({
      ListIssuesError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new ListIssuesError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to list Issues",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new ListIssuesError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to list Issues",
          }),
        ),
    }),
  );

  const getIssue = Effect.fn("BookkeeperDatabase.getIssue")(
    function* (id: IssueId) {
      return Option.map(yield* findIssueRow(id), issueFromStoredRow);
    },
    Effect.catchTags({
      SchemaError: () =>
        Effect.fail(
          new GetIssueError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to get Issue",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new GetIssueError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to get Issue",
          }),
        ),
    }),
  );

  const registerIssue = Effect.fn("BookkeeperDatabase.registerIssue")(
    function* (issue: BookkeeperIssue) {
      if (Option.isSome(issue.deletedAt)) {
        return yield* new RegisterIssueError({
          reason: "DeletedEntityCannotBeRestored",
          message: "Bookkeeper cannot register a deleted Issue",
        });
      }
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const parent = yield* findProjectRow(issue.projectId);
          if (Option.isNone(parent)) {
            return yield* new RegisterIssueError({
              reason: "ParentNotFound",
              message: "Bookkeeper Issue requires a registered Project",
            });
          }
          if (Option.isSome(parent.value.deleted_at)) {
            return yield* new RegisterIssueError({
              reason: "ParentDeleted",
              message: "Bookkeeper Issue requires a live Project",
            });
          }
          const existing = yield* findIssueRow(issue.id);
          if (Option.isSome(existing)) {
            if (existing.value.project_id !== issue.projectId) {
              return yield* new RegisterIssueError({
                reason: "OwnershipChanged",
                message: "Bookkeeper Issue Project ownership cannot change",
              });
            }
            if (Option.isSome(existing.value.deleted_at)) {
              return yield* new RegisterIssueError({
                reason: "DeletedEntityCannotBeRestored",
                message: "Bookkeeper cannot restore a deleted Issue",
              });
            }
            if (
              DateTime.toEpochMillis(issue.updatedAt) <
              DateTime.toEpochMillis(existing.value.updated_at)
            ) {
              return yield* new RegisterIssueError({
                reason: "UpdatedAtMovedBackward",
                message: "Bookkeeper Issue updatedAt cannot move backward",
              });
            }
            yield* sql`
            UPDATE issues
            SET updated_at = ${formatBookkeeperTimestamp(issue.updatedAt)}
            WHERE id = ${issue.id}
          `;
          } else {
            yield* sql`
            INSERT INTO issues (id, project_id, created_at, updated_at, deleted_at)
            VALUES (
              ${issue.id},
              ${issue.projectId},
              ${formatBookkeeperTimestamp(issue.createdAt)},
              ${formatBookkeeperTimestamp(issue.updatedAt)},
              NULL
            )
          `;
          }
          const stored = yield* findIssueRow(issue.id);
          if (Option.isNone(stored)) {
            return yield* new RegisterIssueError({
              reason: "PersistenceFailed",
              message: "Bookkeeper registered Issue could not be read",
            });
          }
          return issueFromStoredRow(stored.value);
        }),
      );
    },
    Effect.catchTags({
      RegisterIssueError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new RegisterIssueError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to register Issue",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new RegisterIssueError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to register Issue",
          }),
        ),
    }),
  );

  const deleteIssue = Effect.fn("BookkeeperDatabase.deleteIssue")(
    function* (id: IssueId) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* findIssueRow(id);
          if (Option.isNone(existing)) {
            return yield* new DeleteIssueError({
              reason: "NotFound",
              message: "Bookkeeper cannot delete an unknown Issue",
            });
          }
          if (Option.isSome(existing.value.deleted_at)) {
            return issueFromStoredRow(existing.value);
          }
          const deletedAt = yield* DateTime.now;
          const timestamp = formatBookkeeperTimestamp(deletedAt);
          yield* sql`
          UPDATE issues
          SET updated_at = ${timestamp}, deleted_at = ${timestamp}
          WHERE id = ${id}
        `;
          const stored = yield* findIssueRow(id);
          if (Option.isNone(stored)) {
            return yield* new DeleteIssueError({
              reason: "PersistenceFailed",
              message: "Bookkeeper deleted Issue could not be read",
            });
          }
          return issueFromStoredRow(stored.value);
        }),
      );
    },
    Effect.catchTags({
      DeleteIssueError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new DeleteIssueError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to delete Issue",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new DeleteIssueError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to delete Issue",
          }),
        ),
    }),
  );

  const getCounts = Effect.fn("BookkeeperDatabase.getCounts")(
    function* () {
      const rows = yield* sql<EncodedStoredCountsRow>`
      SELECT
        (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL) AS workspaces,
        (SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL) AS projects,
        (SELECT COUNT(*) FROM issues WHERE deleted_at IS NULL) AS issues
    `;
      const row = yield* parseStoredCountsRow(rows[0]);
      return row;
    },
    Effect.catchTags({
      SchemaError: () =>
        Effect.fail(
          new GetBookkeeperCountsError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper failed to count live entities",
          }),
        ),
      SqlError: () =>
        Effect.fail(
          new GetBookkeeperCountsError({
            reason: "PersistenceFailed",
            message: "Bookkeeper failed to count live entities",
          }),
        ),
    }),
  );

  return BookkeeperDatabase.of({
    listWorkspaces,
    getWorkspace,
    registerWorkspace,
    deleteWorkspace,
    listProjects,
    getProject,
    registerProject,
    deleteProject,
    listIssues,
    getIssue,
    registerIssue,
    deleteIssue,
    getCounts,
  });
});

/** Provides Bookkeeper persistence while leaving the generic SQL client requirement visible. */
export const bookkeeperDatabaseLayerWithoutDependencies = Layer.effect(
  BookkeeperDatabase,
  makeBookkeeperDatabase,
);
