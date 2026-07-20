import type { DurableObjectStorage } from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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

/** Apply the ordered Catalog schema bootstrap to one Durable Object. */
export const migrateCatalog: (
  storage: DurableObjectStorage,
) => Effect.Effect<void, CatalogMigrationFailed> =
  Effect.fn("CatalogMigrations.migrate")(function* (storage) {
    yield* Effect.try({
      try: () => {
        storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS overseer_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
          );
          INSERT OR IGNORE INTO overseer_migrations (version, applied_at)
            VALUES (1, datetime('now'));
        `);
      },
      catch: (cause) => new CatalogMigrationFailed(cause),
    });
  });
