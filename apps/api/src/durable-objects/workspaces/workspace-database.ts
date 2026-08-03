import { SqliteMigrator } from "@effect/sql-sqlite-do";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";
import {
  ArchiveWorkspaceError,
  CreateWorkspaceError,
  GetWorkspaceError,
  RenameWorkspaceError,
  UnarchiveWorkspaceError,
  Workspace,
  type WorkspaceId,
  type WorkspaceName,
  type WorkspaceState,
} from "../../domain/workspace.ts";

const WorkspaceRecord = Schema.Struct({
  id: Workspace.fields.id,
  name: Workspace.fields.name,
  state: Workspace.fields.state,
  createdAt: Workspace.fields.createdAt,
  updatedAt: Workspace.fields.updatedAt,
});

type WorkspaceRecord = typeof WorkspaceRecord.Encoded;

const parseWorkspaceRecord = Schema.decodeUnknownEffect(WorkspaceRecord);

const workspaceMigrationLoader = SqliteMigrator.fromRecord({
  "1_create_workspace": Effect.gen(function* () {
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
  }),
});

/** Domain-shaped persistence capability owned by one Workspace Durable Object. */
export interface IWorkspaceDatabase {
  /** Idempotently initialize this Durable Object with one Workspace identity. */
  readonly createWorkspace: (input: {
    readonly id: WorkspaceId;
    readonly name: WorkspaceName;
  }) => Effect.Effect<Workspace, CreateWorkspaceError>;

  /** Read the Workspace when this Durable Object has been initialized. */
  readonly getWorkspace: Effect.Effect<Option.Option<Workspace>, GetWorkspaceError>;

  /** Replace the initialized Workspace display name. */
  readonly renameWorkspace: (name: WorkspaceName) => Effect.Effect<Workspace, RenameWorkspaceError>;

  /** Move the initialized Workspace into the archived state. */
  readonly archiveWorkspace: Effect.Effect<Workspace, ArchiveWorkspaceError>;

  /** Move the initialized Workspace into the active state. */
  readonly unarchiveWorkspace: Effect.Effect<Workspace, UnarchiveWorkspaceError>;
}

/** Provides parsed Workspace persistence without exposing SQL records or tables. */
export class WorkspaceDatabase extends Context.Service<WorkspaceDatabase, IWorkspaceDatabase>()(
  "@overseer/WorkspaceDatabase",
) {}

const selectWorkspace = (sql: SqlClient.SqlClient) =>
  sql<WorkspaceRecord>`
    SELECT
      id,
      name,
      state,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM workspaces
    WHERE singleton = 1
    LIMIT 1
  `;

const decodeOptionalWorkspace = (
  records: ReadonlyArray<WorkspaceRecord>,
): Effect.Effect<Option.Option<Workspace>, Schema.SchemaError> => {
  const record = records[0];
  return record === undefined
    ? Effect.succeed(Option.none())
    : parseWorkspaceRecord(record).pipe(Effect.map(Option.some));
};

const updateWorkspace = (
  sql: SqlClient.SqlClient,
  input: {
    readonly name: WorkspaceName | undefined;
    readonly state: WorkspaceState | undefined;
    readonly updatedAt: string;
  },
) => sql<WorkspaceRecord>`
  UPDATE workspaces
  SET
    name = ${input.name === undefined ? sql.literal("name") : input.name},
    state = ${input.state === undefined ? sql.literal("state") : input.state},
    updated_at = ${input.updatedAt}
  WHERE singleton = 1
  RETURNING
    id,
    name,
    state,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

/** Construct Workspace persistence over the generic Effect SQL client after bundled migrations complete. */
export const makeWorkspaceDatabase: Effect.Effect<
  WorkspaceDatabase["Service"],
  SqliteMigrator.MigrationError | SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* SqliteMigrator.run({ loader: workspaceMigrationLoader });

  const getWorkspace = Effect.fn("WorkspaceDatabase.getWorkspace")(function* () {
    const records = yield* selectWorkspace(sql).pipe(
      Effect.catchTag("SqlError", () =>
        Effect.fail(new GetWorkspaceError({ reason: "database_unavailable" })),
      ),
    );
    return yield* decodeOptionalWorkspace(records).pipe(
      Effect.catchTag("SchemaError", () =>
        Effect.fail(new GetWorkspaceError({ reason: "stored_workspace_invalid" })),
      ),
    );
  })();

  const createWorkspace = Effect.fn("WorkspaceDatabase.createWorkspace")(function* (input: {
    readonly id: WorkspaceId;
    readonly name: WorkspaceName;
  }) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const existingRecords = yield* selectWorkspace(sql);
          const existing = yield* decodeOptionalWorkspace(existingRecords).pipe(
            Effect.catchTag("SchemaError", () =>
              Effect.fail(new CreateWorkspaceError({ reason: "stored_workspace_invalid" })),
            ),
          );

          if (Option.isSome(existing)) {
            return existing.value.id === input.id
              ? existing.value
              : yield* Effect.fail(new CreateWorkspaceError({ reason: "workspace_id_mismatch" }));
          }

          const now = DateTime.formatIso(yield* DateTime.now);
          const records = yield* sql<WorkspaceRecord>`
            INSERT INTO workspaces (singleton, id, name, state, created_at, updated_at)
            VALUES (1, ${input.id}, ${input.name}, 'active', ${now}, ${now})
            RETURNING
              id,
              name,
              state,
              created_at AS createdAt,
              updated_at AS updatedAt
          `;
          const workspace = yield* decodeOptionalWorkspace(records).pipe(
            Effect.catchTag("SchemaError", () =>
              Effect.fail(new CreateWorkspaceError({ reason: "stored_workspace_invalid" })),
            ),
          );

          return yield* Option.match(workspace, {
            onNone: () => Effect.fail(new CreateWorkspaceError({ reason: "database_unavailable" })),
            onSome: Effect.succeed,
          });
        }),
      )
      .pipe(
        Effect.catchTag("SqlError", () =>
          Effect.fail(new CreateWorkspaceError({ reason: "database_unavailable" })),
        ),
      );
  });

  const renameWorkspace = Effect.fn("WorkspaceDatabase.renameWorkspace")(function* (
    name: WorkspaceName,
  ) {
    const now = DateTime.formatIso(yield* DateTime.now);
    const records = yield* updateWorkspace(sql, {
      name,
      state: undefined,
      updatedAt: now,
    }).pipe(
      Effect.catchTag("SqlError", () =>
        Effect.fail(new RenameWorkspaceError({ reason: "database_unavailable" })),
      ),
    );
    const workspace = yield* decodeOptionalWorkspace(records).pipe(
      Effect.catchTag("SchemaError", () =>
        Effect.fail(new RenameWorkspaceError({ reason: "stored_workspace_invalid" })),
      ),
    );
    return yield* Option.match(workspace, {
      onNone: () => Effect.fail(new RenameWorkspaceError({ reason: "workspace_not_found" })),
      onSome: Effect.succeed,
    });
  });

  const setWorkspaceState = <Error extends ArchiveWorkspaceError | UnarchiveWorkspaceError>(
    state: WorkspaceState,
    makeNotFoundError: () => Error,
    makeDatabaseError: () => Error,
    makeStoredDataError: () => Error,
  ): Effect.Effect<Workspace, Error> =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      const records = yield* updateWorkspace(sql, {
        name: undefined,
        state,
        updatedAt: now,
      }).pipe(Effect.catchTag("SqlError", () => Effect.fail(makeDatabaseError())));
      const workspace = yield* decodeOptionalWorkspace(records).pipe(
        Effect.catchTag("SchemaError", () => Effect.fail(makeStoredDataError())),
      );
      return yield* Option.match(workspace, {
        onNone: () => Effect.fail(makeNotFoundError()),
        onSome: Effect.succeed,
      });
    });

  const archiveWorkspace = Effect.fn("WorkspaceDatabase.archiveWorkspace")(function* () {
    return yield* setWorkspaceState(
      "archived",
      () => new ArchiveWorkspaceError({ reason: "workspace_not_found" }),
      () => new ArchiveWorkspaceError({ reason: "database_unavailable" }),
      () => new ArchiveWorkspaceError({ reason: "stored_workspace_invalid" }),
    );
  })();

  const unarchiveWorkspace = Effect.fn("WorkspaceDatabase.unarchiveWorkspace")(function* () {
    return yield* setWorkspaceState(
      "active",
      () => new UnarchiveWorkspaceError({ reason: "workspace_not_found" }),
      () => new UnarchiveWorkspaceError({ reason: "database_unavailable" }),
      () => new UnarchiveWorkspaceError({ reason: "stored_workspace_invalid" }),
    );
  })();

  return WorkspaceDatabase.of({
    createWorkspace,
    getWorkspace,
    renameWorkspace,
    archiveWorkspace,
    unarchiveWorkspace,
  });
});

/** Provide Workspace persistence while leaving the generic Effect SQL client requirement visible. */
export const workspaceDatabaseLayerWithoutDependencies = Layer.effect(
  WorkspaceDatabase,
  makeWorkspaceDatabase,
);
