# CLI Reference

Complete reference for the `os` command-line tool.

## Global Options

```bash
os --version              # Show version
os --help                 # Show help
os --json <command>       # JSON output mode
os --db <path> <command>  # Custom database path
os --no-color <command>   # Disable colored output
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
  --priority 1 \
  --blocked-by task_01JQAZ...,task_01JQBA...
```

### `os task get`

Get task details with inherited context.

```bash
os task get TASK_ID
```

**Output:** TaskWithContext (flat structure with inherited context):
```json
{
  "id": "task_01JQAZ...",
  "parentId": "task_01JQAY...",
  "description": "Implement login endpoint",
  "priority": 3,
  "completed": false,
  "depth": 2,
  "effectivelyBlocked": false,
  "context": {
    "own": "Task's own context",
    "parent": "Parent task context (if depth > 0)",
    "milestone": "Root milestone context (if depth > 1)"
  },
  "learnings": {
    "own": [],           // Learnings attached to this task
    "parent": [...],     // Learnings from parent task
    "milestone": [...]   // Learnings from root milestone
  }
}
```

### `os task list`

List tasks with filters.

```bash
os task list \
  [--parent PARENT_ID] \
  [--ready] \
  [--completed] \
  [--milestones | --tasks | --subtasks] \
  [--flat]
```

**Filters:**
- `--parent`: Show children of specific task (conflicts with depth filters)
- `--ready`: Only show ready tasks (no blockers, not completed)
- `--completed`: Only show completed tasks
- `-m, --milestones`: Show only depth 0 tasks (mutually exclusive with --tasks/--subtasks)
- `-t, --tasks`: Show only depth 1 tasks (mutually exclusive with --milestones/--subtasks)
- `-s, --subtasks`: Show only depth 2 tasks (mutually exclusive with --milestones/--tasks)
- `--flat`: Show flat list instead of tree view (human output only; JSON always flat)

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
os task update task_01JQAZ... --priority 1

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
- Records start commit (`startCommit` field)
- Returns the task that was actually started

**Algorithm:**
1. If requested task is blocked, follow blockers to find startable work
2. Cascade down through hierarchy to deepest incomplete leaf
3. Start that leaf task (set `started_at`, create VCS bookmark, record start commit)
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
os task complete TASK_ID [--result "Completion notes"] [--learning "..."]...
```

**Arguments:**
- `--result`: Completion notes/summary
- `--learning`: Learning discovered during task (repeatable flag)

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

# With learnings (repeatable)
os task complete task_01JQAZ... --learning "bcrypt rounds should be 12+" --learning "jose > jsonwebtoken"

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
- If `TASK_ID` provided, shows tree rooted at that task (JSON: single `TaskTree`)
- If omitted, shows **all milestone trees** (JSON: `TaskTree[]` array)
- Output includes all descendants recursively

**Example:**
```bash
# Show tree for specific milestone
os task tree task_01JQAZ...

# Show all milestone trees
os task tree
```

**JSON Output:**
```json
// With TASK_ID (single tree):
{ "task": {...}, "children": [...] }

// Without TASK_ID (all milestones):
[
  { "task": {...}, "children": [...] },
  { "task": {...}, "children": [...] }
]
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

### `os task progress`

Get progress summary for a milestone or all tasks.

```bash
os task progress [TASK_ID]
```

**Behavior:**
- If `TASK_ID` provided, counts that task and all descendants
- If omitted, counts all tasks in database
- Returns aggregate counts

**Output:**
```json
{
  "total": 10,
  "completed": 3,
  "ready": 5,      // !completed && !effectivelyBlocked
  "blocked": 2     // !completed && effectivelyBlocked
}
```

**Example:**
```bash
# Progress for specific milestone
os task progress task_01JQAZ...

# Progress for all tasks
os task progress
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
  "type": "jj",  // or "git", "none"
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
  "files": [
    { "path": "path/to/modified.rs", "status": "modified" },
    { "path": "path/to/new.txt", "status": "added" }
  ],
  "workingCopyId": "abc123..."
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
  { "path": "src/auth.rs", "changeType": "modified" },
  { "path": "tests/auth_test.rs", "changeType": "added" }
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
  "id": "abc123...",
  "message": "Commit message"
}
```

### `os vcs cleanup`

Clean up orphaned task branches/bookmarks.

```bash
os vcs cleanup [--delete]
```

**Options:**
- `--delete`: Actually delete orphaned branches (default is dry-run/list only)

**Behavior:**
- Lists branches matching `task/*` pattern where:
  - Task no longer exists in database, OR
  - Task is completed (branch wasn't cleaned up)
- Validates branch names against TaskId format (skips invalid)
- Without `--delete`: reports orphaned branches only
- With `--delete`: attempts deletion, reports failures

**Output:**
```json
{
  "orphaned": [
    { "name": "task/task_01JQAZ...", "reason": "taskNotFound" },
    { "name": "task/task_01JQBA...", "reason": "taskCompleted" }
  ],
  "deleted": ["task/task_01JQAZ..."],
  "failed": []
}
```

**Examples:**
```bash
# List orphaned branches (dry-run)
os vcs cleanup

# Delete orphaned branches
os vcs cleanup --delete
```

## JSON Output Mode

All commands support `--json` flag for machine-readable output:

```bash
os --json task create -d "Task description"
os --json task list --ready
os --json vcs status
```

## Task Status

Tasks use `completed: boolean` and `effectivelyBlocked: boolean` fields:

| Field | Description |
|-------|-------------|
| `completed` | Task is finished |
| `effectivelyBlocked` | Task OR any ancestor has incomplete blockers |

**Ready state**: Computed, not stored. Task is ready when:
- `completed = false`
- `effectivelyBlocked = false`

**Note:** `startedAt` tracks when work began, `completedAt` tracks when finished.

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

When fetching task with `get` or `next-ready`, the response is **flat** (task fields at root level with context/learnings added):

```json
{
  "id": "task_01JQAZ...",
  "parentId": "task_01JQAY...",
  "description": "Implement login endpoint",
  "priority": 3,
  "completed": false,
  "depth": 2,
  ...other task fields...
  "context": {
    "own": "Task's context",           // Always present
    "parent": "Parent task context",   // If depth > 0
    "milestone": "Root context"        // If depth > 1
  },
  "learnings": {
    "own": [...],        // Learnings attached to this task
    "parent": [...],     // From parent task (if depth > 0)
    "milestone": [...]   // From root milestone (if depth > 1)
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

## Additional Commands

### `os ui`

Launch the Task Viewer web UI:

```bash
os ui [--port PORT]
```

Opens a web browser to the task visualization interface.

### `os init`

Initialize Overseer in the current directory:

```bash
os init
```

Creates `.overseer/` directory and `tasks.db` database.

### `os completions`

Generate shell completions:

```bash
os completions <SHELL>
```

Supported shells: `bash`, `zsh`, `fish`, `powershell`, `elvish`

## Database Location

SQLite database stored at: `$CWD/.overseer/tasks.db`

**Note:** Run all `os` commands from your project root where `.overseer/` directory exists.
