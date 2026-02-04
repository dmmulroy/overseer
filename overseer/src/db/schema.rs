use rusqlite::Connection;

use crate::error::Result;

const SCHEMA_VERSION: i32 = 5;

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
                priority INTEGER NOT NULL DEFAULT 1,
                completed INTEGER NOT NULL DEFAULT 0,
                completed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                commit_sha TEXT,
                started_at TEXT,
                bookmark TEXT,
                start_commit TEXT,
                cancelled INTEGER NOT NULL DEFAULT 0,
                cancelled_at TEXT,
                archived INTEGER NOT NULL DEFAULT 0,
                archived_at TEXT
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
            CREATE INDEX IF NOT EXISTS idx_tasks_cancelled ON tasks(cancelled);
            CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(archived);
            CREATE INDEX IF NOT EXISTS idx_learnings_task ON learnings(task_id);
            CREATE INDEX IF NOT EXISTS idx_blockers_blocker ON task_blockers(blocker_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_learnings_unique 
                ON learnings(task_id, source_task_id, content);
            CREATE INDEX IF NOT EXISTS idx_learnings_task_created 
                ON learnings(task_id, created_at);

            PRAGMA journal_mode = WAL;
            "#,
        )?;

        // Fresh database gets the latest schema version
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }

    // Track version for sequential migrations
    let mut version = current_version;

    // Migration for existing databases at version 1
    if version == 1 {
        conn.execute_batch(
            r#"
            BEGIN;
            ALTER TABLE tasks ADD COLUMN bookmark TEXT;
            ALTER TABLE tasks ADD COLUMN start_commit TEXT;
            COMMIT;
            "#,
        )?;
        conn.pragma_update(None, "user_version", 2)?;
        version = 2;
    }

    // Migration for version 2 -> 3: Add unique index for learning bubbling idempotency
    // Also backfill source_task_id where NULL (set to task_id as origin)
    if version == 2 {
        conn.execute_batch(
            r#"
            BEGIN;
            UPDATE learnings SET source_task_id = task_id WHERE source_task_id IS NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_learnings_unique 
                ON learnings(task_id, source_task_id, content);
            CREATE INDEX IF NOT EXISTS idx_learnings_task_created 
                ON learnings(task_id, created_at);
            COMMIT;
            "#,
        )?;
        conn.pragma_update(None, "user_version", 3)?;
        version = 3;
    }

    // Migration for version 3 -> 4: Simplify priorities from 1-5 to 0-2
    // p0 = highest (was 1), p1 = default/medium (was 2-3), p2 = lowest (was 4-5)
    if version == 3 {
        conn.execute_batch(
            r#"
            BEGIN;
            UPDATE tasks
            SET priority =
              CASE
                WHEN priority <= 1 THEN 0
                WHEN priority <= 3 THEN 1
                ELSE 2
              END;
            COMMIT;
            "#,
        )?;
        conn.pragma_update(None, "user_version", 4)?;
        version = 4;
    }

    // Migration for version 4 -> 5: Add cancelled and archived columns
    // cancelled: marks task as cancelled (incomplete tasks only)
    // archived: hides completed/cancelled tasks from default views
    if version == 4 {
        conn.execute_batch(
            r#"
            BEGIN;
            ALTER TABLE tasks ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE tasks ADD COLUMN cancelled_at TEXT;
            ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE tasks ADD COLUMN archived_at TEXT;
            COMMIT;
            "#,
        )?;
        conn.pragma_update(None, "user_version", 5)?;
        version = 5;
    }

    // Suppress unused variable warning - version is used for sequential migration chaining
    let _ = version;

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
