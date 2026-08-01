import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** The Project schema could not be migrated. */
export class ProjectMigrationFailed extends Schema.TaggedErrorClass<ProjectMigrationFailed>()(
  "ProjectMigrationFailed",
  { message: Schema.String, cause: Schema.Defect() },
) {
  /** Construct a classified Project migration failure. */
  constructor(cause: unknown) {
    super({ message: "The Project schema migration failed", cause });
  }
}

const migrations = SqliteMigrator.fromRecord({
  "1_initialize_issue_discovery": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const statements = [
      `CREATE TABLE IF NOT EXISTS project_counters (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        next_issue_number INTEGER NOT NULL CHECK (next_issue_number >= 1)
      )`,
      `INSERT OR IGNORE INTO project_counters (singleton, next_issue_number) VALUES (1, 1)`,
      `CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        issue_number INTEGER NOT NULL UNIQUE CHECK (issue_number >= 1),
        title TEXT NOT NULL,
        body TEXT,
        state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
        lifecycle TEXT NOT NULL CHECK (lifecycle = 'active'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        next_timeline_position INTEGER NOT NULL CHECK (next_timeline_position >= 2)
      )`,
      `CREATE TABLE IF NOT EXISTS issue_revisions (
        issue_id TEXT NOT NULL REFERENCES issues(id),
        field TEXT NOT NULL CHECK (field IN ('title', 'body')),
        revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
        value TEXT,
        actor_json TEXT NOT NULL,
        agent_session_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (issue_id, field, revision_number)
      )`,
      `CREATE TABLE IF NOT EXISTS timeline_events (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('issue_created', 'internal_reference_added', 'issue_closed', 'issue_reopened')),
        source_issue_id TEXT NOT NULL REFERENCES issues(id),
        target_issue_id TEXT REFERENCES issues(id),
        actor_json TEXT NOT NULL,
        agent_session_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS timeline_entries (
        issue_id TEXT NOT NULL REFERENCES issues(id),
        position INTEGER NOT NULL CHECK (position >= 1),
        event_id TEXT NOT NULL REFERENCES timeline_events(id),
        PRIMARY KEY (issue_id, position)
      )`,
      `CREATE TABLE IF NOT EXISTS issue_references (
        source_issue_id TEXT NOT NULL REFERENCES issues(id),
        target_issue_id TEXT NOT NULL REFERENCES issues(id),
        PRIMARY KEY (source_issue_id, target_issue_id),
        CHECK (source_issue_id <> target_issue_id)
      )`,
      `CREATE TABLE IF NOT EXISTS project_idempotency_keys (
        idempotency_key TEXT PRIMARY KEY NOT NULL,
        result_type TEXT NOT NULL CHECK (result_type IN ('issue_creation', 'issue_steering')),
        issue_id TEXT NOT NULL REFERENCES issues(id),
        response_json TEXT
      )`,
    ] as const;
    for (const statement of statements) yield* sql.unsafe(statement);
  }),
});

/** Project migration layer for one SQLite Durable Object activation. */
export const layer = Layer.effectDiscard(
  SqliteMigrator.run({ loader: migrations }).pipe(
    Effect.mapError((cause) => new ProjectMigrationFailed(cause)),
    Effect.asVoid,
  ),
);
