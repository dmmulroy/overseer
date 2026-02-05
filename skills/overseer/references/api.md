# Overseer Codemode MCP API

Execute JavaScript code to interact with Overseer task management.

## Task Interface

```typescript
// Basic task - returned by list(), create(), start(), complete()
// Note: Does NOT include context or learnings fields
interface Task {
  id: string;
  parentId: string | null;
  description: string;
  priority: 0 | 1 | 2;
  completed: boolean;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;            // ISO 8601
  updatedAt: string;
  result: string | null;        // Completion notes
  commitSha: string | null;     // Auto-populated on complete
  depth: 0 | 1 | 2;             // 0=milestone, 1=task, 2=subtask
  blockedBy?: string[];         // Blocking task IDs (omitted if empty)
  blocks?: string[];            // Tasks this blocks (omitted if empty)
  bookmark?: string;            // VCS bookmark name (if started)
  startCommit?: string;         // Commit SHA at start
  effectivelyBlocked: boolean;  // True if task OR ancestor has incomplete blockers
  cancelled: boolean;           // Task was cancelled (does NOT satisfy blockers)
  cancelledAt: string | null;
  archived: boolean;            // Task is archived (hidden from default list)
  archivedAt: string | null;
}

// Task with full context - returned by get(), nextReady()
interface TaskWithContext extends Task {
  context: {
    own: string;              // This task's context
    parent?: string;          // Parent's context (depth > 0)
    milestone?: string;       // Root milestone's context (depth > 1)
  };
  learnings: {
    own: Learning[];          // This task's learnings (bubbled from completed children)
    parent: Learning[];       // Parent's learnings (depth > 0)
    milestone: Learning[];    // Milestone's learnings (depth > 1)
  };
}

// Task tree structure - returned by tree()
interface TaskTree {
  task: Task;
  children: TaskTree[];
}

// Progress summary - returned by progress()
interface TaskProgress {
  total: number;
  completed: number;
  ready: number;     // !completed && !effectivelyBlocked
  blocked: number;   // !completed && effectivelyBlocked
}

// Task type alias for depth filter
type TaskType = "milestone" | "task" | "subtask";
```

## Learning Interface

```typescript
interface Learning {
  id: string;
  taskId: string;
  content: string;
  sourceTaskId: string | null;
  createdAt: string;
}
```

## Tasks API

```typescript
declare const tasks: {
  list(filter?: { 
    parentId?: string; 
    ready?: boolean; 
    completed?: boolean;
    depth?: 0 | 1 | 2;    // 0=milestones, 1=tasks, 2=subtasks
    type?: TaskType;      // Alias: "milestone"|"task"|"subtask" (mutually exclusive with depth)
    archived?: boolean;   // Include archived tasks (default: false)
  }): Promise<Task[]>;
  get(id: string): Promise<TaskWithContext>;
  create(input: {
    description: string;
    context?: string;
    parentId?: string;
    priority?: 0 | 1 | 2;  // p0=highest, p1=default, p2=lowest
    blockedBy?: string[];
  }): Promise<Task>;
  update(id: string, input: {
    description?: string;
    context?: string;
    priority?: 0 | 1 | 2;
    parentId?: string;
  }): Promise<Task>;
  start(id: string): Promise<Task>;
  complete(id: string, input?: { result?: string; learnings?: string[] }): Promise<Task>;
  reopen(id: string): Promise<Task>;
  cancel(id: string): Promise<Task>;    // Cancel task (does NOT satisfy blockers)
  archive(id: string): Promise<Task>;   // Archive completed/cancelled task
  delete(id: string): Promise<void>;
  block(taskId: string, blockerId: string): Promise<void>;
  unblock(taskId: string, blockerId: string): Promise<void>;
  nextReady(milestoneId?: string): Promise<TaskWithContext | null>;
  tree(rootId?: string): Promise<TaskTree | TaskTree[]>;
  search(query: string): Promise<Task[]>;
  progress(rootId?: string): Promise<TaskProgress>;
};
```

| Method | Returns | Description |
|--------|---------|-------------|
| `list` | `Task[]` | Filter by `parentId`, `ready`, `completed`, `depth`, `type` |
| `get` | `TaskWithContext` | Get task with full context chain + inherited learnings |
| `create` | `Task` | Create task (priority must be 0-2) |
| `update` | `Task` | Update description, context, priority, parentId |
| `start` | `Task` | **VCS required** - creates bookmark, records start commit |
| `complete` | `Task` | **VCS required** - commits changes + bubbles learnings to parent |
| `reopen` | `Task` | Reopen completed task |
| `cancel` | `Task` | Cancel task (does NOT satisfy blockers) |
| `archive` | `Task` | Archive completed/cancelled task (hides from list) |
| `delete` | `void` | Delete task + best-effort VCS bookmark cleanup |
| `block` | `void` | Add blocker (cannot be self, ancestor, or descendant) |
| `unblock` | `void` | Remove blocker relationship |
| `nextReady` | `TaskWithContext \| null` | Get deepest ready leaf with full context |
| `tree` | `TaskTree \| TaskTree[]` | Get task tree (all milestones if no ID) |
| `search` | `Task[]` | Search by description/context/result (case-insensitive) |
| `progress` | `TaskProgress` | Aggregate counts for milestone or all tasks |

## Learnings API

Learnings are added via `tasks.complete(id, { learnings: [...] })` and bubble to immediate parent (preserving `sourceTaskId`).

```typescript
declare const learnings: {
  list(taskId: string): Promise<Learning[]>;
};
```

| Method | Description |
|--------|-------------|
| `list` | List learnings for task |

## Task Lifecycle States

| State | Meaning | Satisfies Blockers? |
|-------|---------|---------------------|
| Pending | Not started | No |
| InProgress | Started, not finished | No |
| Completed | Successfully finished | **Yes** |
| Cancelled | Abandoned/superseded | **No** |
| Archived | Hidden from views | Per underlying state |

**Key semantics:**
- Cancelled tasks **don't satisfy blockers** (unlike completed)
- Archive requires task finished (completed OR cancelled) first
- Archived is a visibility filter, not a workflow state

## VCS Integration (Required for Workflow)

VCS operations are **automatically handled** by the tasks API:

| Task Operation | VCS Effect |
|----------------|------------|
| `tasks.start(id)` | **VCS required** - creates bookmark `task/<id>`, records start commit |
| `tasks.complete(id)` | **VCS required** - commits changes (NothingToCommit = success) |
| `tasks.delete(id)` | Best-effort bookmark cleanup (logs warning on failure) |

**VCS (jj or git) is required** for start/complete. Fails with `NotARepository` if none found. CRUD operations work without VCS.

## Quick Examples

```javascript
// Create milestone with subtask
const milestone = await tasks.create({
  description: "Build authentication system",
  context: "JWT-based auth with refresh tokens",
  priority: 1
});

const subtask = await tasks.create({
  description: "Implement token refresh logic",
  parentId: milestone.id,
  context: "Handle 7-day expiry"
});

// Start work (auto-creates VCS bookmark)
await tasks.start(subtask.id);

// ... do implementation work ...

// Complete task with learnings (VCS required - commits changes, bubbles learnings to parent)
await tasks.complete(subtask.id, {
  result: "Implemented using jose library",
  learnings: ["Use jose instead of jsonwebtoken"]
});

// Get progress summary
const progress = await tasks.progress(milestone.id);
// -> { total: 2, completed: 1, ready: 1, blocked: 0 }

// Search tasks
const authTasks = await tasks.search("authentication");

// Get task tree
const tree = await tasks.tree(milestone.id);
// -> { task: Task, children: TaskTree[] }
```
