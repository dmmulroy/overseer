/**
 * Tasks API - typed wrapper around os task commands
 */
import { callCli } from "../cli.js";
import {
  decodeTask,
  decodeTasks,
  decodeTaskWithContext,
  decodeTaskWithContextOrNull,
} from "../decoder.js";
import type { Depth, Task, TaskWithContext } from "../types.js";

export interface TaskFilter {
  parentId?: string;
  ready?: boolean;
  completed?: boolean;
  /**
   * Filter by depth: 0=milestones, 1=tasks, 2=subtasks.
   * Maps to CLI: --milestones | --tasks | --subtasks
   * Mutually exclusive with parentId.
   */
  depth?: Depth;
}

export interface CreateTaskInput {
  description: string;
  context?: string;
  parentId?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  blockedBy?: string[];
}

export interface UpdateTaskInput {
  description?: string;
  context?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  parentId?: string;
}

/**
 * Tasks API exposed to VM sandbox
 */
export const tasks = {
  /**
   * List tasks with optional filters.
   * Returns tasks without context chain or inherited learnings.
   */
  async list(filter?: TaskFilter): Promise<Task[]> {
    if (filter?.parentId !== undefined && filter?.depth !== undefined) {
      throw new Error(
        "parentId and depth are mutually exclusive - use parentId alone; depth is implied by parent type"
      );
    }
    const args = ["task", "list"];
    if (filter?.parentId) args.push("--parent", filter.parentId);
    if (filter?.ready) args.push("--ready");
    if (filter?.completed) args.push("--completed");
    if (filter?.depth !== undefined) {
      const depthFlags: Record<Depth, string> = {
        0: "--milestones",
        1: "--tasks",
        2: "--subtasks",
      };
      args.push(depthFlags[filter.depth]);
    }
    return decodeTasks(await callCli(args)).unwrap("tasks.list");
  },

  /**
   * Get single task with full context chain and inherited learnings.
   */
  async get(id: string): Promise<TaskWithContext> {
    return decodeTaskWithContext(await callCli(["task", "get", id])).unwrap("tasks.get");
  },

  /**
   * Create new task.
   * Returns task without context chain or inherited learnings.
   */
  async create(input: CreateTaskInput): Promise<Task> {
    const args = ["task", "create", "-d", input.description];
    if (input.context) args.push("--context", input.context);
    if (input.parentId) args.push("--parent", input.parentId);
    if (input.priority) args.push("--priority", String(input.priority));
    if (input.blockedBy && input.blockedBy.length > 0) {
      args.push("--blocked-by", input.blockedBy.join(","));
    }
    return decodeTask(await callCli(args)).unwrap("tasks.create");
  },

  /**
   * Update existing task.
   * Returns task without context chain or inherited learnings.
   */
  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const args = ["task", "update", id];
    if (input.description) args.push("-d", input.description);
    if (input.context) args.push("--context", input.context);
    if (input.priority) args.push("--priority", String(input.priority));
    if (input.parentId) args.push("--parent", input.parentId);
    return decodeTask(await callCli(args)).unwrap("tasks.update");
  },

  /**
   * Mark task as started.
   * Follows blockers to find startable work, cascades to deepest leaf.
   * Creates VCS bookmark for started task and records start commit.
   * Returns the task that was actually started.
   *
   * **Requires VCS**: Must be in a jj or git repository.
   */
  async start(id: string): Promise<Task> {
    return decodeTask(await callCli(["task", "start", id])).unwrap("tasks.start");
  },

  /**
   * Complete task with optional result and learnings.
   * Learnings are attached to the task and bubbled to immediate parent.
   * Auto-bubbles up if all siblings done and parent unblocked.
   * Commits changes and captures commit SHA.
   *
   * **Requires VCS**: Must be in a jj or git repository.
   */
  async complete(
    id: string,
    options?: { result?: string; learnings?: string[] }
  ): Promise<Task> {
    const args = ["task", "complete", id];
    if (options?.result) args.push("--result", options.result);
    if (options?.learnings) {
      for (const learning of options.learnings) {
        args.push("--learning", learning);
      }
    }
    return decodeTask(await callCli(args)).unwrap("tasks.complete");
  },

  /**
   * Reopen completed task.
   */
  async reopen(id: string): Promise<Task> {
    return decodeTask(await callCli(["task", "reopen", id])).unwrap("tasks.reopen");
  },

  /**
   * Delete task (cascades to children and learnings).
   */
  async delete(id: string): Promise<void> {
    await callCli(["task", "delete", id]);
  },

  /**
   * Add blocker relationship.
   * Validates: no self-blocks, no ancestor/descendant blocks, no cycles.
   */
  async block(taskId: string, blockerId: string): Promise<void> {
    await callCli(["task", "block", taskId, "--by", blockerId]);
  },

  /**
   * Remove blocker relationship.
   */
  async unblock(taskId: string, blockerId: string): Promise<void> {
    await callCli(["task", "unblock", taskId, "--by", blockerId]);
  },

  /**
   * Get next ready task (DFS to find deepest unblocked incomplete leaf).
   * Returns task with full context chain and inherited learnings, or null if no ready tasks.
   */
  async nextReady(milestoneId?: string): Promise<TaskWithContext | null> {
    const args = ["task", "next-ready"];
    if (milestoneId) args.push("--milestone", milestoneId);
    return decodeTaskWithContextOrNull(await callCli(args)).unwrap("tasks.nextReady");
  },
};
