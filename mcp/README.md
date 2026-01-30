# Overseer MCP Server

MCP server for Overseer task orchestration using the codemode pattern.

## Architecture

- **Single `execute` tool** - agents write JavaScript, server executes
- **VM sandbox** - isolated execution with exposed APIs (tasks, learnings)
- **CLI bridge** - spawns `os` binary, parses JSON output
- **Type-safe** - full TypeScript types for all APIs

## Installation

```bash
npm install
npm run build
```

## Usage

The server runs on stdio and exposes a single `execute` tool:

```javascript
// List ready tasks
return await tasks.list({ ready: true });

// Create milestone → task → subtask
const milestone = await tasks.create({
  description: "Build auth system",
  context: "JWT-based with refresh tokens",
  priority: 1
});

const task = await tasks.create({
  description: "Implement token refresh",
  parentId: milestone.id,
  priority: 2
});

// Get task with progressive context
const full = await tasks.get(task.id);
console.log(full.context); // { own, parent, milestone }
console.log(full.learnings); // { own: [...] }

// Complete with result and learnings (learnings bubble to immediate parent)
await tasks.complete(task.id, {
  result: "Used jose library",
  learnings: ["jose > jsonwebtoken for JOSE ops"]
});
```

## APIs

### tasks

- `list(filter?)` - List tasks
- `get(id)` - Get task with context + learnings
- `create(input)` - Create task
- `update(id, input)` - Update task
- `start(id)` - Mark started
- `complete(id, { result?, learnings? })` - Mark complete, learnings bubble to parent
- `reopen(id)` - Reopen
- `delete(id)` - Delete (cascades)
- `block(taskId, blockerId)` - Add blocker
- `unblock(taskId, blockerId)` - Remove blocker
- `nextReady(milestoneId?)` - Get next ready task

### learnings

- `list(taskId)` - List learnings for task (learnings are added via `tasks.complete`)

### VCS Integration (Automatic)

VCS operations are integrated into task lifecycle - no direct VCS API exposed:

| Task Operation | VCS Effect |
|----------------|------------|
| `tasks.start(id)` | **VCS required** - creates bookmark, records start commit |
| `tasks.complete(id)` | **VCS required** - commits changes (NothingToCommit = success) |
| `tasks.delete(id)` | Best-effort bookmark cleanup |

**Note:** VCS (jj or git) is required for start/complete. CRUD operations work without VCS.

## MCP Configuration

Add to your MCP settings:

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

For development, use the local build:

```json
{
  "mcpServers": {
    "overseer": {
      "command": "node",
      "args": ["/path/to/overseer/mcp/build/index.js"]
    }
  }
}
```

## Development

```bash
npm run watch    # Watch mode
npm run build    # Build once
```

## Design

Inspired by [opensrc-mcp](https://github.com/dmmulroy/opensrc-mcp) codemode pattern:

- Agents write JS → better API ergonomics than raw tool calls
- Server executes → only results return (reduces token usage)
- VM sandbox → isolation + timeout protection
- CLI bridge → delegates to battle-tested Rust core
