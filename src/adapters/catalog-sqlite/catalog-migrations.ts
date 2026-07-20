import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

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

const migrations = SqliteMigrator.fromRecord({
  "1_initialize_catalog": Effect.void,
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
