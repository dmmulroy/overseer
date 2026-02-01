/**
 * Collapsible detail panel for task details.
 * Positioned at bottom, toggles with keyboard shortcut.
 */

import { tv } from "tailwind-variants";
import { useUIStore } from "../lib/store.js";
import { useTask } from "../lib/queries.js";
import { TaskDetail } from "./TaskDetail.js";
import { Kbd } from "./ui/Kbd.js";

const panel = tv({
  base: [
    "border-t border-border bg-bg-secondary transition-[height] duration-150 motion-reduce:transition-none",
    "flex flex-col",
  ],
  variants: {
    open: {
      true: "h-80",
      false: "h-10",
    },
  },
});

export function DetailPanel() {
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const toggleDetailPanel = useUIStore((s) => s.toggleDetailPanel);
  const setSelectedTaskId = useUIStore((s) => s.setSelectedTaskId);

  const { data: selectedTask } = useTask(selectedTaskId);

  const handleTaskDeleted = () => {
    setSelectedTaskId(null);
  };

  return (
    <div className={panel({ open: detailPanelOpen })}>
      {/* Toggle bar */}
      <button
        className="h-10 px-4 flex items-center justify-between shrink-0 hover:bg-surface-primary transition-colors duration-150 motion-reduce:transition-none cursor-pointer w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-inset"
        onClick={toggleDetailPanel}
        aria-expanded={detailPanelOpen}
        aria-controls="detail-panel-content"
      >
        <div className="flex items-center gap-2">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            className={`transition-transform motion-reduce:transition-none text-text-muted ${detailPanelOpen ? "rotate-180" : ""}`}
          >
            <path
              d="M2 8L6 4L10 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-sm font-mono text-text-muted">
            {selectedTask ? selectedTask.description : "No task selected"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Kbd size="sm">D</Kbd>
        </div>
      </button>

      {/* Content */}
      {detailPanelOpen && (
        <div
          id="detail-panel-content"
          className="flex-1 overflow-hidden border-t border-border"
        >
          {selectedTask ? (
            <div className="h-full overflow-y-auto">
              <TaskDetail task={selectedTask} onDeleted={handleTaskDeleted} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              Select a task to view details
            </div>
          )}
        </div>
      )}
    </div>
  );
}
