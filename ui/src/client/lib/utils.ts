import type { Depth, Task, TaskId } from "../../types.js";

/**
 * Format a timestamp as relative time (e.g., "2s ago", "5m ago")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString();
}

/**
 * Task status variant for UI display.
 * Uses effectivelyBlocked (domain-correct field) instead of blockedBy.length.
 */
export type StatusVariant = "pending" | "active" | "blocked" | "done";

/**
 * Derive task status for consistent UI rendering.
 * - done: task.completed
 * - blocked: not completed AND effectivelyBlocked (task or ancestor has incomplete blockers)
 * - active: not completed, not blocked, AND started
 * - pending: everything else
 */
export function getStatusVariant(task: Task): StatusVariant {
  if (task.completed) return "done";
  if (task.effectivelyBlocked) return "blocked";
  if (task.startedAt !== null) return "active";
  return "pending";
}

/**
 * Human-readable status label.
 */
export function getStatusLabel(task: Task): string {
  const variant = getStatusVariant(task);
  switch (variant) {
    case "done":
      return "DONE";
    case "blocked":
      return "BLOCKED";
    case "active":
      return "ACTIVE";
    case "pending":
      return "PENDING";
  }
}

/**
 * Human-readable depth label (MILESTONE, TASK, SUBTASK).
 */
export function getDepthLabel(depth: Depth): string {
  switch (depth) {
    case 0:
      return "MILESTONE";
    case 1:
      return "TASK";
    case 2:
      return "SUBTASK";
  }
}

/**
 * Compute external blocker counts for each task.
 * Returns Map<TaskId, number> where number is count of blockers in externalBlockers.
 */
export function computeExternalBlockerCounts(
  tasks: Task[],
  externalBlockers: Map<TaskId, Task>
): Map<TaskId, number> {
  const counts = new Map<TaskId, number>();

  for (const task of tasks) {
    if (task.blockedBy) {
      const externalCount = task.blockedBy.filter((id) =>
        externalBlockers.has(id)
      ).length;
      if (externalCount > 0) {
        counts.set(task.id, externalCount);
      }
    }
  }

  return counts;
}
