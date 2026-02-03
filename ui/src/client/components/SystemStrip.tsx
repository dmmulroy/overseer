/**
 * SystemStrip - Priority feed bar inspired by theme-lab cr-highlight-bar
 * Displays system status, current filter, and key metadata
 */

import { useMemo } from "react";
import type { Task, TaskId } from "../../types.js";

interface SystemStripProps {
  /** Currently selected milestone filter */
  filterMilestoneId: TaskId | null;
  /** Available milestones */
  milestones: Task[];
  /** All tasks (for computing stats) */
  tasks: Task[];
  /** Connection status */
  isConnected: boolean;
}

export function SystemStrip({
  filterMilestoneId,
  milestones,
  tasks,
  isConnected,
}: SystemStripProps) {
  // Find selected milestone
  const selectedMilestone = filterMilestoneId
    ? milestones.find((m) => m.id === filterMilestoneId)
    : null;

  // Compute stats for visible scope
  const stats = useMemo(() => {
    const scope = filterMilestoneId
      ? tasks.filter((t) => {
          // Include milestone and all descendants
          let current: Task | undefined = t;
          while (current) {
            if (current.id === filterMilestoneId) return true;
            current = tasks.find((task) => task.id === current?.parentId);
          }
          return false;
        })
      : tasks;

    const total = scope.length;
    const completed = scope.filter((t) => t.completed).length;
    const ready = scope.filter((t) => !t.completed && !t.effectivelyBlocked).length;
    const blocked = scope.filter((t) => !t.completed && t.effectivelyBlocked).length;

    return { total, completed, ready, blocked };
  }, [tasks, filterMilestoneId]);

  return (
    <div className="flex items-center gap-4 px-6 py-3 border-b-[3px] border-accent shrink-0 system-strip">
      {/* Chevron prefix */}
      <span className="text-xs font-mono uppercase tracking-[0.14em] text-accent-strong font-bold">
        &gt;&gt; PRIORITY FEED
      </span>

      {/* Status text */}
      <span className="flex-1 text-xs font-mono uppercase tracking-[0.14em] text-text-primary">
        {isConnected ? "System operational" : "Connection lost"}.{" "}
        {selectedMilestone ? (
          <>
            Milestone: <span className="font-bold">{selectedMilestone.description}</span>.
          </>
        ) : (
          "All milestones active."
        )}{" "}
        {stats.ready > 0 && (
          <>
            {stats.ready} task{stats.ready !== 1 ? "s" : ""} ready.
          </>
        )}{" "}
        {stats.blocked > 0 && (
          <>
            {stats.blocked} blocked.
          </>
        )}
      </span>

      {/* Route indicator */}
      <span className="text-xs font-mono uppercase tracking-[0.14em] text-accent-strong font-bold">
        ROUTE {String.fromCharCode(65 + (stats.total % 26))}{(stats.total % 10) + 1}
      </span>
    </div>
  );
}
