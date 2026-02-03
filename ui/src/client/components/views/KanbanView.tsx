/**
 * Kanban view - 4-column board grouped by task status.
 * Columns: PENDING | BLOCKED | ACTIVE | DONE
 *
 * Features:
 * - Column headers with task count
 * - Task cards using Card component
 * - Click card to select (opens detail panel)
 * - Keyboard navigation (j/k within columns, h/l between columns)
 * - No drag-drop (read-only, matches graph view)
 */

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import type { Task, TaskId } from "../../../types.js";
import { Card } from "../ui/Card.js";
import { Badge } from "../ui/Badge.js";
import { useKeyboardShortcuts } from "../../lib/keyboard.js";
import { useKeyboardScope } from "../../lib/use-keyboard-scope.js";
import { useChangedTasks } from "../../lib/use-changed-tasks.js";
import {
  formatRelativeTime,
  getStatusVariant,
  getDepthLabel,
  computeExternalBlockerCounts,
  type StatusVariant,
} from "../../lib/utils.js";

const COLUMNS: StatusVariant[] = ["pending", "blocked", "active", "done"];

const COLUMN_LABELS: Record<StatusVariant, string> = {
  pending: "PENDING",
  active: "ACTIVE",
  blocked: "BLOCKED",
  done: "DONE",
};

/** Static text color classes for each column (Tailwind can't detect dynamic classes) */
const COLUMN_TEXT_COLORS: Record<StatusVariant, string> = {
  pending: "text-status-pending",
  active: "text-status-active",
  blocked: "text-status-blocked",
  done: "text-status-done",
};

interface KanbanViewProps {
  tasks: Task[];
  externalBlockers: Map<TaskId, Task>;
  selectedId: TaskId | null;
  onSelect: (id: TaskId) => void;
}

export function KanbanView({
  tasks,
  externalBlockers,
  selectedId,
  onSelect,
}: KanbanViewProps) {
  const scopeProps = useKeyboardScope("kanban", { activateOnMount: true });
  const changedTaskIds = useChangedTasks(tasks);

  // Compute external blocker counts using shared utility
  const externalBlockerCounts = useMemo(
    () => computeExternalBlockerCounts(tasks, externalBlockers),
    [tasks, externalBlockers]
  );
  
  // Focus state: [columnIndex, taskIndexInColumn]
  const [focusedColumn, setFocusedColumn] = useState(0);
  const [focusedIndexInColumn, setFocusedIndexInColumn] = useState(0);
  
  // Refs for focus management
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Group tasks by status column
  const tasksByColumn = useMemo(() => {
    const grouped: Record<StatusVariant, Task[]> = {
      pending: [],
      active: [],
      blocked: [],
      done: [],
    };

    for (const task of tasks) {
      const column = getStatusVariant(task);
      grouped[column].push(task);
    }

    // Sort each column by priority, then by createdAt
    for (const column of COLUMNS) {
      grouped[column].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.createdAt.localeCompare(b.createdAt);
      });
    }

    return grouped;
  }, [tasks]);

  // Build child count map for progress bars
  const childCounts = useMemo(() => {
    const counts = new Map<TaskId, { total: number; completed: number }>();
    for (const task of tasks) {
      if (task.parentId) {
        const parent = counts.get(task.parentId) ?? { total: 0, completed: 0 };
        parent.total++;
        if (task.completed) parent.completed++;
        counts.set(task.parentId, parent);
      }
    }
    return counts;
  }, [tasks]);

  // Get current column's tasks
  const currentColumnKey = COLUMNS[focusedColumn];
  const currentColumnTasks = currentColumnKey ? tasksByColumn[currentColumnKey] : [];

  // Clamp focus index when column's task count changes
  useEffect(() => {
    const col = COLUMNS[focusedColumn];
    const columnTasks = col ? tasksByColumn[col] : [];
    if (focusedIndexInColumn >= columnTasks.length && columnTasks.length > 0) {
      setFocusedIndexInColumn(columnTasks.length - 1);
    } else if (columnTasks.length === 0) {
      setFocusedIndexInColumn(0);
    }
  }, [tasksByColumn, focusedColumn, focusedIndexInColumn]);

  // Sync focus with external selection
  useEffect(() => {
    if (!selectedId) return;
    
    for (let colIdx = 0; colIdx < COLUMNS.length; colIdx++) {
      const col = COLUMNS[colIdx];
      if (!col) continue;
      const columnTasks = tasksByColumn[col];
      const taskIdx = columnTasks.findIndex((t) => t.id === selectedId);
      if (taskIdx !== -1) {
        setFocusedColumn(colIdx);
        setFocusedIndexInColumn(taskIdx);
        break;
      }
    }
  }, [selectedId, tasksByColumn]);

  // Focus the currently focused card
  useEffect(() => {
    const col = COLUMNS[focusedColumn];
    const columnTasks = col ? tasksByColumn[col] : [];
    const task = columnTasks[focusedIndexInColumn];
    if (task) {
      const el = cardRefs.current.get(task.id);
      if (el) {
        el.focus({ preventScroll: true });
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
      }
    }
  }, [focusedColumn, focusedIndexInColumn, tasksByColumn]);

  // Navigation handlers
  const moveUp = useCallback(() => {
    setFocusedIndexInColumn((prev) => Math.max(0, prev - 1));
  }, []);

  const moveDown = useCallback(() => {
    const col = COLUMNS[focusedColumn];
    const columnTasks = col ? tasksByColumn[col] : [];
    setFocusedIndexInColumn((prev) => Math.min(columnTasks.length - 1, prev + 1));
  }, [focusedColumn, tasksByColumn]);

  const moveLeft = useCallback(() => {
    // Find next non-empty column to the left
    for (let i = focusedColumn - 1; i >= 0; i--) {
      const col = COLUMNS[i];
      if (col && tasksByColumn[col].length > 0) {
        setFocusedColumn(i);
        setFocusedIndexInColumn((prevIdx) =>
          Math.min(prevIdx, tasksByColumn[col].length - 1)
        );
        return;
      }
    }
    // Stay in current column if no non-empty column found
  }, [focusedColumn, tasksByColumn]);

  const moveRight = useCallback(() => {
    // Find next non-empty column to the right
    for (let i = focusedColumn + 1; i < COLUMNS.length; i++) {
      const col = COLUMNS[i];
      if (col && tasksByColumn[col].length > 0) {
        setFocusedColumn(i);
        setFocusedIndexInColumn((prevIdx) =>
          Math.min(prevIdx, tasksByColumn[col].length - 1)
        );
        return;
      }
    }
    // Stay in current column if no non-empty column found
  }, [focusedColumn, tasksByColumn]);

  const selectFocused = useCallback(() => {
    const col = COLUMNS[focusedColumn];
    const columnTasks = col ? tasksByColumn[col] : [];
    const task = columnTasks[focusedIndexInColumn];
    if (task) {
      onSelect(task.id);
    }
  }, [focusedColumn, focusedIndexInColumn, tasksByColumn, onSelect]);

  // Register keyboard shortcuts
  useKeyboardShortcuts(
    () => [
      {
        key: "j",
        description: "Move down in column",
        scope: "kanban",
        handler: moveDown,
      },
      {
        key: "k",
        description: "Move up in column",
        scope: "kanban",
        handler: moveUp,
      },
      {
        key: "h",
        description: "Move to left column",
        scope: "kanban",
        handler: moveLeft,
      },
      {
        key: "l",
        description: "Move to right column",
        scope: "kanban",
        handler: moveRight,
      },
      {
        key: "ArrowDown",
        description: "Move down in column",
        scope: "kanban",
        handler: moveDown,
      },
      {
        key: "ArrowUp",
        description: "Move up in column",
        scope: "kanban",
        handler: moveUp,
      },
      {
        key: "ArrowLeft",
        description: "Move to left column",
        scope: "kanban",
        handler: moveLeft,
      },
      {
        key: "ArrowRight",
        description: "Move to right column",
        scope: "kanban",
        handler: moveRight,
      },
      {
        key: "Enter",
        description: "Select focused task",
        scope: "kanban",
        handler: selectFocused,
      },
    ],
    [moveDown, moveUp, moveLeft, moveRight, selectFocused]
  );

  const handleCardRef = useCallback((id: TaskId, el: HTMLButtonElement | null) => {
    if (el) {
      cardRefs.current.set(id, el);
    } else {
      cardRefs.current.delete(id);
    }
  }, []);

  const handleTaskClick = useCallback(
    (task: Task, columnIndex: number, taskIndex: number) => {
      setFocusedColumn(columnIndex);
      setFocusedIndexInColumn(taskIndex);
      onSelect(task.id);
    },
    [onSelect]
  );

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-text-muted p-8 registration-mark">
        <div className="chevron-lg select-none" aria-hidden="true">&gt;&gt;&gt;&gt;</div>
        <p className="text-display text-2xl text-text-primary">NO TASKS IN STORE</p>
        <p className="text-text-dim text-sm font-mono uppercase tracking-wider">
          Run <span className="text-accent">os task create -d "Your task"</span> to begin
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col bg-bg-primary overflow-hidden"
      {...scopeProps}
    >
      {/* Column container */}
      <div className="flex-1 flex justify-center gap-3 p-4 overflow-x-auto min-h-0">
        {COLUMNS.map((column, columnIndex) => {
          const columnTasks = tasksByColumn[column];
          const isCurrentColumn = columnIndex === focusedColumn;

          return (
            <KanbanColumn
              key={column}
              column={column}
              columnIndex={columnIndex}
              tasks={columnTasks}
              selectedId={selectedId}
              focusedIndexInColumn={isCurrentColumn ? focusedIndexInColumn : null}
              isCurrentColumn={isCurrentColumn}
              changedTaskIds={changedTaskIds}
              childCounts={childCounts}
              externalBlockerCounts={externalBlockerCounts}
              onCardRef={handleCardRef}
              onClick={handleTaskClick}
            />
          );
        })}
      </div>

      {/* Navigation hint */}
      <div className="px-4 py-2 border-t-2 border-border text-xs text-text-dim font-mono flex-shrink-0 uppercase tracking-wider">
        <span className="text-accent">h/l</span> columns{" "}
        <span className="text-accent">j/k</span> navigate{" "}
        <span className="text-accent">Enter</span> select
      </div>
    </div>
  );
}

interface KanbanColumnProps {
  column: StatusVariant;
  columnIndex: number;
  tasks: Task[];
  selectedId: TaskId | null;
  focusedIndexInColumn: number | null;
  isCurrentColumn: boolean;
  changedTaskIds: Set<TaskId>;
  childCounts: Map<TaskId, { total: number; completed: number }>;
  externalBlockerCounts: Map<TaskId, number>;
  onCardRef: (id: TaskId, el: HTMLButtonElement | null) => void;
  onClick: (task: Task, columnIndex: number, taskIndex: number) => void;
}

function KanbanColumn({
  column,
  columnIndex,
  tasks,
  selectedId,
  focusedIndexInColumn,
  isCurrentColumn,
  changedTaskIds,
  childCounts,
  externalBlockerCounts,
  onCardRef,
  onClick,
}: KanbanColumnProps) {
  return (
    <div className="flex-1 min-w-[280px] max-w-[360px] flex flex-col min-h-0">
      {/* Column header */}
      <div
        className={`
          px-3 py-2 mb-2 rounded-none border-2
          ${isCurrentColumn ? "border-accent bg-accent-subtle/30 highlight-bar-active" : "border-border bg-surface-primary"}
        `}
      >
        <div className="flex items-center justify-between">
          <span
            className={`
              text-display-sm text-sm
              ${isCurrentColumn ? "text-accent" : COLUMN_TEXT_COLORS[column]}
            `}
          >
            {COLUMN_LABELS[column]}
          </span>
          <span
            className={`
              text-xs font-mono px-2 py-0.5 rounded-none
              ${isCurrentColumn ? "bg-accent/20 text-accent" : "bg-surface-secondary text-text-dim"}
            `}
          >
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Column content - scroll wrapper */}
      <div className="flex-1 relative min-h-0">
        <div className="absolute inset-0 overflow-y-auto scrollbar-hover overscroll-y-contain">
          {/* Inner content with padding for focus rings + scrollbar clearance */}
          <div className="space-y-2 p-2 pr-4" role="list" aria-label={`${COLUMN_LABELS[column]} tasks`}>
          {tasks.length === 0 ? (
            <div className="text-text-dim text-xs font-mono text-center py-8 opacity-50">
              No tasks
            </div>
          ) : (
            tasks.map((task, taskIndex) => {
              const isFocused = isCurrentColumn && focusedIndexInColumn === taskIndex;
              const isSelected = selectedId === task.id;
              const isChanged = changedTaskIds.has(task.id);

              return (
                <KanbanCard
                  key={task.id}
                  task={task}
                  column={column}
                  columnIndex={columnIndex}
                  taskIndex={taskIndex}
                  isFocused={isFocused}
                  isSelected={isSelected}
                  isChanged={isChanged}
                  childCount={childCounts.get(task.id)}
                  externalBlockerCount={externalBlockerCounts.get(task.id) ?? 0}
                  onRef={onCardRef}
                  onClick={onClick}
                />
              );
            })
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface KanbanCardProps {
  task: Task;
  column: StatusVariant;
  columnIndex: number;
  taskIndex: number;
  isFocused: boolean;
  isSelected: boolean;
  isChanged: boolean;
  childCount?: { total: number; completed: number };
  externalBlockerCount: number;
  onRef: (id: TaskId, el: HTMLButtonElement | null) => void;
  onClick: (task: Task, columnIndex: number, taskIndex: number) => void;
}

function KanbanCard({
  task,
  column,
  columnIndex,
  taskIndex,
  isFocused,
  isSelected,
  isChanged,
  childCount,
  externalBlockerCount,
  onRef,
  onClick,
}: KanbanCardProps) {
  const depthLabel = getDepthLabel(task.depth);
  const hasChildren = childCount !== undefined && childCount.total > 0;

  const handleRef = useCallback(
    (el: HTMLButtonElement | null) => {
      onRef(task.id, el);
    },
    [task.id, onRef]
  );

  return (
    <div role="listitem">
      <button
        ref={handleRef}
        type="button"
        tabIndex={isFocused ? 0 : -1}
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onClick(task, columnIndex, taskIndex)}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary rounded"
      >
      <Card
        selected={isSelected}
        interactive
        brutalist
        highlighted={isSelected}
        className={`
          p-3 
          ${isChanged ? "animate-flash-change" : ""}
        `}
      >
        {/* Type badge + timestamp */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider">
            {depthLabel}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-text-dim">
              {formatRelativeTime(new Date(task.updatedAt))}
            </span>
            <span className="text-[10px] font-mono text-text-dim">
              P{task.priority}
            </span>
          </div>
        </div>

        {/* Description */}
        <div
          className={`
            text-sm font-mono leading-tight mb-2 line-clamp-2
            ${task.completed ? "text-text-muted line-through" : "text-text-primary"}
          `}
        >
          {task.description}
        </div>

        {/* Progress bar for parent tasks */}
        {hasChildren && (
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
              <div 
                aria-hidden="true"
                className="h-full bg-accent transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `${(childCount.completed / childCount.total) * 100}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-text-muted">
              {childCount.completed}/{childCount.total}
            </span>
          </div>
        )}

        {/* Status badge (only for active to show pulsing) */}
        {column === "active" && (
          <div className="flex justify-end">
            <Badge variant="active" pulsing>
              ACTIVE
            </Badge>
          </div>
        )}

        {/* Blocked indicator */}
        {column === "blocked" && (
          <div className="text-[10px] font-mono text-status-blocked mt-1">
            {task.blockedBy && task.blockedBy.length > 0
              ? `Blocked by ${task.blockedBy.length} task${task.blockedBy.length > 1 ? "s" : ""}`
              : "Blocked (inherited)"}
          </div>
        )}

        {/* External blockers badge (shown when filtering by milestone) */}
        {externalBlockerCount > 0 && (
          <div className="mt-1 text-[10px] font-mono text-text-dim">
            +{externalBlockerCount} external
          </div>
        )}
      </Card>
      </button>
    </div>
  );
}
