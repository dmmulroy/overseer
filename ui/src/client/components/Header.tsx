/**
 * Header component with logo, view tabs, and status.
 *
 * Layout: [OVERSEER logo] [Graph|Kanban|List tabs] [Filter dropdown] [spacer] [connection] [last-update] [⌘?]
 */

import { useState, useEffect } from "react";
import { tv } from "tailwind-variants";
import { useUIStore, type ViewMode } from "../lib/store.js";
import { useKeyboardContext } from "../lib/keyboard.js";
import { formatRelativeTime } from "../lib/utils.js";
import { Kbd } from "./ui/Kbd.js";
import { isTaskId, type Task, type TaskId } from "../../types.js";

const VIEW_TABS: Array<{ mode: ViewMode; label: string; shortcut: string }> = [
  { mode: "graph", label: "Graph", shortcut: "1" },
  { mode: "kanban", label: "Kanban", shortcut: "2" },
  { mode: "list", label: "List", shortcut: "3" },
];

const tab = tv({
  base: [
    "px-3 py-1.5 text-sm font-mono uppercase tracking-wider",
    "border-2 border-transparent rounded-none",
    "transition-colors duration-150 motion-reduce:transition-none cursor-pointer",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
  ],
  variants: {
    active: {
      true: "bg-accent text-text-inverse border-accent font-bold",
      false: "text-text-muted hover:text-text-primary hover:bg-surface-primary border-border",
    },
  },
});

interface HeaderProps {
  /** ISO timestamp of last data update */
  lastUpdated?: string;
  /** Whether API fetch is currently in error state */
  isError?: boolean;
  /** Whether initial fetch is loading (no data yet) */
  isLoading?: boolean;
  /** Whether background refetch is in progress */
  isRefetching?: boolean;
  /** Available milestones (depth-0 tasks) for filtering */
  milestones?: Task[];
  /** Currently selected milestone filter */
  filterMilestoneId: TaskId | null;
  /** Callback to change the filter */
  onFilterChange: (id: TaskId | null) => void;
}

/**
 * Hook to force re-render at intervals for live-updating timestamps
 */
function useInterval(intervalMs: number) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export function Header({
  lastUpdated,
  isError,
  isLoading,
  isRefetching,
  milestones = [],
  filterMilestoneId,
  onFilterChange,
}: HeaderProps) {
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const { setHelpOpen } = useKeyboardContext();

  // Re-render every second to keep timestamp current
  useInterval(1000);

  // Find selected milestone for chip label
  const selectedMilestone = filterMilestoneId
    ? milestones.find((m) => m.id === filterMilestoneId)
    : null;

  return (
    <header className="flex items-center gap-4 px-4 h-12 border-b-2 border-border bg-bg-secondary shrink-0 accent-bar-bottom">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <span className="text-display text-2xl text-accent tracking-[0.05em]">
          OVERSEER
        </span>
      </div>

      {/* View buttons */}
      <nav className="flex items-center gap-1" aria-label="Views">
        {VIEW_TABS.map(({ mode, label, shortcut }) => (
          <button
            key={mode}
            aria-pressed={viewMode === mode}
            className={tab({ active: viewMode === mode })}
            onClick={() => setViewMode(mode)}
          >
            <span className="flex items-center gap-2">
              {label}
              <Kbd size="sm" aria-hidden="true">
                {shortcut}
              </Kbd>
            </span>
          </button>
        ))}
      </nav>

      {/* Milestone filter dropdown */}
      <div className="flex items-center gap-2">
        <select
          value={filterMilestoneId ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            onFilterChange(value === "" ? null : isTaskId(value) ? value : null);
          }}
          className="px-2 py-1 text-sm font-mono uppercase tracking-wider bg-surface-primary border-2 border-border rounded-none text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus cursor-pointer"
          aria-label="Filter by milestone"
        >
          <option value="">All milestones</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.description}
            </option>
          ))}
        </select>

        {/* Filter active chip with clear button */}
        {selectedMilestone && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-none bg-accent-subtle border-2 border-accent">
            <span className="text-xs font-mono uppercase tracking-wider text-accent font-bold">Filtered</span>
            <button
              onClick={() => onFilterChange(null)}
              className="ml-1 text-accent hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              aria-label="Clear milestone filter"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3 h-3"
                aria-hidden="true"
              >
                <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Screen reader announcement for connection status - only announce meaningful changes, not routine refetches */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {isError ? "Connection lost" : isLoading ? "Loading data" : "Connected"}
      </span>

      {/* Connection status indicator */}
      {isError && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-status-blocked/10 border border-status-blocked/30">
          <span
            className="w-2 h-2 rounded-full bg-status-blocked animate-pulse-error motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="text-xs text-status-blocked font-mono uppercase">
            Disconnected
          </span>
        </div>
      )}

      {/* Initial loading indicator (no data yet) */}
      {isLoading && !isError && (
        <span className="text-xs text-text-dim font-mono">loading...</span>
      )}

      {/* Last updated timestamp - shown even during errors for staleness context */}
      {lastUpdated && !isLoading && (
        <span className="flex items-center gap-1.5 text-xs text-text-dim font-mono">
          {/* Subtle sync indicator during background refetch (not during error) */}
          {isRefetching && !isError && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse motion-reduce:animate-none"
              aria-hidden="true"
              title="Syncing..."
            />
          )}
          {formatRelativeTime(new Date(lastUpdated))}
        </span>
      )}

      {/* Help shortcut */}
      <button
        className="flex items-center gap-1 px-2 py-1 text-text-muted hover:text-text-primary transition-colors duration-150 motion-reduce:transition-none rounded hover:bg-surface-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        onClick={() => setHelpOpen(true)}
        aria-label="Show keyboard shortcuts"
      >
        <Kbd size="sm">⌘</Kbd>
        <Kbd size="sm">?</Kbd>
      </button>
    </header>
  );
}
