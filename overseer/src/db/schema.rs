use rusqlite::Connection;

use crate::error::Result;

const SCHEMA_VERSION: i32 = 2;

pub fn init_schema(conn: &Connection) -> Result<()> {
    let current_version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if current_version == 0 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY CHECK (id LIKE 'task_%'),
                parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE CHECK (parent_id LIKE 'task_%'),
                description TEXT NOT NULL,
                context TEXT NOT NULL DEFAULT '',
                result TEXT,
                priority INTEGER NOT NULL DEFAULT 3,
                completed INTEGER NOT NULL DEFAULT 0,
                completed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                commit_sha TEXT,
                started_at TEXT,
                bookmark TEXT,
                start_commit TEXT
            );

            CREATE TABLE IF NOT EXISTS learnings (
                id TEXT PRIMARY KEY CHECK (id LIKE 'lrn_%'),
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE CHECK (task_id LIKE 'task_%'),
                content TEXT NOT NULL,
                source_task_id TEXT CHECK (source_task_id LIKE 'task_%'),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_blockers (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE CHECK (task_id LIKE 'task_%'),
                blocker_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE CHECK (blocker_id LIKE 'task_%'),
                PRIMARY KEY (task_id, blocker_id)
            );

            CREATE TABLE IF NOT EXISTS task_metadata (
                task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
                data TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
            CREATE INDEX IF NOT EXISTS idx_learnings_task ON learnings(task_id);
            CREATE INDEX IF NOT EXISTS idx_blockers_blocker ON task_blockers(blocker_id);

            PRAGMA journal_mode = WAL;
            "#,
        )?;

        // Fresh database gets the latest schema version
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }

    // Migration for existing databases at version 1
    if current_version == 1 {
        conn.execute_batch(
            r#"
            BEGIN;
            ALTER TABLE tasks ADD COLUMN bookmark TEXT;
            ALTER TABLE tasks ADD COLUMN start_commit TEXT;
            COMMIT;
            "#,
        )?;
        conn.pragma_update(None, "user_version", 2)?;
    }

    Ok(())
}

pub fn open_db(path: &std::path::Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    init_schema(&conn)?;
    Ok(conn)
}
