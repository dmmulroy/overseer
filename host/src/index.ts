#!/usr/bin/env node
/**
 * Overseer Host - Unified entry point for MCP and UI servers
 * 
 * Usage:
 *   overseer-host mcp --cli-path /path/to/os --cwd /path/to/repo
 *   overseer-host ui --cli-path /path/to/os --cwd /path/to/repo --static-root /path/to/dist --host 127.0.0.1 --port 6969
 */
import { configureCli } from "./cli.js";
import { startMcpServer } from "./mcp.js";
import { startUiServer } from "./ui.js";

interface Args {
  mode: "mcp" | "ui";
  cliPath: string;
  cwd: string;
  // UI-specific
  staticRoot?: string;
  host?: string;
  port?: number;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2); // Skip node and script
  
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const mode = args[0];
  if (mode !== "mcp" && mode !== "ui") {
    console.error(`Unknown mode: ${mode}`);
    printUsage();
    process.exit(1);
  }

  const result: Args = {
    mode,
    cliPath: "os",
    cwd: process.cwd(),
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--cli-path":
        if (!next) {
          console.error("--cli-path requires a value");
          process.exit(1);
        }
        result.cliPath = next;
        i++;
        break;
      case "--cwd":
        if (!next) {
          console.error("--cwd requires a value");
          process.exit(1);
        }
        result.cwd = next;
        i++;
        break;
      case "--static-root":
        if (!next) {
          console.error("--static-root requires a value");
          process.exit(1);
        }
        result.staticRoot = next;
        i++;
        break;
      case "--host":
        if (!next) {
          console.error("--host requires a value");
          process.exit(1);
        }
        result.host = next;
        i++;
        break;
      case "--port":
        if (!next) {
          console.error("--port requires a value");
          process.exit(1);
        }
        result.port = parseInt(next, 10);
        if (isNaN(result.port)) {
          console.error(`Invalid port: ${next}`);
          process.exit(1);
        }
        i++;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  // Validate UI-specific args
  if (mode === "ui") {
    if (!result.staticRoot) {
      console.error("UI mode requires --static-root");
      process.exit(1);
    }
    if (!result.port) {
      result.port = 6969;
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`
Overseer Host - Unified MCP and UI server

Usage:
  overseer-host <mode> [options]

Modes:
  mcp    Start MCP server (stdio)
  ui     Start UI server (HTTP)

Options:
  --cli-path <path>      Path to os binary (default: "os" in PATH)
  --cwd <path>           Working directory for CLI commands (default: current dir)

UI-specific options:
  --static-root <path>   Path to static files (required for UI mode)
  --host <address>       Host to bind to (default: 127.0.0.1)
  --port <number>        HTTP port (default: 6969)

Examples:
  overseer-host mcp --cli-path /usr/local/bin/os --cwd /home/user/project
  overseer-host ui --cli-path ./os --cwd . --static-root ./dist --host 0.0.0.0 --port 8080
`.trim());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Configure CLI bridge
  configureCli({
    cliPath: args.cliPath,
    cwd: args.cwd,
  });

  if (args.mode === "mcp") {
    await startMcpServer();
  } else {
    await startUiServer({
      host: args.host ?? "127.0.0.1",
      port: args.port ?? 6969,
      staticRoot: args.staticRoot ?? "./dist",
    });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
