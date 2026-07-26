import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** The Workspace Registry schema could not be migrated. */
export class WorkspaceRegistryMigrationFailed extends Schema.TaggedErrorClass<WorkspaceRegistryMigrationFailed>()(
  "WorkspaceRegistryMigrationFailed",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  /** Construct a classified Workspace Registry migration failure. */
  constructor(cause: unknown) {
    super({ message: "The Workspace Registry schema migration failed", cause });
  }
}

/** SQL statements that establish the Workspace Registry schema. */
const workspaceRegistrySchemaStatements = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    lifecycle TEXT NOT NULL CHECK (lifecycle = 'active'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS workspaces_name_id
   ON workspaces (name ASC, id ASC)`,
  `CREATE TABLE IF NOT EXISTS workspace_registry_idempotency (
    scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    workspace_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, idempotency_key)
  )`,
] as const;

const migrations = SqliteMigrator.fromRecord({
  "1_initialize_workspace_registry": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const statement of workspaceRegistrySchemaStatements) {
      yield* sql.unsafe(statement);
    }
  }),
});

const migrateWorkspaceRegistry: Effect.Effect<
  void,
  WorkspaceRegistryMigrationFailed,
  SqlClient.SqlClient
> = SqliteMigrator.run({ loader: migrations }).pipe(
  Effect.mapError((cause) => new WorkspaceRegistryMigrationFailed(cause)),
  Effect.asVoid,
);

/** Workspace Registry migration layer for one SQLite Durable Object activation. */
export const layer = Layer.effectDiscard(migrateWorkspaceRegistry);
