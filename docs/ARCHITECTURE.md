# Architecture

System design, data model, and invariants for Overseer.

## Overview

Overseer uses a **two-tier architecture**: Rust CLI for business logic + Node.js MCP wrapper for agent interface.

```
┌─────────────────────────────────┐
│     Overseer MCP (Node.js)      │
│  - execute tool (codemode)      │
│  - VM sandbox (tasks/vcs APIs)  │
│  - CLI bridge (spawn + JSON)    │
└─────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│        os CLI (Rust)            │
│  - All business logic           │
│  - SQLite storage               │
│  - jj-lib (primary VCS)         │
│  - gix (git fallback)           │
│  - JSON output mode             │
└─────────────────────────────────┘
```

## Why This Architecture?

| Decision | Rationale |
|----------|-----------|
| **Rust CLI core** | Testable, reusable, performant, type-safe |
| **Node MCP wrapper** | MCP SDK is JS, codemode needs V8 sandbox |
| **SQLite not JSON** | Queries, transactions, FTS, concurrent safe |
| **jj-lib not shell** | Native performance, no spawn overhead |
| **gix not git2** | Pure Rust, no C deps, actively maintained |
| **JJ-first** | Primary VCS, git as fallback for wider adoption |
| **ULID IDs** | Sortable, no central coordination needed |

## Data Model

### Task Entity

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,              -- ULID (task_01JQAZ...)
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    result TEXT,                      -- Completion notes
    priority INTEGER NOT NULL DEFAULT 5,  -- 1-10
    status TEXT NOT NULL DEFAULT 'pending',  -- pending|in_progress|completed
    depth INTEGER,                    -- 0=milestone, 1=task, 2=subtask
    commit_sha TEXT,                  -- Auto-populated on complete
    created_at TEXT NOT NULL,         -- ISO 8601
    started_at TEXT,
    completed_at TEXT
);
```

**Hierarchy rules:**
- **Milestone** (depth 0): No parent, root of tree
- **Task** (depth 1): Parent is milestone
- **Subtask** (depth 2): Parent is task, max depth

**Status transitions:**
```
pending → in_progress → completed
          ↓             ↓
        pending ← ← ← ← ┘ (reopen)
```

### Learning Entity

```sql
CREATE TABLE learnings (
    id TEXT PRIMARY KEY,              -- ULID (learning_01JQAZ...)
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source_task_id TEXT,              -- Optional: which task generated this
    created_at TEXT NOT NULL
);
```

Learnings attached to tasks, inherited progressively down hierarchy.

### Task Blockers

```sql
CREATE TABLE task_blockers (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocker_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, blocker_id)
);
```

Explicit dependency graph. Task is **ready** when all blockers completed.

## Invariants

### 1. Max Depth = 2

Tasks cannot exceed depth 2 (3 levels total: Milestone → Task → Subtask).

**Enforced by:** `TaskService::create()` checks parent depth before insert.

### 2. No Blocker Cycles

Cannot create blocker relationships that form cycles.

**Enforced by:** `TaskService::add_blocker()` runs DFS cycle detection before insert.

**Example rejected:**
```
A blocks B
B blocks C
C blocks A  ← rejected (cycle: A→B→C→A)
```

### 3. No Parent Cycles

Cannot set parent that would create cycle in task tree.

**Enforced by:** `TaskService::update()` validates parent chain before update.

### 4. Complete Requires Children Done

Cannot complete task if it has pending children.

**Enforced by:** `TaskService::complete()` checks for incomplete children.

### 5. Ready State Computed

Task is ready when:
- `status != completed`
- All blockers completed (or blocker deleted)
- Not currently blocked

**Enforced by:** Computed during `list(filter: { ready: true })`.

### 6. VCS Required for Workflow

VCS (jj or git) is required for `start` and `complete` operations. Fails with `NotARepository` if none found.

**Enforced by:** `WorkflowService` requires `Box<dyn VcsBackend>` (not Option).

### 7. CASCADE Delete

Deleting task cascades to:
- All child tasks recursively
- All learnings attached to task
- All blocker relationships

**Enforced by:** SQLite `ON DELETE CASCADE` foreign keys.

## Progressive Context

When fetching task, response includes inherited context from ancestors:

```json
{
  "task": { "id": "...", "depth": 2, ... },
  "context": {
    "own": "Subtask's context",
    "parent": "Parent task's context",     // depth > 0
    "milestone": "Root milestone context"  // depth > 1
  },
  "learnings": {
    "milestone": [...],  // From root
    "parent": [...]      // From parent
  }
}
```

**Context disclosure by depth:**

| Depth | Own | Parent | Milestone |
|-------|-----|--------|-----------|
| 0 (Milestone) | ✅ | - | - |
| 1 (Task) | ✅ | - | ✅ |
| 2 (Subtask) | ✅ | ✅ | ✅ |

**Implementation:** `get_task_with_context()` walks parent chain, assembles context + learnings.

## VCS Integration

### Backend Trait

```rust
pub trait VcsBackend {
    fn vcs_type(&self) -> VcsType;       // jj, git, none
    fn root(&self) -> &Path;             // Repo root
    fn status(&self) -> Result<VcsStatus>;
    fn log(&self, limit: usize) -> Result<Vec<LogEntry>>;
    fn diff(&self, base: Option<&str>) -> Result<Vec<DiffEntry>>;
    fn commit(&self, message: &str) -> Result<CommitResult>;
    fn current_commit_id(&self) -> Result<String>;
}
```

### Detection Priority

1. Walk up from `cwd` looking for `.jj/` → use `JjBackend`
2. If not found, look for `.git/` → use `GixBackend`
3. If neither → return `VcsType::None`

**jj-first design:** Always prefer jj when available.

### Backend Implementations

#### JjBackend (jj-lib)

- Native Rust, no spawn overhead
- Uses `jj_lib::workspace::Workspace`
- Primary VCS, optimized for performance

#### GixBackend (gix)

- Pure Rust git implementation
- No C dependencies (unlike git2)
- Fallback for non-jj repos

### Commit Workflow

**jj (jj-lib):**
```rust
// 1. jj describe -m "message"  (set description)
// 2. jj new                    (create new change)
```

**git (gix + CLI):**
```rust
// 1. git add -A    (stage all)
// 2. git commit -m "message"
// Note: Uses CLI because gix staging API unstable
```

## Codemode Pattern

Overseer MCP uses **single execute tool** instead of one tool per operation.

### Traditional MCP

```
Tool: create_task
Tool: add_learning
Tool: complete_task
→ 3 tool calls, 3 round trips
```

### Codemode MCP

```javascript
// Single tool call, agent writes JS
const task = await tasks.create({...});
await learnings.add(task.id, "...");
await tasks.complete(task.id);
return task;
```

### Benefits

- **Fewer round trips:** Compose operations in single execution
- **Better DX:** Agents understand TypeScript APIs better than tool schemas
- **Control flow:** Use JS `if/for/try` for complex logic
- **Type safety:** VM sandbox provides typed `tasks/learnings/vcs` APIs

### Implementation

**Node MCP server:**
1. Exposes single `execute` tool
2. Receives JS code from agent
3. Runs code in VM sandbox with APIs
4. APIs call Rust CLI via `spawn`
5. Returns execution result

**VM sandbox context:**
```javascript
{
  tasks: { create, get, list, update, ... },
  learnings: { add, list, delete },
  vcs: { detect, status, log, diff, commit },
  console, setTimeout, Promise
}
```

**Security:**
- 30s execution timeout
- No network access (fetch/http unavailable)
- No filesystem access
- Sandboxed environment

## Database Location

SQLite database stored at: `$CWD/.os/tasks.db`

**Initialization:**
```bash
# Automatic on first command
os task create "First task"
# Creates .os/ directory and tasks.db
```

**Schema versioning:**
```sql
PRAGMA user_version = 1;
PRAGMA journal_mode = WAL;  -- Better concurrent access
```

## Error Handling

### Rust CLI

All errors use `thiserror`:

```rust
#[derive(Error, Debug)]
pub enum OsError {
    #[error("task not found: {0}")]
    TaskNotFound(TaskId),
    
    #[error("max depth exceeded")]
    MaxDepthExceeded,
    
    #[error("blocker cycle detected: {0}")]
    BlockerCycle(String),
    
    #[error("task has pending children")]
    PendingChildren,
    
    #[error(transparent)]
    Vcs(#[from] VcsError),
    
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
}
```

### MCP Server

```typescript
try {
  const result = await execute(code);
  return { result };
} catch (err) {
  if (err instanceof ExecutionError) {
    return { error: err.message, stack: err.stackTrace };
  }
  throw err;
}
```

## Performance Considerations

### Indexes

```sql
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_ready ON tasks(parent_id, completed, priority, created_at)
    WHERE completed = 0;
CREATE INDEX idx_learnings_task ON learnings(task_id);
CREATE INDEX idx_blockers_blocker ON task_blockers(blocker_id);
```

### Optimized Builds

```toml
[profile.dev.package.jj-lib]
opt-level = 1  # Faster jj operations in dev

[profile.dev.package.gix]
opt-level = 1  # Faster git operations in dev
```

### VCS Backend Selection

- **jj-lib:** Native Rust, no spawn = fast
- **gix:** Pure Rust, no C linking = portable + fast
- **CLI fallback:** Only for unstable gix APIs (staging)

## Testing Strategy

### Unit Tests

- `TaskService`: CRUD, invariants, cycle detection
- `LearningService`: CRUD, cascade delete
- `VcsBackend`: Mock implementations

### Integration Tests

- `testutil` module: Shared test fixtures
- `JjTestRepo`: Real jj repos in tempdir
- `GitTestRepo`: Real git repos in tempdir
- End-to-end VCS workflows

### MCP Tests

```typescript
// Test execute tool
const result = await execute(`
  const task = await tasks.create({...});
  return task.id;
`);
```

## Future Considerations

### Potential Enhancements

1. **Full-text search:** SQLite FTS5 for task search
2. **Export/import:** JSON dump/restore (Task #62)
3. **Task templates:** Predefined task hierarchies
4. **Time tracking:** Duration stats per task
5. **Tags/labels:** Cross-cutting task organization

### Scalability

Current design supports:
- **Tasks:** 100k+ (SQLite handles millions)
- **Hierarchy:** 3 levels (prevents explosion)
- **Concurrent access:** WAL mode enables readers during writes
- **VCS repos:** Any size (native backends, no shell overhead)

### Migration Path

Schema versioning via `PRAGMA user_version`:

```rust
fn migrate(conn: &Connection) -> Result<()> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    
    match version {
        0 => {
            // Initial schema
            init_schema(conn)?;
            conn.pragma_update(None, "user_version", 1)?;
        }
        1 => {
            // Future migration
        }
        _ => {}
    }
    Ok(())
}
```

## References

- [CLI Reference](CLI.md) - Complete command documentation
- [MCP Guide](MCP.md) - Agent usage patterns
- [Design Plan](task-orchestrator-plan.md) - Original design spec
- [Codemode Research](codemode-research.md) - Implementation guide
