/**
 * VM sandbox executor - runs agent code with exposed APIs
 */
import vm from "node:vm";
import { tasks } from "./api/tasks.js";
import { learnings } from "./api/learnings.js";

const MAX_OUTPUT_SIZE = 50_000; // chars

/**
 * Execute agent-provided code in VM sandbox
 */
export async function execute(code: string): Promise<unknown> {
  // Track timers to prevent resource leaks
  const timers = new Set<NodeJS.Timeout>();
  const MAX_TIMERS = 100;

  // Create sandbox context with exposed APIs
  // Note: VCS operations are now integrated into task start/complete, not exposed directly
  const sandbox = {
    tasks,
    learnings,
    console: {
      log: (...args: unknown[]) => console.log("[sandbox]", ...args),
      error: (...args: unknown[]) => console.error("[sandbox]", ...args),
    },
    // Wrap setTimeout to track and limit timers
    setTimeout: (handler: () => void, timeout?: number) => {
      if (timers.size >= MAX_TIMERS) {
        throw new Error(`Timer limit exceeded (max ${MAX_TIMERS})`);
      }
      const id = setTimeout(() => {
        timers.delete(id);
        handler();
      }, timeout);
      timers.add(id);
      return id;
    },
    // Wrap setInterval to track and limit timers
    setInterval: (handler: () => void, timeout?: number) => {
      if (timers.size >= MAX_TIMERS) {
        throw new Error(`Timer limit exceeded (max ${MAX_TIMERS})`);
      }
      const id = setInterval(handler, timeout);
      timers.add(id);
      return id;
    },
    clearTimeout: (id: NodeJS.Timeout) => {
      timers.delete(id);
      clearTimeout(id);
    },
    clearInterval: (id: NodeJS.Timeout) => {
      timers.delete(id);
      clearInterval(id);
    },
    Promise,
  };

  // Wrap code in async IIFE to handle await
  const wrappedCode = `
    (async () => {
      ${code}
    })()
  `;

  try {
    const script = new vm.Script(wrappedCode, {
      filename: "agent-code.js",
    });

    const context = vm.createContext(sandbox);
    const result = await script.runInContext(context, {
      timeout: 30_000, // 30s max execution
    });

    return truncateOutput(result);
  } catch (err) {
    if (err instanceof Error) {
      throw new ExecutionError(err.message, err.stack);
    }
    throw new ExecutionError(String(err));
  } finally {
    // Clean up any remaining timers to prevent resource leaks
    timers.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    timers.clear();
  }
}

/**
 * Truncate large outputs to prevent response overflow
 */
function truncateOutput(result: unknown): unknown {
  // Handle undefined explicitly (JSON.stringify returns undefined for undefined)
  if (result === undefined) {
    return undefined;
  }

  const json = JSON.stringify(result, null, 2);
  if (json.length <= MAX_OUTPUT_SIZE) {
    return result;
  }

  return {
    _truncated: true,
    size: json.length,
    preview: json.slice(0, MAX_OUTPUT_SIZE),
    message: `Output truncated (${json.length} chars, showing first ${MAX_OUTPUT_SIZE})`,
  };
}

/**
 * Execution error wrapper
 */
export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly stackTrace?: string
  ) {
    super(message);
    this.name = "ExecutionError";
  }
}
