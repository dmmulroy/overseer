import { SqliteMigrator } from "@effect/sql-sqlite-do";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";
import {
  ArchiveWorkspaceError,
  CreateWorkspaceError,
  GetWorkspaceError,
  RenameWorkspaceError,
  UnarchiveWorkspaceError,
  type Workspace,
  WorkspaceId,
  WorkspaceName,
  WorkspaceState,
} from "../../domain/workspace.ts";

/** Domain-shaped persistence capability owned by one Workspace Durable Object. */
export interface IWorkspaceDatabase {
  /** Idempotently initialize this Durable Object with one Workspace identity. */
  readonly createWorkspace: (input: {
    readonly id: WorkspaceId;
    readonly name: WorkspaceName;
  }) => Effect.Effect<Workspace, CreateWorkspaceError>;

  /** Read the Workspace when this Durable Object has been initialized. */
  readonly getWorkspace: () => Effect.Effect<Option.Option<Workspace>, GetWorkspaceError>;

  /** Replace the initialized Workspace display name. */
  readonly renameWorkspace: (name: WorkspaceName) => Effect.Effect<Workspace, RenameWorkspaceError>;

  /** Move the initialized Workspace into the archived state. */
  readonly archiveWorkspace: () => Effect.Effect<Workspace, ArchiveWorkspaceError>;

  /** Move the initialized Workspace into the active state. */
  readonly unarchiveWorkspace: () => Effect.Effect<Workspace, UnarchiveWorkspaceError>;
}

/** Provides parsed Workspace persistence without exposing SQL records or tables. */
export class WorkspaceDatabase extends Context.Service<WorkspaceDatabase, IWorkspaceDatabase>()(
  "@overseer/WorkspaceDatabase",
) {}

const StoredWorkspaceRow = Schema.Struct({
  id: WorkspaceId,
  name: WorkspaceName,
  state: WorkspaceState,
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString,
});

type StoredWorkspaceRow = typeof StoredWorkspaceRow.Type;
type EncodedStoredWorkspaceRow = typeof StoredWorkspaceRow.Encoded;

const parseStoredWorkspaceRows = Schema.decodeUnknownEffect(Schema.Array(StoredWorkspaceRow));

const initialWorkspaceMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE workspaces (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});

const workspaceMigrationLoader = SqliteMigrator.fromRecord({
  "1_create_workspace": initialWorkspaceMigration,
});

const workspaceFromStoredRow = (row: StoredWorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  state: row.state,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatWorkspaceTimestamp = DateTime.formatIso;

/** Construct Workspace persistence after all bundled SQL migrations complete. */
export const makeWorkspaceDatabase: Effect.Effect<
  WorkspaceDatabase["Service"],
  SqliteMigrator.MigrationError | SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  yield* SqliteMigrator.run({
    loader: workspaceMigrationLoader,
    table: "schema_migrations",
  });

  const sql = yield* SqlClient.SqlClient;

  const findWorkspaceRow = Effect.fn("WorkspaceDatabase.findWorkspaceRow")(function* () {
    const rows = yield* sql<EncodedStoredWorkspaceRow>`
      SELECT id, name, state, created_at, updated_at
      FROM workspaces
      WHERE singleton = 1
      LIMIT 1
    `;
    const parsed = yield* parseStoredWorkspaceRows(rows);
    return Option.fromNullishOr(parsed[0]);
  });

  const updateWorkspaceName = Effect.fn("WorkspaceDatabase.updateWorkspaceName")(function* (
    name: WorkspaceName,
  ) {
    const updatedAt = formatWorkspaceTimestamp(yield* DateTime.now);
    yield* sql`
      UPDATE workspaces
      SET name = ${name}, updated_at = ${updatedAt}
      WHERE singleton = 1
    `;
    return yield* findWorkspaceRow();
  });

  const updateWorkspaceState = Effect.fn("WorkspaceDatabase.updateWorkspaceState")(function* (
    state: WorkspaceState,
  ) {
    const updatedAt = formatWorkspaceTimestamp(yield* DateTime.now);
    yield* sql`
      UPDATE workspaces
      SET state = ${state}, updated_at = ${updatedAt}
      WHERE singleton = 1
    `;
    return yield* findWorkspaceRow();
  });

  const getWorkspace = Effect.fn("WorkspaceDatabase.getWorkspace")(
    function* () {
      return Option.map(yield* findWorkspaceRow(), workspaceFromStoredRow);
    },
    Effect.catchTags({
      SchemaError: () => Effect.fail(new GetWorkspaceError({ reason: "stored_workspace_invalid" })),
      SqlError: () => Effect.fail(new GetWorkspaceError({ reason: "database_unavailable" })),
    }),
  );

  const createWorkspace = Effect.fn("WorkspaceDatabase.createWorkspace")(
    function* (input: { readonly id: WorkspaceId; readonly name: WorkspaceName }) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* findWorkspaceRow();
          if (Option.isSome(existing)) {
            return existing.value.id === input.id
              ? workspaceFromStoredRow(existing.value)
              : yield* new CreateWorkspaceError({ reason: "workspace_id_mismatch" });
          }

          const now = formatWorkspaceTimestamp(yield* DateTime.now);
          yield* sql`
            INSERT INTO workspaces (singleton, id, name, state, created_at, updated_at)
            VALUES (1, ${input.id}, ${input.name}, 'active', ${now}, ${now})
          `;
          const stored = yield* findWorkspaceRow();
          if (Option.isNone(stored)) {
            return yield* new CreateWorkspaceError({ reason: "database_unavailable" });
          }
          return workspaceFromStoredRow(stored.value);
        }),
      );
    },
    Effect.catchTags({
      CreateWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(new CreateWorkspaceError({ reason: "stored_workspace_invalid" })),
      SqlError: () => Effect.fail(new CreateWorkspaceError({ reason: "database_unavailable" })),
    }),
  );

  const renameWorkspace = Effect.fn("WorkspaceDatabase.renameWorkspace")(
    function* (name: WorkspaceName) {
      const stored = yield* updateWorkspaceName(name);
      if (Option.isNone(stored)) {
        return yield* new RenameWorkspaceError({ reason: "workspace_not_found" });
      }
      return workspaceFromStoredRow(stored.value);
    },
    Effect.catchTags({
      RenameWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(new RenameWorkspaceError({ reason: "stored_workspace_invalid" })),
      SqlError: () => Effect.fail(new RenameWorkspaceError({ reason: "database_unavailable" })),
    }),
  );

  const archiveWorkspace = Effect.fn("WorkspaceDatabase.archiveWorkspace")(
    function* () {
      const stored = yield* updateWorkspaceState("archived");
      if (Option.isNone(stored)) {
        return yield* new ArchiveWorkspaceError({ reason: "workspace_not_found" });
      }
      return workspaceFromStoredRow(stored.value);
    },
    Effect.catchTags({
      ArchiveWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(new ArchiveWorkspaceError({ reason: "stored_workspace_invalid" })),
      SqlError: () => Effect.fail(new ArchiveWorkspaceError({ reason: "database_unavailable" })),
    }),
  );

  const unarchiveWorkspace = Effect.fn("WorkspaceDatabase.unarchiveWorkspace")(
    function* () {
      const stored = yield* updateWorkspaceState("active");
      if (Option.isNone(stored)) {
        return yield* new UnarchiveWorkspaceError({ reason: "workspace_not_found" });
      }
      return workspaceFromStoredRow(stored.value);
    },
    Effect.catchTags({
      UnarchiveWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(new UnarchiveWorkspaceError({ reason: "stored_workspace_invalid" })),
      SqlError: () => Effect.fail(new UnarchiveWorkspaceError({ reason: "database_unavailable" })),
    }),
  );

  return WorkspaceDatabase.of({
    createWorkspace,
    getWorkspace,
    renameWorkspace,
    archiveWorkspace,
    unarchiveWorkspace,
  });
});

/** Provides Workspace persistence while leaving the generic SQL client requirement visible. */
export const workspaceDatabaseLayerWithoutDependencies = Layer.effect(
  WorkspaceDatabase,
  makeWorkspaceDatabase,
);
