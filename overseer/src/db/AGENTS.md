# DB LAYER

SQLite persistence with foreign key enforcement, CASCADE deletes, prefixed ID constraints.

## FILES

| File | Lines | Purpose |
|------|-------|---------|
| `schema.rs` | 71 | DDL, connection mgmt, FK enforcement |
| `task_repo.rs` | 388 | Task CRUD, blockers, hierarchy queries |
| `learning_repo.rs` | 252 | Learning CRUD, task association |
| `mod.rs` | 12 | Public API re-exports |

## SCHEMA

```sql
tasks (
  id TEXT PRIMARY KEY CHECK (id LIKE 'task_%'),
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  description, context, result, priority, completed,
  completed_at, created_at, updated_at, commit_sha, started_at
)

learnings (
  id TEXT PRIMARY KEY CHECK (id LIKE 'lrn_%'),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content, source_task_id, created_at
)

task_blockers (
  task_id, blocker_id -- both FK to tasks with CASCADE
  PRIMARY KEY (task_id, blocker_id)
)

task_metadata (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  data TEXT NOT NULL
)
```

## PATTERNS

**Initialization (schema.rs:62-70)**
- `PRAGMA foreign_keys = ON;` enforced on every connection
- `PRAGMA journal_mode = WAL;` for concurrent reads
- Schema versioning via `user_version` pragma

**CASCADE delete invariant**
- Deleting task -> removes children, learnings, blockers

**ID constraints**
- All IDs prefixed: `task_*`, `lrn_*`
- CHECK constraints enforce at DB layer
- Generated via ULID (src/id.rs)

**Row mapping**
- `row_to_task()`: SQLite -> domain type
- Timestamps: RFC3339 string <-> DateTime<Utc>
- Boolean: i32 (0/1) <-> bool

**Dynamic queries (task_repo.rs:114-146)**
- Build SQL + params vector for filtering
- `Box<dyn ToSql>` for heterogeneous params
- Order: priority ASC, created_at ASC

**Depth calculation (task_repo.rs:267-290)**
- Walk parent_id chain until NULL
- No recursion - iterative loop
- Used for 3-level hierarchy enforcement

**Ready filter (task_repo.rs:141-143)**
- Ready = not completed AND all blockers completed
