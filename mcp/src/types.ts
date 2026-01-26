/**
 * Core domain types mirroring the Rust CLI output
 */

// Branded types for type-safe IDs
declare const TaskIdBrand: unique symbol;
declare const LearningIdBrand: unique symbol;

export type TaskId = string & { readonly [TaskIdBrand]: never };
export type LearningId = string & { readonly [LearningIdBrand]: never };

// Validation helpers
export function isTaskId(s: string): s is TaskId {
  return s.startsWith("task_") && s.length === 31; // "task_" + 26 ULID chars
}

export function isLearningId(s: string): s is LearningId {
  return s.startsWith("lrn_") && s.length === 30; // "lrn_" + 26 ULID chars
}

export function parseTaskId(s: string): TaskId {
  if (!isTaskId(s)) {
    throw new Error(`Invalid TaskId: ${s}`);
  }
  return s;
}

export function parseLearningId(s: string): LearningId {
  if (!isLearningId(s)) {
    throw new Error(`Invalid LearningId: ${s}`);
  }
  return s;
}

export interface Task {
  id: TaskId;
  parentId: TaskId | null;
  description: string;
  context: {
    own: string;
    parent?: string;
    milestone?: string;
  };
  learnings: {
    milestone: Learning[];
    parent: Learning[];
  };
  priority: 1 | 2 | 3 | 4 | 5;
  completed: boolean;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  result: string | null;
  commitSha: string | null;
  depth: 0 | 1 | 2;
  blockedBy: TaskId[];
  blocks: TaskId[];
}

export interface Learning {
  id: LearningId;
  taskId: TaskId;
  content: string;
  sourceTaskId: TaskId | null;
  createdAt: string;
}

/**
 * CLI command errors
 */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class CliTimeoutError extends Error {
  constructor(message = "CLI command timeout (30s)") {
    super(message);
    this.name = "CliTimeoutError";
  }
}
