# Overseer

Task orchestration for AI agents via MCP. SQLite-backed, native VCS (jj-lib + gix).

## Install

### Via npm

```bash
npm install -g @dmmulroy/overseer
```

### Via skills.sh (for agents)

```bash
npx skills add dmmulroy/overseer
```

## Usage

### MCP Server

Add to your MCP client config:

```json
{
  "mcpServers": {
    "overseer": {
      "command": "npx",
      "args": ["@dmmulroy/overseer", "mcp"]
    }
  }
}
```

### CLI

```bash
os task create -d "Implement auth"
os task list --ready
os task start <task-id>
os task complete <task-id>
```

## Architecture

```
┌─────────────────────────────────────┐
│     Overseer MCP (Node.js)          │
│  - Single "execute" tool (codemode) │
│  - VM sandbox with tasks/learnings  │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         os CLI (Rust)               │
│  - SQLite storage                   │
│  - jj-lib (primary VCS)             │
│  - gix (git fallback)               │
└─────────────────────────────────────┘
```

## Codemode Pattern

Single `execute` tool - agents write JS, server runs it:

```javascript
const milestone = await tasks.create({
  description: "User auth system",
  context: "JWT + refresh tokens"
});

const login = await tasks.create({
  description: "Login endpoint",
  parentId: milestone.id
});

await tasks.start(login.id);  // VCS required: creates bookmark, records start commit
// ... do work ...
await tasks.complete(login.id, {  // VCS required: commits changes, bubbles learnings to parent
  result: "Implemented with bcrypt",
  learnings: ["bcrypt rounds should be 12+ for production"]
});

return { milestone, login };
```

## Task Hierarchy

- **Milestone** (depth 0) - Root, no parent
- **Task** (depth 1) - Parent is milestone
- **Subtask** (depth 2) - Max depth, parent is task

## APIs

### tasks

```javascript
tasks.create({ description, context?, parentId?, priority?, blockedBy? })
tasks.get(id)           // Returns TaskWithContext
tasks.list({ parentId?, ready?, completed? })
tasks.update(id, { description?, context?, priority? })
tasks.start(id)
tasks.complete(id, { result?, learnings? })  // Learnings bubble to immediate parent
tasks.reopen(id)
tasks.delete(id)
tasks.block(taskId, blockerId)
tasks.unblock(taskId, blockerId)
tasks.nextReady(milestoneId?)
```

### learnings

```javascript
learnings.list(taskId)  // Learnings are added via tasks.complete()
```

### VCS (Required for Workflow)

VCS operations are integrated into task workflow - no direct API:

| Operation | VCS Effect |
|-----------|-----------|
| `tasks.start(id)` | **VCS required** - creates bookmark `task/<id>`, records start commit |
| `tasks.complete(id)` | **VCS required** - commits changes, deletes bookmark (best-effort) |
| `tasks.complete(milestone)` | Also cleans ALL descendant bookmarks (depth-1 and depth-2) |
| `tasks.delete(id)` | Best-effort bookmark cleanup (works without VCS) |

VCS (jj or git) is **required** for start/complete. CRUD operations work without VCS.

## Progressive Context

Tasks inherit context from ancestors. Learnings bubble to immediate parent on completion (preserving original `sourceTaskId`):

```javascript
const subtask = await tasks.get(subtaskId);
// subtask.context.own       - This task's context
// subtask.context.parent    - Parent task context (depth > 0)
// subtask.context.milestone - Root milestone context (depth > 1)
// subtask.learnings.own     - This task's learnings (added when completing children)
```

## CLI Reference

```bash
# Tasks
os task create -d "description" [--context "..."] [--parent ID] [--priority 1-5]
os task get <id>
os task list [--parent ID] [--ready] [--completed]
os task update <id> [-d "..."] [--context "..."] [--priority N]
os task start <id>
os task complete <id> [--result "..."] [--learning "..."]...
os task reopen <id>
os task delete <id>
os task block <id> --by <blocker-id>
os task unblock <id> --by <blocker-id>
os task next-ready [--milestone ID]
os task tree [ID]
os task search "query"

# Learnings (added via task complete --learning)
os learning list <task-id>

# VCS (CLI only - automatic in MCP)
os vcs detect
os vcs status
os vcs log [--limit N]
os vcs diff [BASE_REV]
os vcs commit -m "message"

# Data
os data export [-o file.json]
os data import <file.json> [--clear]
```

## Task Viewer (Dev Only)

Web UI for viewing tasks. Requires cloning the repo:

```bash
cd ui && npm install && npm run dev
# Opens http://localhost:5173
```

Three views:
- **Graph** - DAG visualization with blocking relationships
- **List** - Filterable task list
- **Kanban** - Board by completion status

Keyboard: `g`=graph, `l`=list, `k`=kanban, `?`=help

## Development

```bash
# Rust CLI
cd overseer && cargo build --release
cd overseer && cargo test

# Node MCP
cd mcp && npm install
cd mcp && npm run build
cd mcp && npm test

# UI (dev server)
cd ui && npm install && npm run dev
```

## Storage

SQLite database at `$CWD/.overseer/tasks.db`. Auto-created on first command.

## VCS Detection

1. Walk up from cwd looking for `.jj/` → use jj-lib
2. If not found, look for `.git/` → use gix
3. Neither → VcsType::None

jj-first: always prefer jj when available.

## Docs

- [Architecture](docs/ARCHITECTURE.md) - System design, invariants
- [CLI Reference](docs/CLI.md) - Full command documentation
- [MCP Guide](docs/MCP.md) - Agent usage patterns

## License

MIT
