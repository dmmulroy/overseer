import { useEffect, useMemo } from "react";
import { useTasks } from "./lib/queries.js";
import { useUIStore, type ViewMode } from "./lib/store.js";
import { KeyboardProvider, useKeyboardShortcuts } from "./lib/keyboard.js";
import { KeyboardHelp } from "./components/KeyboardHelp.js";
import { Header } from "./components/Header.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { GraphView, KanbanView, ListView } from "./components/views/index.js";
import type { TaskId } from "../types.js";

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

  const { data: tasks, isLoading, isFetching, error, dataUpdatedAt } = useTasks();

  // Clear selection if task no longer exists after refetch
  const taskIds = useMemo(() => {
    if (!tasks) return new Set<TaskId>();
    return new Set(tasks.map((t) => t.id));
  }, [tasks]);

  useEffect(() => {
    clearIfMissing(taskIds);
  }, [taskIds, clearIfMissing]);

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

  // Format last updated timestamp
  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toISOString()
    : undefined;

  return (
    <>
      <KeyboardHelp />
      <div className="flex flex-col h-screen bg-bg-primary">
        {/* Header */}
        <Header
          lastUpdated={lastUpdated}
          isError={error !== null}
          isLoading={isFetching}
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
                tasks={tasks ?? []}
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
  tasks: import("../types.js").Task[];
  selectedId: TaskId | null;
  onSelect: (id: TaskId) => void;
}

function ViewContainer({
  viewMode,
  tasks,
  selectedId,
  onSelect,
}: ViewContainerProps) {
  switch (viewMode) {
    case "graph":
      return (
        <GraphView tasks={tasks} selectedId={selectedId} onSelect={onSelect} />
      );
    case "kanban":
      return (
        <KanbanView tasks={tasks} selectedId={selectedId} onSelect={onSelect} />
      );
    case "list":
      return (
        <ListView tasks={tasks} selectedId={selectedId} onSelect={onSelect} />
      );
  }
}
