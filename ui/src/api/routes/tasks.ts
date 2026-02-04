/**
 * Task API routes
 */
import { Hono, type Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { callCli } from "../cli.js";
import {
  decodeTask,
  decodeTasks,
  decodeTaskWithContext,
  decodeTaskWithContextOrNull,
  decodeLearnings,
  decodeUpdateTaskRequest,
  decodeCompleteTaskRequest,
  decodeCreateTaskRequest,
} from "../../decoder.js";
import { CliError, isTaskId, type ApiError } from "../../types.js";

/**
 * Handle CLI errors and return appropriate HTTP status
 */
function handleCliError(
  c: Context,
  err: unknown
): Response & { _data: ApiError; _status: StatusCode } {
  if (err instanceof CliError) {
    // Map common error messages to status codes
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
    // Default to 500 for unknown CLI errors
    return c.json({ error: err.message }, 500);
  }
  // Unknown error
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
}

const tasks = new Hono()
  /**
   * GET /api/tasks
   * List all tasks with optional filters
   * Query params: parentId, ready, completed
   */
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

  /**
   * POST /api/tasks
   * Create a new task
   * Body: { description: string, context?: string, parentId?: TaskId, priority?: Priority }
   */
  .post("/", async (c) => {
    let body;
    try {
      body = decodeCreateTaskRequest(await c.req.json()).unwrap(
        "POST /api/tasks body"
      );
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const args = ["task", "create", "-d", body.description];
    if (body.context) args.push("--context", body.context);
    if (body.parentId) args.push("--parent", body.parentId);
    if (body.priority !== undefined) args.push("--priority", String(body.priority));

    try {
      const result = decodeTask(await callCli(args)).unwrap("POST /api/tasks");
      return c.json(result, 201);
    } catch (err) {
      return handleCliError(c, err);
    }
  })

  /**
   * GET /api/tasks/next-ready
   * Get next ready task (deepest unblocked incomplete leaf)
   * Query params: milestoneId
   */
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

  /**
   * GET /api/tasks/:id
   * Get single task with full context chain and inherited learnings
   */
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

  /**
   * PUT /api/tasks/:id
   * Update existing task
   */
  .put("/:id", async (c) => {
    const id = c.req.param("id");
    if (!isTaskId(id)) {
      return c.json({ error: `Invalid task ID: ${id}` }, 400);
    }

    let body;
    try {
      body = decodeUpdateTaskRequest(await c.req.json()).unwrap(
        "PUT /api/tasks/:id body"
      );
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const args = ["task", "update", id];
    if (body.description) args.push("-d", body.description);
    if (body.context) args.push("--context", body.context);
    if (body.priority !== undefined) args.push("--priority", String(body.priority));

    // Must have at least one field to update
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

  /**
   * DELETE /api/tasks/:id
   * Delete task (cascades to children and learnings)
   */
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

  /**
   * POST /api/tasks/:id/complete
   * Complete task with optional result and learnings
   */
  .post("/:id/complete", async (c) => {
    const id = c.req.param("id");
    if (!isTaskId(id)) {
      return c.json({ error: `Invalid task ID: ${id}` }, 400);
    }

    let body;
    try {
      const text = await c.req.text();
      if (text) {
        body = decodeCompleteTaskRequest(JSON.parse(text)).unwrap(
          "POST /api/tasks/:id/complete body"
        );
      } else {
        body = {};
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

  /**
   * POST /api/tasks/:id/reopen
   * Reopen a completed task
   */
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

  /**
   * GET /api/tasks/:taskId/learnings
   * List all learnings for a task
   * Includes learnings bubbled from completed child tasks
   */
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

export { tasks };
