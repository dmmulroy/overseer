# Overseer MCP Server

MCP server for Overseer task orchestration using the codemode pattern.

## Architecture

- **Single `execute` tool** - agents write JavaScript, server executes
- **VM sandbox** - isolated execution with exposed APIs (tasks, learnings, vcs)
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
console.log(full.learnings); // { milestone: [...], parent: [...] }

// Complete and record learning
await tasks.complete(task.id, "Used jose library");
await learnings.add(task.id, "jose > jsonwebtoken for JOSE ops");

// Commit via VCS
await vcs.commit("feat: token refresh logic");
```

## APIs

### tasks

- `list(filter?)` - List tasks
- `get(id)` - Get task with context + learnings
- `create(input)` - Create task
- `update(id, input)` - Update task
- `start(id)` - Mark started
- `complete(id, result?)` - Mark complete
- `reopen(id)` - Reopen
- `delete(id)` - Delete (cascades)
- `block(taskId, blockerId)` - Add blocker
- `unblock(taskId, blockerId)` - Remove blocker
- `nextReady(milestoneId?)` - Get next ready task

### learnings

- `add(taskId, content, sourceTaskId?)` - Add learning
- `list(taskId)` - List learnings
- `delete(id)` - Delete learning

### vcs

- `detect()` - Detect VCS type (jj/git/none)
- `status()` - Get working copy status
- `log(limit?)` - Get commit history
- `diff(base?)` - Get diff
- `commit(message)` - Create commit

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
