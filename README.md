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

await tasks.start(login.id);  // Creates VCS bookmark automatically
// ... do work ...
await tasks.complete(login.id, "Implemented with bcrypt");  // Squashes commits

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
tasks.complete(id, result?)
tasks.reopen(id)
tasks.delete(id)
tasks.block(taskId, blockerId)
tasks.unblock(taskId, blockerId)
tasks.nextReady(milestoneId?)
```

### learnings

```javascript
learnings.add(taskId, content, sourceTaskId?)
learnings.list(taskId)
learnings.delete(id)
```

### VCS (Automatic)

VCS operations are integrated into task workflow - no direct API:

| Operation | VCS Effect |
|-----------|-----------|
| `tasks.start(id)` | Creates bookmark `task/<id>`, records start commit |
| `tasks.complete(id)` | Squashes commits since start, rebases onto parent |
| `tasks.delete(id)` | Deletes VCS bookmark |

VCS is best-effort - failures never block task state transitions.

## Progressive Context

Tasks inherit context + learnings from ancestors:

```javascript
const subtask = await tasks.get(subtaskId);
// subtask.context.own       - This task's context
// subtask.context.parent    - Parent task context (depth > 0)
// subtask.context.milestone - Root milestone context (depth > 1)
// subtask.learnings.parent  - Parent's learnings
// subtask.learnings.milestone - Milestone's learnings
```

## CLI Reference

```bash
# Tasks
os task create -d "description" [--context "..."] [--parent ID] [--priority 1-5]
os task get <id>
os task list [--parent ID] [--ready] [--completed]
os task update <id> [-d "..."] [--context "..."] [--priority N]
os task start <id>
os task complete <id> [--result "..."]
os task reopen <id>
os task delete <id>
os task block <id> --by <blocker-id>
os task unblock <id> --by <blocker-id>
os task next-ready [--milestone ID]
os task tree [ID]
os task search "query"

# Learnings
os learning add <task-id> "content" [--source <task-id>]
os learning list <task-id>
os learning delete <id>

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

## Development

```bash
# Rust CLI
cd overseer && cargo build --release
cd overseer && cargo test

# Node MCP
cd mcp && npm install
cd mcp && npm run build
cd mcp && npm test
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
