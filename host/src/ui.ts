/**
 * UI Server - Hono HTTP server for Task Viewer
 */
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { StatusCode } from "hono/utils/http-status";
import { callCli } from "./cli.js";
import {
  decodeTask,
  decodeTasks,
  decodeTaskWithContext,
  decodeTaskWithContextOrNull,
  decodeLearnings,
} from "./decoder.js";
import { CliError, isTaskId, type Priority } from "./types.js";

// Request body types
interface UpdateTaskRequest {
  description?: string;
  context?: string;
  priority?: Priority;
}

interface CompleteTaskRequest {
  result?: string;
  learnings?: string[];
}

interface ApiError {
  error: string;
  code?: string;
}

/**
 * Handle CLI errors and return appropriate HTTP status
 */
function handleCliError(
  c: Context,
  err: unknown
): Response & { _data: ApiError; _status: StatusCode } {
  if (err instanceof CliError) {
    const message = err.message.toLowerCase();
    if (message.includes("not found") || message.includes("no task")) {
      return c.json({ error: err.message }, 404);
    }
    if (
      message.includes("invalid") ||
      message.includes("validation") ||
      message.includes("cycle")
    ) {
      return c.json({ error: err.message }, 400);
    }
    if (
      message.includes("not a repository") ||
      message.includes("dirty working copy")
    ) {
      return c.json({ error: err.message, code: "VCS_ERROR" }, 400);
    }
    return c.json({ error: err.message }, 500);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
}

// Validation helpers
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

function isPriority(v: unknown): v is Priority {
  return v === 0 || v === 1 || v === 2;
}

/**
 * Create task API routes
 */
function createTaskRoutes() {
  return new Hono()
    .get("/", async (c) => {
      const parentId = c.req.query("parentId");
      const ready = c.req.query("ready");
      const completed = c.req.query("completed");

      const args = ["task", "list"];
      if (parentId) {
        if (!isTaskId(parentId)) {
          return c.json({ error: `Invalid parentId: ${parentId}` }, 400);
        }
        args.push("--parent", parentId);
      }
      if (ready === "true") args.push("--ready");
      if (completed === "true") args.push("--completed");

      try {
        const result = decodeTasks(await callCli(args)).unwrap("GET /api/tasks");
        return c.json(result);
      } catch (err) {
        return handleCliError(c, err);
      }
    })

    .get("/next-ready", async (c) => {
      const milestoneId = c.req.query("milestoneId");

      const args = ["task", "next-ready"];
      if (milestoneId) {
        if (!isTaskId(milestoneId)) {
          return c.json({ error: `Invalid milestoneId: ${milestoneId}` }, 400);
        }
        args.push("--milestone", milestoneId);
      }

      try {
        const result = decodeTaskWithContextOrNull(await callCli(args)).unwrap(
          "GET /api/tasks/next-ready"
        );
        if (result === null) {
          return c.json(null, 200);
        }
        return c.json(result);
      } catch (err) {
        return handleCliError(c, err);
      }
    })

    .get("/:id", async (c) => {
      const id = c.req.param("id");
      if (!isTaskId(id)) {
        return c.json({ error: `Invalid task ID: ${id}` }, 400);
      }

      try {
        const result = decodeTaskWithContext(await callCli(["task", "get", id])).unwrap(
          "GET /api/tasks/:id"
        );
        return c.json(result);
      } catch (err) {
        return handleCliError(c, err);
      }
    })

    .put("/:id", async (c) => {
      const id = c.req.param("id");
      if (!isTaskId(id)) {
        return c.json({ error: `Invalid task ID: ${id}` }, 400);
      }

      let body: UpdateTaskRequest;
      try {
        const raw = await c.req.json();
        if (!isObject(raw)) {
          return c.json({ error: "Invalid JSON body" }, 400);
        }
        body = {};
        if (raw.description !== undefined) {
          if (!isString(raw.description)) {
            return c.json({ error: "description must be string" }, 400);
          }
          body.description = raw.description;
        }
        if (raw.context !== undefined) {
          if (!isString(raw.context)) {
            return c.json({ error: "context must be string" }, 400);
          }
          body.context = raw.context;
        }
        if (raw.priority !== undefined) {
          if (!isPriority(raw.priority)) {
            return c.json({ error: `Invalid priority: ${raw.priority}` }, 400);
          }
          body.priority = raw.priority;
        }
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      const args = ["task", "update", id];
      if (body.description) args.push("-d", body.description);
      if (body.context) args.push("--context", body.context);
      if (body.priority !== undefined) args.push("--priority", String(body.priority));

      if (args.length === 3) {
        return c.json({ error: "No fields to update" }, 400);
      }

      try {
        const result = decodeTask(await callCli(args)).unwrap("PUT /api/tasks/:id");
        return c.json(result);
      } catch (err) {
        return handleCliError(c, err);
      }
    })

    .delete("/:id", async (c) => {
      const id = c.req.param("id");
      if (!isTaskId(id)) {
        return c.json({ error: `Invalid task ID: ${id}` }, 400);
      }

      try {
        await callCli(["task", "delete", id]);
        return c.json({ deleted: true });
      } catch (err) {
        return handleCliError(c, err);
      }
    })

    .post("/:id/complete", async (c) => {
      const id = c.req.param("id");
      if (!isTaskId(id)) {
        return c.json({ error: `Invalid task ID: ${id}` }, 400);
      }

      let body: CompleteTaskRequest = {};
      try {
        const text = await c.req.text();
        if (text) {
          const raw = JSON.parse(text);
          if (!isObject(raw)) {
            return c.json({ error: "Invalid JSON body" }, 400);
          }
          if (raw.result !== undefined) {
            if (!isString(raw.result)) {
              return c.json({ error: "result must be string" }, 400);
            }
            body.result = raw.result;
          }
          if (raw.learnings !== undefined) {
            if (!Array.isArray(raw.learnings)) {
              return c.json({ error: "learnings must be array" }, 400);
            }
            for (let i = 0; i < raw.learnings.length; i++) {
              if (!isString(raw.learnings[i])) {
                return c.json({ error: `learnings[${i}] must be string` }, 400);
              }
            }
            body.learnings = raw.learnings as string[];
          }
        }
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      const args = ["task", "complete", id];
      if (body.result) args.push("--result", body.result);
      if (body.learnings) {
        for (const learning of body.learnings) {
          args.push("--learning", learning);
        }
      }

      try {
        const result = decodeTask(await callCli(args)).unwrap("POST /api/tasks/:id/complete");
        return c.json(result);
      } catch (err) {
        return handleCliError(c, err);
      }
    })

    .post("/:id/reopen", async (c) => {
      const id = c.req.param("id");
      if (!isTaskId(id)) {
        return c.json({ error: `Invalid task ID: ${id}` }, 400);
      }

      try {
        const result = decodeTask(await callCli(["task", "reopen", id])).unwrap(
          "POST /api/tasks/:id/reopen"
        );
        return c.json(result);
      } catch (err) {
        return handleCliError(c, err);
      }
    })

    .get("/:taskId/learnings", async (c) => {
      const taskId = c.req.param("taskId");
      if (!isTaskId(taskId)) {
        return c.json({ error: `Invalid task ID: ${taskId}` }, 400);
      }

      try {
        const result = decodeLearnings(await callCli([
          "learning",
          "list",
          taskId,
        ])).unwrap("GET /api/tasks/:taskId/learnings");
        return c.json(result);
      } catch (err) {
        return handleCliError(c, err);
      }
    });
}

export interface UiServerConfig {
  host: string;
  port: number;
  staticRoot: string;
}

/**
 * Create UI app with API routes and static file serving
 */
export function createUiApp(staticRoot: string) {
  const api = new Hono()
    .get("/health", (c) => c.json({ status: "ok" }))
    .route("/api/tasks", createTaskRoutes())
    .all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  return new Hono()
    .route("/", api)
    .use("/*", serveStatic({ root: staticRoot }))
    .get("/*", serveStatic({ root: staticRoot, path: "index.html" }));
}

/**
 * Start UI server
 */
export async function startUiServer(config: UiServerConfig): Promise<void> {
  const app = createUiApp(config.staticRoot);

  serve(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port,
    },
    (info) => {
      console.log(`Overseer UI: http://${config.host}:${info.port}`);
    }
  );
}
