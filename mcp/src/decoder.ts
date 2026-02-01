/**
 * Runtime decoders for CLI JSON output.
 * Validates structure matches expected types at runtime.
 */
import { Result, TaggedError } from "better-result";
import {
  isTaskId,
  isLearningId,
  type Task,
  type TaskWithContext,
  type Learning,
  type TaskId,
  type LearningId,
  type Priority,
  type Depth,
  type TaskContext,
  type InheritedLearnings,
} from "./types.js";

/**
 * Decode error with path context
 */
export class DecodeError extends TaggedError("DecodeError")<{
  message: string;
  path?: string;
}>() {}

// Helper to check if value is a plain object
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Helper to check if value is string
function isString(v: unknown): v is string {
  return typeof v === "string";
}

// Helper to check if value is boolean
function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

// Helper to check if value is number
function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

// Helper to check valid priority
function isPriority(v: unknown): v is Priority {
  return isNumber(v) && v >= 1 && v <= 5 && Number.isInteger(v);
}

// Helper to check valid depth
function isDepth(v: unknown): v is Depth {
  return v === 0 || v === 1 || v === 2;
}

/**
 * Decode a Learning from unknown JSON
 */
export function decodeLearning(v: unknown): Result<Learning, DecodeError> {
  if (!isObject(v)) {
    return Result.err(new DecodeError({ message: "Learning must be object" }));
  }

  const { id, taskId, content, sourceTaskId, createdAt } = v;

  if (!isString(id) || !isLearningId(id)) {
    return Result.err(new DecodeError({ message: `Invalid learning id: ${id}` }));
  }
  if (!isString(taskId) || !isTaskId(taskId)) {
    return Result.err(new DecodeError({ message: `Invalid learning taskId: ${taskId}` }));
  }
  if (!isString(content)) {
    return Result.err(new DecodeError({ message: "Learning content must be string" }));
  }
  if (sourceTaskId !== null && (!isString(sourceTaskId) || !isTaskId(sourceTaskId))) {
    return Result.err(new DecodeError({ message: `Invalid learning sourceTaskId: ${sourceTaskId}` }));
  }
  if (!isString(createdAt)) {
    return Result.err(new DecodeError({ message: "Learning createdAt must be string" }));
  }

  return Result.ok({
    id: id as LearningId,
    taskId: taskId as TaskId,
    content,
    sourceTaskId: sourceTaskId as TaskId | null,
    createdAt,
  });
}

/**
 * Decode a Learning array
 */
export function decodeLearnings(v: unknown): Result<Learning[], DecodeError> {
  if (!Array.isArray(v)) {
    return Result.err(new DecodeError({ message: "Learnings must be array" }));
  }

  const learnings: Learning[] = [];
  for (let i = 0; i < v.length; i++) {
    const result = decodeLearning(v[i]);
    if (result.isErr()) {
      return Result.err(new DecodeError({ 
        message: result.error.message, 
        path: `learnings[${i}]` 
      }));
    }
    learnings.push(result.value);
  }
  return Result.ok(learnings);
}

/**
 * Decode a Task from unknown JSON
 */
export function decodeTask(v: unknown): Result<Task, DecodeError> {
  if (!isObject(v)) {
    return Result.err(new DecodeError({ message: "Task must be object" }));
  }

  const {
    id,
    parentId,
    description,
    priority,
    completed,
    completedAt,
    startedAt,
    createdAt,
    updatedAt,
    result,
    commitSha,
    depth,
    blockedBy,
    blocks,
    bookmark,
    startCommit,
    effectivelyBlocked,
  } = v;

  // Required fields
  if (!isString(id) || !isTaskId(id)) {
    return Result.err(new DecodeError({ message: `Invalid task id: ${id}` }));
  }
  if (parentId !== null && (!isString(parentId) || !isTaskId(parentId))) {
    return Result.err(new DecodeError({ message: `Invalid task parentId: ${parentId}` }));
  }
  if (!isString(description)) {
    return Result.err(new DecodeError({ message: "Task description must be string" }));
  }
  if (!isPriority(priority)) {
    return Result.err(new DecodeError({ message: `Invalid task priority: ${priority}` }));
  }
  if (!isBoolean(completed)) {
    return Result.err(new DecodeError({ message: "Task completed must be boolean" }));
  }
  if (completedAt !== null && !isString(completedAt)) {
    return Result.err(new DecodeError({ message: "Task completedAt must be string or null" }));
  }
  if (startedAt !== null && !isString(startedAt)) {
    return Result.err(new DecodeError({ message: "Task startedAt must be string or null" }));
  }
  if (!isString(createdAt)) {
    return Result.err(new DecodeError({ message: "Task createdAt must be string" }));
  }
  if (!isString(updatedAt)) {
    return Result.err(new DecodeError({ message: "Task updatedAt must be string" }));
  }
  if (result !== null && !isString(result)) {
    return Result.err(new DecodeError({ message: "Task result must be string or null" }));
  }
  if (commitSha !== null && !isString(commitSha)) {
    return Result.err(new DecodeError({ message: "Task commitSha must be string or null" }));
  }
  if (!isDepth(depth)) {
    return Result.err(new DecodeError({ message: `Invalid task depth: ${depth}` }));
  }
  if (!isBoolean(effectivelyBlocked)) {
    return Result.err(new DecodeError({ message: "Task effectivelyBlocked must be boolean" }));
  }

  // Optional array fields
  let decodedBlockedBy: TaskId[] | undefined;
  if (blockedBy !== undefined) {
    if (!Array.isArray(blockedBy)) {
      return Result.err(new DecodeError({ message: "Task blockedBy must be array" }));
    }
    decodedBlockedBy = [];
    for (const bid of blockedBy) {
      if (!isString(bid) || !isTaskId(bid)) {
        return Result.err(new DecodeError({ message: `Invalid blocker id: ${bid}` }));
      }
      decodedBlockedBy.push(bid as TaskId);
    }
  }

  let decodedBlocks: TaskId[] | undefined;
  if (blocks !== undefined) {
    if (!Array.isArray(blocks)) {
      return Result.err(new DecodeError({ message: "Task blocks must be array" }));
    }
    decodedBlocks = [];
    for (const bid of blocks) {
      if (!isString(bid) || !isTaskId(bid)) {
        return Result.err(new DecodeError({ message: `Invalid blocks id: ${bid}` }));
      }
      decodedBlocks.push(bid as TaskId);
    }
  }

  // Optional string fields
  if (bookmark !== undefined && !isString(bookmark)) {
    return Result.err(new DecodeError({ message: "Task bookmark must be string" }));
  }
  if (startCommit !== undefined && !isString(startCommit)) {
    return Result.err(new DecodeError({ message: "Task startCommit must be string" }));
  }

  const task: Task = {
    id: id as TaskId,
    parentId: parentId as TaskId | null,
    description,
    priority: priority as Priority,
    completed,
    completedAt: completedAt as string | null,
    startedAt: startedAt as string | null,
    createdAt,
    updatedAt,
    result: result as string | null,
    commitSha: commitSha as string | null,
    depth: depth as Depth,
    effectivelyBlocked,
  };

  if (decodedBlockedBy) task.blockedBy = decodedBlockedBy;
  if (decodedBlocks) task.blocks = decodedBlocks;
  if (bookmark !== undefined) task.bookmark = bookmark as string;
  if (startCommit !== undefined) task.startCommit = startCommit as string;

  return Result.ok(task);
}

/**
 * Decode a Task array
 */
export function decodeTasks(v: unknown): Result<Task[], DecodeError> {
  if (!Array.isArray(v)) {
    return Result.err(new DecodeError({ message: "Tasks must be array" }));
  }

  const tasks: Task[] = [];
  for (let i = 0; i < v.length; i++) {
    const result = decodeTask(v[i]);
    if (result.isErr()) {
      return Result.err(new DecodeError({ 
        message: result.error.message, 
        path: `tasks[${i}]` 
      }));
    }
    tasks.push(result.value);
  }
  return Result.ok(tasks);
}

/**
 * Decode TaskContext from unknown JSON
 */
function decodeTaskContext(v: unknown): Result<TaskContext, DecodeError> {
  if (!isObject(v)) {
    return Result.err(new DecodeError({ message: "TaskContext must be object" }));
  }

  const { own, parent, milestone } = v;

  if (!isString(own)) {
    return Result.err(new DecodeError({ message: "TaskContext.own must be string" }));
  }
  if (parent !== undefined && !isString(parent)) {
    return Result.err(new DecodeError({ message: "TaskContext.parent must be string" }));
  }
  if (milestone !== undefined && !isString(milestone)) {
    return Result.err(new DecodeError({ message: "TaskContext.milestone must be string" }));
  }

  const ctx: TaskContext = { own };
  if (parent !== undefined) ctx.parent = parent;
  if (milestone !== undefined) ctx.milestone = milestone;
  return Result.ok(ctx);
}

/**
 * Decode InheritedLearnings from unknown JSON
 */
function decodeInheritedLearnings(v: unknown): Result<InheritedLearnings, DecodeError> {
  if (!isObject(v)) {
    return Result.err(new DecodeError({ message: "InheritedLearnings must be object" }));
  }

  const { own, parent, milestone } = v;

  // All fields should be arrays (possibly empty due to skip_serializing_if)
  const ownResult = decodeLearnings(own ?? []);
  if (ownResult.isErr()) {
    return Result.err(new DecodeError({ message: ownResult.error.message, path: "learnings.own" }));
  }

  const parentResult = decodeLearnings(parent ?? []);
  if (parentResult.isErr()) {
    return Result.err(new DecodeError({ message: parentResult.error.message, path: "learnings.parent" }));
  }

  const milestoneResult = decodeLearnings(milestone ?? []);
  if (milestoneResult.isErr()) {
    return Result.err(new DecodeError({ message: milestoneResult.error.message, path: "learnings.milestone" }));
  }

  return Result.ok({
    own: ownResult.value,
    parent: parentResult.value,
    milestone: milestoneResult.value,
  });
}

/**
 * Decode TaskWithContext from unknown JSON
 */
export function decodeTaskWithContext(v: unknown): Result<TaskWithContext, DecodeError> {
  if (!isObject(v)) {
    return Result.err(new DecodeError({ message: "TaskWithContext must be object" }));
  }

  // First decode the base task fields
  const taskResult = decodeTask(v);
  if (taskResult.isErr()) return taskResult;

  // Then decode context and learnings
  const { context, learnings } = v;

  const ctxResult = decodeTaskContext(context);
  if (ctxResult.isErr()) {
    return Result.err(new DecodeError({ message: ctxResult.error.message, path: "context" }));
  }

  const lrnResult = decodeInheritedLearnings(learnings);
  if (lrnResult.isErr()) {
    return Result.err(new DecodeError({ message: lrnResult.error.message, path: "learnings" }));
  }

  return Result.ok({
    ...taskResult.value,
    context: ctxResult.value,
    learnings: lrnResult.value,
  });
}

/**
 * Decode nullable TaskWithContext (for nextReady)
 */
export function decodeTaskWithContextOrNull(
  v: unknown
): Result<TaskWithContext | null, DecodeError> {
  if (v === null) return Result.ok(null);
  return decodeTaskWithContext(v);
}
