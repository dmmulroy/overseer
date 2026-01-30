# CLI Reference

Complete reference for the `os` command-line tool.

## Global Options

```bash
os --version    # Show version
os --help       # Show help
```

## Task Management

### `os task create`

Create a new task.

```bash
os task create \
  -d "Task description" \
  [--context "Additional context"] \
  [--parent PARENT_TASK_ID] \
  [--priority 1-5] \
  [--blocked-by BLOCKER_ID,...]
```

**Arguments:**
- `-d, --description` (required): Task description
- `--context`: Additional context information
- `--parent`: Parent task ID (creates subtask)
- `--priority`: Priority level (1-5, default: 3)
- `--blocked-by`: Comma-separated list of blocking task IDs

**Examples:**
```bash
# Create milestone (depth 0)
os task create -d "Implement user auth"

# Create subtask
os task create -d "Add login endpoint" --parent task_01JQAZ...

# Create with priority and blocker
os task create \
  -d "Deploy to production" \
  --priority 10 \
  --blocked-by task_01JQAZ...,task_01JQBA...
```

### `os task get`

Get task details with inherited context.

```bash
os task get TASK_ID
```

**Output:** Task with progressive context:
```json
{
  "task": { "id": "...", "description": "...", ... },
  "context": {
    "own": "Task's own context",
    "parent": "Parent task context (if depth > 0)",
    "milestone": "Root milestone context (if depth > 1)"
  },
  "learnings": {
    "milestone": [...],  // Learnings from root milestone
    "parent": [...]      // Learnings from parent task
  }
}
```

### `os task list`

List tasks with filters.

```bash
os task list \
  [--parent PARENT_ID] \
  [--ready] \
  [--completed]
```

**Filters:**
- `--parent`: Show children of specific task
- `--ready`: Only show ready tasks (no blockers, not completed)
- `--completed`: Only show completed tasks

**Examples:**
```bash
# List all tasks
os task list

# List children of specific task
os task list --parent task_01JQAZ...

# List ready tasks
os task list --ready

# List completed tasks
os task list --completed
```

### `os task update`

Update task fields.

```bash
os task update TASK_ID \
  [-d "New description"] \
  [--context "New context"] \
  [--priority 1-5] \
  [--parent NEW_PARENT_ID]
```

**Examples:**
```bash
# Update description
os task update task_01JQAZ... -d "Updated description"

# Update priority
os task update task_01JQAZ... --priority 8

# Move to different parent
os task update task_01JQAZ... --parent task_01JQBA...
```

### `os task start`

Start working on a task.

```bash
os task start TASK_ID
```

**Behavior:**
- **VCS required** - fails with `NotARepository` if no jj/git
- Follows blockers to find startable work
- Cascades down to deepest incomplete leaf
- Creates VCS bookmark for started task
- Returns the task that was actually started

**Algorithm:**
1. If requested task is blocked, follow blockers to find startable work
2. Cascade down through hierarchy to deepest incomplete leaf
3. Start that leaf task (set `started_at`, create VCS bookmark)
4. Error only if no startable task found after exhausting all paths

**Examples:**
```bash
# Start work on a task
os task start task_01JQAZ...

# Starting a blocked milestone follows blockers automatically
# If milestone_A is blocked by task_B, this starts task_B
os task start task_01MILESTONE_A...
```

### `os task complete`

Mark task as completed.

```bash
os task complete TASK_ID [--result "Completion notes"]
```

**Behavior:**
- **VCS required** - fails with `NotARepository` if no jj/git
- Sets `status = completed`, `completed_at = now()`
- Commits changes (NothingToCommit treated as success)
- Fails if task has pending children
- Optional `--result` stores completion notes
- **Bubble-up:** Auto-completes parent if all siblings done and parent unblocked

**Bubble-up Algorithm:**
1. After completing task, check if parent has any pending children
2. If no pending children AND parent is not blocked, auto-complete parent
3. Recursively bubble up to milestone level
4. Stop if parent is blocked or has pending children

**Examples:**
```bash
# Simple completion
os task complete task_01JQAZ...

# With result notes
os task complete task_01JQAZ... --result "Implemented JWT auth with refresh tokens"

# Completing the last subtask auto-completes its parent task
# If task has subtask_A and subtask_B, completing both auto-completes the task
```

### `os task reopen`

Reopen completed task.

```bash
os task reopen TASK_ID
```

Sets `status = pending`, clears `completed_at`.

### `os task delete`

Delete task and all descendants.

```bash
os task delete TASK_ID
```

**Warning:** Cascades delete to all children and learnings. Cannot be undone.

### `os task block`

Add blocker dependency.

```bash
os task block TASK_ID --by BLOCKER_ID
```

Marks `TASK_ID` as blocked by `BLOCKER_ID`. Task becomes not ready until blocker completes.

**Example:**
```bash
os task block task_01JQAZ... --by task_01JQBA...
```

### `os task unblock`

Remove blocker dependency.

```bash
os task unblock TASK_ID --by BLOCKER_ID
```

### `os task next-ready`

Find next ready task to work on.

```bash
os task next-ready [--milestone MILESTONE_ID]
```

**Behavior:**
- **Depth-first traversal** through task hierarchy
- Returns **deepest incomplete leaf** that is not blocked
- Respects **effective-unblocked inheritance** (if ancestor is blocked, subtree is blocked)
- Returns milestone itself if it has no children and is unblocked
- Returns `null` if no ready tasks found

**Algorithm:**
1. DFS traversal respecting priority ordering (higher priority first)
2. A task is "effectively blocked" if it OR any ancestor has incomplete blockers
3. Find deepest incomplete leaf that is effectively unblocked
4. Ordering: `priority DESC`, `created_at ASC`, `id ASC`

**Effective-Unblocked Inheritance:**
- If milestone is blocked → entire subtree is blocked
- Children completing doesn't unblock a blocked parent
- Children are NOT considered blockers (only explicit `blocked_by` relations)

**Example:**
```bash
# Get next ready task globally (searches all milestones)
os task next-ready

# Get next ready task within specific milestone
os task next-ready --milestone task_01JQAZ...
```

**Output (JSON):**
```json
// If task found (TaskWithContext - flat structure):
{
  "id": "task_01JQAZ...",
  "parentId": "task_01JQAY...",
  "description": "Implement login endpoint",
  "priority": 5,
  "completed": false,
  "depth": 2,
  "context": {
    "own": "JWT-based auth",
    "parent": "User authentication",
    "milestone": "Auth system v1"
  },
  "learnings": {
    "own": [],
    "parent": [{ "content": "Use bcrypt for passwords" }],
    "milestone": []
  }
  // ... other task fields
}

// If no ready tasks:
null
```

### `os task tree`

Display task hierarchy as tree.

```bash
os task tree [TASK_ID]
```

**Behavior:**
- If `TASK_ID` provided, shows tree rooted at that task
- If omitted, shows highest priority milestone tree
- Output includes all descendants recursively

**Example:**
```bash
# Show tree for specific milestone
os task tree task_01JQAZ...

# Show tree for highest priority milestone
os task tree
```

### `os task search`

Search tasks by text query.

```bash
os task search "query text"
```

Searches task `description`, `context`, and `result` fields (case-insensitive substring match).

**Example:**
```bash
os task search "authentication"
```

## Learning Management

### `os learning add`

Add learning to task.

```bash
os learning add TASK_ID "Learning content" [--source SOURCE_TASK_ID]
```

**Arguments:**
- `TASK_ID`: Task to attach learning to
- `content`: Learning text
- `--source`: Optional source task that generated this learning

**Examples:**
```bash
# Simple learning
os learning add task_01JQAZ... "bcrypt rounds should be 12 for production"

# Learning from another task
os learning add task_01JQAZ... "Use JWT refresh tokens" --source task_01JQBA...
```

### `os learning list`

List all learnings for task.

```bash
os learning list TASK_ID
```

Returns all learnings directly attached to specified task.

### `os learning delete`

Delete learning by ID.

```bash
os learning delete LEARNING_ID
```

## VCS Operations

### `os vcs detect`

Detect VCS type in current directory.

```bash
os vcs detect
```

**Output:**
```json
{
  "vcs_type": "jj",  // or "git", "none"
  "root": "/path/to/repo"
}
```

### `os vcs status`

Get working directory status.

```bash
os vcs status
```

**Output:**
```json
{
  "files": ["path/to/modified.rs", "path/to/new.txt"],
  "current_commit_id": "abc123..."
}
```

### `os vcs log`

Show commit history.

```bash
os vcs log [--limit N]
```

**Options:**
- `--limit`: Max commits to return (default: 10)

**Output:**
```json
[
  {
    "id": "abc123...",
    "description": "Add user auth",
    "author": "user@example.com",
    "timestamp": "2024-01-15T10:30:00Z"
  },
  ...
]
```

### `os vcs diff`

Show working directory changes.

```bash
os vcs diff [BASE_REV]
```

**Arguments:**
- `BASE_REV` (optional): Base revision to diff against (defaults to current commit)

**Output:**
```json
[
  { "path": "src/auth.rs", "change_type": "modified" },
  { "path": "tests/auth_test.rs", "change_type": "added" }
]
```

### `os vcs commit`

Create commit with all changes.

```bash
os vcs commit -m "Commit message"
```

**Behavior:**
- **jj**: Describes current change and creates new change
- **git**: Stages all changes (`git add -A`) and commits

**Output:**
```json
{
  "commit_id": "abc123..."
}
```

## JSON Output Mode

All commands support `--json` flag for machine-readable output:

```bash
os --json task create -d "Task description"
os --json task list --ready
os --json vcs status
```

## Task States

| State | Description |
|-------|-------------|
| `pending` | Not started, may have blockers |
| `in_progress` | Currently being worked on |
| `completed` | Finished successfully |

**Ready state**: Computed, not stored. Task is ready when:
- `status != completed`
- No incomplete blockers
- Not blocked by incomplete dependencies

## Task Hierarchy

```
Milestone (depth 0)
├── Task (depth 1)
│   ├── Subtask (depth 2)
│   └── Subtask (depth 2)
└── Task (depth 1)
```

**Rules:**
- Max depth: 2 (3 levels total)
- Milestones have `depth = 0`, no parent
- Tasks have `depth = 1`, parent is milestone
- Subtasks have `depth = 2`, parent is task

## Progressive Context

When fetching task with `get` or `next-ready`:

```json
{
  "task": { ... },
  "context": {
    "own": "Task's context",           // Always present
    "parent": "Parent task context",   // If depth > 0
    "milestone": "Root context"        // If depth > 1
  },
  "learnings": {
    "milestone": [...],  // From root milestone
    "parent": [...]      // From parent task
  }
}
```

**Depth 0 (Milestone):** Only `own` context  
**Depth 1 (Task):** `own` + `milestone` context, `milestone` learnings  
**Depth 2 (Subtask):** All context + all learnings

## Error Handling

Common errors:

```bash
# Task not found
Error: Task task_01JQAZ... not found

# Cycle detected
Error: Blocker cycle detected: task_01JQAZ... -> task_01JQBA... -> task_01JQAZ...

# Max depth exceeded
Error: Max task depth (2) exceeded

# Pending children
Error: Cannot complete task with pending children

# VCS not found
Error: No VCS repository found in current directory
```

## Exit Codes

- `0`: Success
- `1`: Error (details in stderr)

## Data Management

### `os data export`

Export all tasks, learnings, and blocker relationships to JSON:

```bash
# Export to default file (overseer-export.json)
os data export

# Export to custom file
os data export -o backup-2024-01-26.json

# JSON output
os data export --json
# Returns: {"exported": true, "path": "...", "tasks": N, "learnings": M}
```

**Export format includes:**
- All tasks with context, priority, timestamps, commit SHAs
- All learnings with source task references
- All blocker relationships
- Version metadata for compatibility checking

**Use cases:**
- Backup
- Version control for task plans (commit export files to git)

## Database Location

SQLite database stored at: `$CWD/.overseer/tasks.db`

**Note:** Run all `os` commands from your project root where `.overseer/` directory exists.
