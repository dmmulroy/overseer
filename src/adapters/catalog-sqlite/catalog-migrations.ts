import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** The Catalog schema could not be migrated. */
export class CatalogMigrationFailed extends Schema.TaggedErrorClass<CatalogMigrationFailed>()(
  "CatalogMigrationFailed",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  /** Construct a classified Catalog migration failure. */
  constructor(cause: unknown) {
    super({ message: "The Catalog schema migration failed", cause });
  }
}

/** SQL statements that establish the Workspace Catalog schema. */
const catalogSchemaStatements = [
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
  `CREATE TABLE IF NOT EXISTS catalog_idempotency (
    principal_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    workspace_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (principal_key, idempotency_key)
  )`,
] as const;

const migrations = SqliteMigrator.fromRecord({
  "1_initialize_catalog": Effect.void,
  "2_add_workspace_catalog": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const statement of catalogSchemaStatements) {
      yield* sql.unsafe(statement);
    }
  }),
});

/** Apply the ordered Catalog migrations through the current SQL client. */
export const migrateCatalog: Effect.Effect<
  void,
  CatalogMigrationFailed,
  SqlClient.SqlClient
> = SqliteMigrator.run({ loader: migrations }).pipe(
  Effect.mapError((cause) => new CatalogMigrationFailed(cause)),
  Effect.asVoid,
);
