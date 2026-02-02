/**
 * Collapsible detail panel for task details.
 * Positioned at bottom, toggles with keyboard shortcut.
 * Height is resizable via drag handle and persisted to localStorage.
 */

import { useRef, useEffect } from "react";
import {
  useUIStore,
  useSelectedTaskId,
  useDetailPanelOpen,
  usePanelHeight,
  clampPanelHeight,
  PANEL_HEIGHT_MIN,
  PANEL_HEIGHT_MAX_VH,
} from "../lib/store.js";
import { useTask } from "../lib/queries.js";
import { TaskDetail } from "./TaskDetail.js";
import { Kbd } from "./ui/Kbd.js";

/** Collapsed header height in pixels */
const COLLAPSED_HEIGHT = 40;

export function DetailPanel() {
  // State selectors (use exported hooks per AGENTS.md convention)
  const selectedTaskId = useSelectedTaskId();
  const detailPanelOpen = useDetailPanelOpen();
  const panelHeight = usePanelHeight();

  // Actions (use raw useUIStore - no exported action hooks)
  const toggleDetailPanel = useUIStore((s) => s.toggleDetailPanel);
  const setSelectedTaskId = useUIStore((s) => s.setSelectedTaskId);
  const setPanelHeight = useUIStore((s) => s.setPanelHeight);

  const { data: selectedTask } = useTask(selectedTaskId);

  // Resize drag state (refs to avoid re-renders during drag)
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const handleTaskDeleted = () => {
    setSelectedTaskId(null);
  };

  // Reset drag state when panel closes mid-drag or component unmounts
  useEffect(() => {
    if (!detailPanelOpen && isDragging.current) {
      isDragging.current = false;
      if (panelRef.current) {
        panelRef.current.style.transition = "";
      }
    }
  }, [detailPanelOpen]);

  // Pointer event handlers for resize
  // Performance: manipulate DOM directly during drag, commit to store on release
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!detailPanelOpen || !panelRef.current) return;

    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;

    // Disable CSS transition during drag for immediate feedback
    panelRef.current.style.transition = "none";

    // Capture pointer for smooth dragging even outside element
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !panelRef.current) return;

    // Panel grows upward, so subtract delta (dragging up = negative clientY delta = larger panel)
    const delta = dragStartY.current - e.clientY;
    const newHeight = clampPanelHeight(dragStartHeight.current + delta);

    // Direct DOM manipulation - no React re-render
    panelRef.current.style.height = `${newHeight}px`;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !panelRef.current) return;

    // Re-enable CSS transition
    panelRef.current.style.transition = "";

    // Get final height from DOM and commit to store (persists to localStorage)
    const finalHeight = panelRef.current.offsetHeight;
    setPanelHeight(finalHeight);

    isDragging.current = false;

    // Guard against already-released capture (e.g., pointercancel)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Keyboard handler for resize handle (ARIA separator pattern)
  const handleResizeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10; // Shift for larger steps
    let newHeight = panelHeight;

    switch (e.key) {
      case "ArrowUp":
        newHeight = panelHeight + step;
        break;
      case "ArrowDown":
        newHeight = panelHeight - step;
        break;
      case "Home":
        // Max height
        newHeight = Math.floor(window.innerHeight * PANEL_HEIGHT_MAX_VH);
        break;
      case "End":
        // Min height
        newHeight = PANEL_HEIGHT_MIN;
        break;
      default:
        return; // Don't prevent default for other keys
    }

    e.preventDefault();
    setPanelHeight(clampPanelHeight(newHeight));
  };

  // Compute height: persisted value when open, collapsed when closed
  const height = detailPanelOpen ? panelHeight : COLLAPSED_HEIGHT;

  return (
    <div
      ref={panelRef}
      className="border-t border-border bg-bg-secondary transition-[height] duration-150 motion-reduce:transition-none flex flex-col"
      style={{ height }}
    >
      {/* Resize handle - only shown when panel is open */}
      {detailPanelOpen && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-valuenow={panelHeight}
          aria-valuemin={PANEL_HEIGHT_MIN}
          aria-valuemax={Math.floor(window.innerHeight * PANEL_HEIGHT_MAX_VH)}
          aria-label="Resize panel"
          tabIndex={0}
          className="h-2 cursor-ns-resize bg-transparent hover:bg-accent-subtle active:bg-accent-muted focus-visible:bg-accent-subtle focus-visible:ring-2 focus-visible:ring-border-focus transition-colors motion-reduce:transition-none shrink-0 touch-none select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          onKeyDown={handleResizeKeyDown}
        />
      )}

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
