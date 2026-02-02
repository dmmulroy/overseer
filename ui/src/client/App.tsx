import { useEffect, useMemo } from "react";
import { useTasks } from "./lib/queries.js";
import { useUIStore, type ViewMode } from "./lib/store.js";
import { KeyboardProvider, useKeyboardShortcuts } from "./lib/keyboard.js";
import { useMilestoneFilter } from "./lib/use-url-filter.js";
import { KeyboardHelp } from "./components/KeyboardHelp.js";
import { Header } from "./components/Header.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { GraphView, KanbanView, ListView } from "./components/views/index.js";
import type { Task, TaskId } from "../types.js";

/**
 * Main application layout - multi-view design:
 * - Header: Logo, view tabs, status
 * - Main: Active view (Graph/Kanban/List)
 * - Bottom: Collapsible detail panel
 */
export function App() {
  return (
    <KeyboardProvider>
      <AppContent />
    </KeyboardProvider>
  );
}

function AppContent() {
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useUIStore((s) => s.setSelectedTaskId);
  const toggleDetailPanel = useUIStore((s) => s.toggleDetailPanel);
  const clearIfMissing = useUIStore((s) => s.clearIfMissing);

  const { data: tasks, isLoading, isFetching, error } = useTasks();

  // URL-based milestone filter
  const [filterMilestoneId, setFilterMilestoneId] = useMilestoneFilter();

  // Compute milestones (depth-0 tasks)
  const milestones = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter((t) => t.depth === 0);
  }, [tasks]);

  // Validate filter exists (clear if milestone deleted)
  useEffect(() => {
    if (filterMilestoneId && tasks) {
      const exists = tasks.some((t) => t.id === filterMilestoneId && t.depth === 0);
      if (!exists) {
        setFilterMilestoneId(null);
      }
    }
  }, [filterMilestoneId, tasks, setFilterMilestoneId]);

  // Compute visible tasks via descendant traversal
  const visibleTasks = useMemo(() => {
    if (!tasks) return [];
    if (!filterMilestoneId) return tasks;

    // Build lookup maps for O(1) access
    const tasksById = new Map<TaskId, Task>(tasks.map((t) => [t.id, t]));
    const childrenMap = new Map<TaskId | null, Task[]>();
    for (const task of tasks) {
      const siblings = childrenMap.get(task.parentId) ?? [];
      siblings.push(task);
      childrenMap.set(task.parentId, siblings);
    }

    // Collect milestone and all descendants using Map for O(1) lookups
    const result: Task[] = [];
    const collect = (taskId: TaskId) => {
      const task = tasksById.get(taskId);
      if (task) {
        result.push(task);
        const children = childrenMap.get(taskId) ?? [];
        for (const child of children) {
          collect(child.id);
        }
      }
    };
    collect(filterMilestoneId);
    return result;
  }, [tasks, filterMilestoneId]);

  // Build visible task ID set for quick lookups
  const visibleTaskIds = useMemo(() => {
    return new Set(visibleTasks.map((t) => t.id));
  }, [visibleTasks]);

  // Compute external blockers - tasks referenced in blockedBy but not in visible set
  const externalBlockers = useMemo(() => {
    if (!tasks) return new Map<TaskId, Task>();

    const allTasksMap = new Map<TaskId, Task>(tasks.map((t) => [t.id, t]));
    const external = new Map<TaskId, Task>();

    for (const task of visibleTasks) {
      if (task.blockedBy) {
        for (const blockerId of task.blockedBy) {
          if (!visibleTaskIds.has(blockerId)) {
            const blockerTask = allTasksMap.get(blockerId);
            if (blockerTask) external.set(blockerId, blockerTask);
          }
        }
      }
    }

    return external;
  }, [tasks, visibleTasks, visibleTaskIds]);

  // Clear selection if task no longer exists or is filtered out
  useEffect(() => {
    clearIfMissing(visibleTaskIds);
  }, [visibleTaskIds, clearIfMissing]);

  // Derive last updated from max(tasks.updatedAt) - reflects actual data changes, not refetch time
  // Uses Date.parse + Number.isFinite to reject invalid dates (avoids showing 1970 on malformed data)
  const lastUpdated = useMemo(() => {
    if (!tasks || tasks.length === 0) return undefined;

    let max = -Infinity;
    for (const task of tasks) {
      const ms = Date.parse(task.updatedAt);
      if (Number.isFinite(ms) && ms > max) max = ms;
    }
    if (!Number.isFinite(max)) return undefined;
    return new Date(max).toISOString();
  }, [tasks]);

  // Register keyboard shortcuts for view switching
  useKeyboardShortcuts(
    () => [
      {
        key: "1",
        description: "Switch to Graph view",
        scope: "global",
        handler: () => setViewMode("graph"),
      },
      {
        key: "2",
        description: "Switch to Kanban view",
        scope: "global",
        handler: () => setViewMode("kanban"),
      },
      {
        key: "3",
        description: "Switch to List view",
        scope: "global",
        handler: () => setViewMode("list"),
      },
      {
        key: "d",
        description: "Toggle detail panel",
        scope: "global",
        handler: () => toggleDetailPanel(),
      },
    ],
    [setViewMode, toggleDetailPanel]
  );

  const handleTaskSelect = (id: TaskId) => {
    setSelectedTaskId(id);
  };

  return (
    <>
      <KeyboardHelp />
      <div className="flex flex-col h-screen bg-bg-primary">
        {/* Header */}
        <Header
          lastUpdated={lastUpdated}
          isError={error !== null}
          isLoading={isLoading}
          isRefetching={isFetching && !isLoading}
          milestones={milestones}
          filterMilestoneId={filterMilestoneId}
          onFilterChange={setFilterMilestoneId}
        />

        {/* Main content area */}
        <main className="flex-1 flex flex-col min-h-0">
          {/* View container */}
          <div className="flex-1 min-h-0 flex">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center text-text-muted">
                Loading...
              </div>
            ) : error ? (
              <div className="flex-1 flex items-center justify-center text-status-blocked">
                Error: {error.message}
              </div>
            ) : (
              <ViewContainer
                viewMode={viewMode}
                tasks={visibleTasks}
                externalBlockers={externalBlockers}
                selectedId={selectedTaskId}
                onSelect={handleTaskSelect}
              />
            )}
          </div>

          {/* Detail panel */}
          <DetailPanel />
        </main>
      </div>
    </>
  );
}

interface ViewContainerProps {
  viewMode: ViewMode;
  tasks: Task[];
  externalBlockers: Map<TaskId, Task>;
  selectedId: TaskId | null;
  onSelect: (id: TaskId) => void;
}

function ViewContainer({
  viewMode,
  tasks,
  externalBlockers,
  selectedId,
  onSelect,
}: ViewContainerProps) {
  switch (viewMode) {
    case "graph":
      return (
        <GraphView
          tasks={tasks}
          externalBlockers={externalBlockers}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      );
    case "kanban":
      return (
        <KanbanView
          tasks={tasks}
          externalBlockers={externalBlockers}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      );
    case "list":
      return (
        <ListView
          tasks={tasks}
          externalBlockers={externalBlockers}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      );
  }
}
