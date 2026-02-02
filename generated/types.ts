/**
 * AUTO-GENERATED TypeScript types from Rust source of truth.
 * 
 * Source: overseer/src/types.rs, overseer/src/id.rs, overseer/src/db/learning_repo.rs
 * 
 * DO NOT EDIT - regenerate with: ./scripts/generate-types.sh
 * 
 * Compare against:
 * - mcp/src/types.ts
 * - ui/src/types.ts
 */

// ============ Branded ID Types ============

declare const TaskIdBrand: unique symbol;
declare const LearningIdBrand: unique symbol;

/** Task ID: "task_" prefix + 26-char ULID */
export type TaskId = string & { readonly [TaskIdBrand]: never };

/** Learning ID: "lrn_" prefix + 26-char ULID */
export type LearningId = string & { readonly [LearningIdBrand]: never };

// ============ Validation Helpers ============

export function isTaskId(s: string): s is TaskId {
  return s.startsWith("task_") && s.length === 31;
}

export function isLearningId(s: string): s is LearningId {
  return s.startsWith("lrn_") && s.length === 30;
}

export function parseTaskId(s: string): TaskId {
  if (!isTaskId(s)) throw new Error(`Invalid TaskId: ${s}`);
  return s;
}

export function parseLearningId(s: string): LearningId {
  if (!isLearningId(s)) throw new Error(`Invalid LearningId: ${s}`);
  return s;
}

// ============ Domain Types ============

/** Priority levels (enforced by Rust, 1-5) */
export type Priority = 1 | 2 | 3 | 4 | 5;

/** Task depth (0=milestone, 1=task, 2=subtask) */
export type Depth = 0 | 1 | 2;

/** Task context chain (inherited from hierarchy) */
export interface TaskContext {
  own: string;
  parent?: string;
  milestone?: string;
}

/** Inherited learnings (own task + ancestors) */
export interface InheritedLearnings {
  /** Learnings attached directly to this task (bubbled from completed children) */
  own: Learning[];
  /** Learnings from parent task (depth > 0) */
  parent: Learning[];
  /** Learnings from root milestone (depth > 1) */
  milestone: Learning[];
}

/** Learning attached to a task */
export interface Learning {
  id: LearningId;
  taskId: TaskId;
  content: string;
  sourceTaskId: TaskId | null;
  createdAt: string; // ISO 8601
}

/**
 * Task returned from list/create/update/start/complete/reopen
 * Does NOT include context chain or inherited learnings
 */
export interface Task {
  id: TaskId;
  parentId: TaskId | null;
  description: string;
  priority: Priority;
  completed: boolean;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  result: string | null;
  commitSha: string | null;
  depth: Depth;
  blockedBy?: TaskId[];
  blocks?: TaskId[];
  bookmark?: string;
  startCommit?: string;
  /** Computed: true if task or any ancestor has incomplete blockers */
  effectivelyBlocked: boolean;
}

/**
 * Task returned from get/nextReady - includes context chain and inherited learnings
 */
export interface TaskWithContext extends Task {
  context: TaskContext;
  learnings: InheritedLearnings;
}

/** Recursive task tree node (from os task tree) */
export interface TaskTree {
  task: Task;
  children: TaskTree[];
}

/** Progress summary (aggregate counts) */
export interface TaskProgress {
  total: number;
  completed: number;
  ready: number;   // !completed && !effectivelyBlocked
  blocked: number; // !completed && effectivelyBlocked
}

// ============ VCS Types ============

export type VcsType = "jj" | "git" | "none";

export interface VcsInfo {
  type: VcsType;
  root: string;
}

export type FileStatusKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

export interface FileStatus {
  path: string;
  status: FileStatusKind;
}

export interface VcsStatus {
  files: FileStatus[];
  workingCopyId: string | null;
}

export interface LogEntry {
  id: string;
  description: string;
  author: string;
  timestamp: string; // ISO 8601
}

export type ChangeType = "added" | "modified" | "deleted" | "renamed";

export interface DiffEntry {
  path: string;
  changeType: ChangeType;
}

export interface CommitResult {
  id: string;
  message: string;
}

// ============ Error Types ============

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
