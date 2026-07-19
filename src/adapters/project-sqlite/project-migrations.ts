import type { DurableObjectStorage } from "@cloudflare/workers-types";

/** Apply the ordered Project-object schema bootstrap to one Durable Object. */
export function migrateProject(storage: DurableObjectStorage): void {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS overseer_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO overseer_migrations (version, applied_at)
      VALUES (1, datetime('now'));
  `);
}
