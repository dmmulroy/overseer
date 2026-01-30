/**
 * MCP Server - registers execute tool with type definitions
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execute, ExecutionError } from "./executor.js";
import { CliError, CliTimeoutError } from "./types.js";

const TOOL_DESCRIPTION = `
Execute JavaScript code to interact with Overseer task management.

Available APIs in sandbox:

\`\`\`typescript
interface Task {
  id: string;
  parentId: string | null;
  description: string;
  context: { own: string; parent?: string; milestone?: string };
  learnings: { milestone: Learning[]; parent: Learning[] };
  priority: 1 | 2 | 3 | 4 | 5;
  completed: boolean;
  depth: 0 | 1 | 2;
  blockedBy: string[];
  blocks: string[];
}

interface Learning {
  id: string;
  taskId: string;
  content: string;
  sourceTaskId: string | null;
  createdAt: string;
}

// Tasks API
// Note: VCS (jj or git) is REQUIRED for start/complete. CRUD ops work without VCS.
declare const tasks: {
  list(filter?: { parentId?: string; ready?: boolean; completed?: boolean }): Promise<Task[]>;
  get(id: string): Promise<Task>;
  create(input: {
    description: string;
    context?: string;
    parentId?: string;
    priority?: 1 | 2 | 3 | 4 | 5;
    blockedBy?: string[];
  }): Promise<Task>;
  update(id: string, input: {
    description?: string;
    context?: string;
    priority?: 1 | 2 | 3 | 4 | 5;
    parentId?: string;
  }): Promise<Task>;
  start(id: string): Promise<Task>;  // VCS required: creates bookmark, records start commit
  complete(id: string, result?: string): Promise<Task>;  // VCS required: commits changes (NothingToCommit = success)
  reopen(id: string): Promise<Task>;
  delete(id: string): Promise<void>;  // Best-effort VCS bookmark cleanup
  block(taskId: string, blockerId: string): Promise<void>;
  unblock(taskId: string, blockerId: string): Promise<void>;
  nextReady(milestoneId?: string): Promise<Task | null>;
};

// Learnings API (learnings are added via tasks.complete)
declare const learnings: {
  list(taskId: string): Promise<Learning[]>;
};
\`\`\`

**VCS Requirement:** \`start\` and \`complete\` require jj or git. Fails with NotARepository error if none found. CRUD operations work without VCS.

Examples:

\`\`\`javascript
// List all ready tasks
return await tasks.list({ ready: true });

// Create milestone with subtask
const milestone = await tasks.create({
  description: "Build authentication system",
  context: "JWT-based auth with refresh tokens",
  priority: 1
});

const subtask = await tasks.create({
  description: "Implement token refresh logic",
  parentId: milestone.id,
  context: "Handle 7-day expiry",
  priority: 2
});

// Start working on task (VCS required - creates bookmark)
await tasks.start(subtask.id);

// Get task with full context
const task = await tasks.get(subtask.id);
console.log(task.context.milestone); // inherited from root

// Complete task (VCS required - commits changes)
await tasks.complete(task.id, "Implemented using jose library");
\`\`\`
`.trim();

/**
 * Create and configure MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: "overseer-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "execute",
        description: TOOL_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript code to execute (async/await supported)",
            },
          },
          required: ["code"],
        },
      },
    ],
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "execute") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const code = request.params.arguments?.code;
    if (typeof code !== "string") {
      throw new Error("Missing or invalid 'code' argument");
    }

    try {
      const result = await execute(code);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      let errorMessage: string;
      if (err instanceof ExecutionError) {
        errorMessage = `Execution error: ${err.message}${err.stackTrace ? `\n${err.stackTrace}` : ""}`;
      } else if (err instanceof CliTimeoutError) {
        errorMessage = `CLI timeout: ${err.message}`;
      } else if (err instanceof CliError) {
        errorMessage = `CLI error (exit ${err.exitCode}): ${err.message}`;
      } else if (err instanceof Error) {
        errorMessage = `Error: ${err.message}`;
      } else {
        errorMessage = `Unknown error: ${String(err)}`;
      }

      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start MCP server with stdio transport
 */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Overseer MCP server running on stdio");
}
