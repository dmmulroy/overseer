/**
 * Hook to track which tasks have changed since last fetch.
 *
 * Compares updatedAt timestamps to detect changes.
 * Returns a Set of task IDs that changed, cleared after animation duration.
 */

import { useState, useEffect, useRef } from "react";
import type { Task, TaskId } from "../../types.js";

/** Duration to show the change flash (matches CSS animation) */
const FLASH_DURATION_MS = 1000;

/**
 * Track tasks that changed between fetches.
 * Each task gets its own timeout so rapid changes don't cut short earlier flashes.
 *
 * @param tasks Current task list
 * @returns Set of task IDs that recently changed (each cleared after FLASH_DURATION_MS)
 */
export function useChangedTasks(tasks: Task[]): Set<TaskId> {
  const [changedIds, setChangedIds] = useState<Set<TaskId>>(new Set());
  const prevTasksRef = useRef<Map<TaskId, string>>(new Map());
  const initialLoadRef = useRef(true);
  const timeoutsRef = useRef<Map<TaskId, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    // Skip detection on initial load
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      // Store initial state
      const newMap = new Map<TaskId, string>();
      for (const task of tasks) {
        newMap.set(task.id, task.updatedAt);
      }
      prevTasksRef.current = newMap;
      return;
    }

    // Find changed tasks by comparing updatedAt
    const changed = new Set<TaskId>();
    for (const task of tasks) {
      const prevUpdatedAt = prevTasksRef.current.get(task.id);
      if (prevUpdatedAt !== undefined && prevUpdatedAt !== task.updatedAt) {
        changed.add(task.id);
      }
    }

    // Update previous state for next comparison
    const newMap = new Map<TaskId, string>();
    for (const task of tasks) {
      newMap.set(task.id, task.updatedAt);
    }
    prevTasksRef.current = newMap;

    // Schedule per-task timeouts (H2 fix: each task gets full flash duration)
    if (changed.size > 0) {
      // Merge with existing changed IDs
      setChangedIds((prev) => new Set([...prev, ...changed]));

      // Set up individual timeouts for each changed task
      for (const id of changed) {
        // Clear existing timeout for this task if any
        const existing = timeoutsRef.current.get(id);
        if (existing !== undefined) {
          clearTimeout(existing);
        }

        // Schedule removal of just this task ID
        const timeoutId = setTimeout(() => {
          setChangedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          timeoutsRef.current.delete(id);
        }, FLASH_DURATION_MS);

        timeoutsRef.current.set(id, timeoutId);
      }
    }
  }, [tasks]);

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      for (const timeoutId of timeoutsRef.current.values()) {
        clearTimeout(timeoutId);
      }
      timeoutsRef.current.clear();
    };
  }, []);

  return changedIds;
}
