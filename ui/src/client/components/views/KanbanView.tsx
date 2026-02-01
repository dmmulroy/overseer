/**
 * Kanban view - 4-column board grouped by task status.
 * Columns: PENDING | ACTIVE | BLOCKED | DONE
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

type StatusColumn = "pending" | "active" | "blocked" | "done";

const COLUMNS: StatusColumn[] = ["pending", "active", "blocked", "done"];

const COLUMN_LABELS: Record<StatusColumn, string> = {
  pending: "PENDING",
  active: "ACTIVE",
  blocked: "BLOCKED",
  done: "DONE",
};

/** Static text color classes for each column (Tailwind can't detect dynamic classes) */
const COLUMN_TEXT_COLORS: Record<StatusColumn, string> = {
  pending: "text-status-pending",
  active: "text-status-active",
  blocked: "text-status-blocked",
  done: "text-status-done",
};

interface KanbanViewProps {
  tasks: Task[];
  selectedId: TaskId | null;
  onSelect: (id: TaskId) => void;
}

/**
 * Determine which column a task belongs to based on its status.
 */
function getTaskColumn(task: Task): StatusColumn {
  if (task.completed) return "done";
  const isBlocked = (task.blockedBy?.length ?? 0) > 0;
  if (isBlocked) return "blocked";
  if (task.startedAt !== null) return "active";
  return "pending";
}

/**
 * Get depth label for task card
 */
function getDepthLabel(depth: number): string {
  switch (depth) {
    case 0:
      return "MILESTONE";
    case 1:
      return "TASK";
    case 2:
      return "SUBTASK";
    default:
      return "SUBTASK";
  }
}

export function KanbanView({ tasks, selectedId, onSelect }: KanbanViewProps) {
  const scopeProps = useKeyboardScope("kanban", { activateOnMount: true });
  const changedTaskIds = useChangedTasks(tasks);
  
  // Focus state: [columnIndex, taskIndexInColumn]
  const [focusedColumn, setFocusedColumn] = useState(0);
  const [focusedIndexInColumn, setFocusedIndexInColumn] = useState(0);
  
  // Refs for focus management
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Group tasks by status column
  const tasksByColumn = useMemo(() => {
    const grouped: Record<StatusColumn, Task[]> = {
      pending: [],
      active: [],
      blocked: [],
      done: [],
    };

    for (const task of tasks) {
      const column = getTaskColumn(task);
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
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
    const nextCol = Math.max(0, focusedColumn - 1);
    const col = COLUMNS[nextCol];
    const nextColumnTasks = col ? tasksByColumn[col] : [];
    
    setFocusedColumn(nextCol);
    if (nextColumnTasks.length > 0) {
      setFocusedIndexInColumn((prevIdx) => 
        Math.min(prevIdx, nextColumnTasks.length - 1)
      );
    }
  }, [focusedColumn, tasksByColumn]);

  const moveRight = useCallback(() => {
    const nextCol = Math.min(COLUMNS.length - 1, focusedColumn + 1);
    const col = COLUMNS[nextCol];
    const nextColumnTasks = col ? tasksByColumn[col] : [];
    
    setFocusedColumn(nextCol);
    if (nextColumnTasks.length > 0) {
      setFocusedIndexInColumn((prevIdx) => 
        Math.min(prevIdx, nextColumnTasks.length - 1)
      );
    }
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

  const handleTaskFocus = useCallback((columnIndex: number, taskIndex: number) => {
    setFocusedColumn(columnIndex);
    setFocusedIndexInColumn(taskIndex);
  }, []);

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted p-8">
        <div className="text-center font-mono">NO TASKS FOUND</div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col bg-bg-primary overflow-hidden"
      {...scopeProps}
    >
      {/* Column container */}
      <div className="flex-1 flex gap-3 p-4 overflow-x-auto min-h-0">
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
              onCardRef={handleCardRef}
              onClick={handleTaskClick}
              onFocus={handleTaskFocus}
            />
          );
        })}
      </div>

      {/* Navigation hint */}
      <div className="px-4 py-2 border-t border-border text-xs text-text-dim font-mono flex-shrink-0">
        <span className="opacity-70">h/l</span> columns{" "}
        <span className="opacity-70">j/k</span> navigate{" "}
        <span className="opacity-70">Enter</span> select
      </div>
    </div>
  );
}

interface KanbanColumnProps {
  column: StatusColumn;
  columnIndex: number;
  tasks: Task[];
  selectedId: TaskId | null;
  focusedIndexInColumn: number | null;
  isCurrentColumn: boolean;
  changedTaskIds: Set<TaskId>;
  onCardRef: (id: TaskId, el: HTMLButtonElement | null) => void;
  onClick: (task: Task, columnIndex: number, taskIndex: number) => void;
  onFocus: (columnIndex: number, taskIndex: number) => void;
}

function KanbanColumn({
  column,
  columnIndex,
  tasks,
  selectedId,
  focusedIndexInColumn,
  isCurrentColumn,
  changedTaskIds,
  onCardRef,
  onClick,
  onFocus,
}: KanbanColumnProps) {
  return (
    <div className="flex-1 min-w-[280px] max-w-[360px] flex flex-col min-h-0">
      {/* Column header */}
      <div
        className={`
          px-3 py-2 mb-2 rounded border
          ${isCurrentColumn ? "border-accent bg-accent-subtle/30" : "border-border bg-surface-primary"}
        `}
      >
        <div className="flex items-center justify-between">
          <span
            className={`
              text-xs font-mono uppercase tracking-wider
              ${isCurrentColumn ? "text-accent" : COLUMN_TEXT_COLORS[column]}
            `}
          >
            {COLUMN_LABELS[column]}
          </span>
          <span
            className={`
              text-xs font-mono px-2 py-0.5 rounded
              ${isCurrentColumn ? "bg-accent/20 text-accent" : "bg-surface-secondary text-text-dim"}
            `}
          >
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Column content */}
      <div className="flex-1 overflow-y-auto space-y-2" role="list" aria-label={`${COLUMN_LABELS[column]} tasks`}>
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
                onRef={onCardRef}
                onClick={onClick}
                onFocus={onFocus}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

interface KanbanCardProps {
  task: Task;
  column: StatusColumn;
  columnIndex: number;
  taskIndex: number;
  isFocused: boolean;
  isSelected: boolean;
  isChanged: boolean;
  onRef: (id: TaskId, el: HTMLButtonElement | null) => void;
  onClick: (task: Task, columnIndex: number, taskIndex: number) => void;
  onFocus: (columnIndex: number, taskIndex: number) => void;
}

function KanbanCard({
  task,
  column,
  columnIndex,
  taskIndex,
  isFocused,
  isSelected,
  isChanged,
  onRef,
  onClick,
  onFocus,
}: KanbanCardProps) {
  const depthLabel = getDepthLabel(task.depth);

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
        onMouseEnter={() => onFocus(columnIndex, taskIndex)}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary rounded"
      >
      <Card
        selected={isSelected}
        interactive
        className={`
          p-3 
          ${isChanged ? "animate-flash-change" : ""}
        `}
      >
        {/* Type badge */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider">
            {depthLabel}
          </span>
          <span className="text-[10px] font-mono text-text-dim">
            P{task.priority}
          </span>
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

        {/* Status badge (only for active to show pulsing) */}
        {column === "active" && (
          <div className="flex justify-end">
            <Badge variant="active" pulsing>
              ACTIVE
            </Badge>
          </div>
        )}

        {/* Blocked indicator */}
        {column === "blocked" && task.blockedBy && task.blockedBy.length > 0 && (
          <div className="text-[10px] font-mono text-status-blocked mt-1">
            Blocked by {task.blockedBy.length} task{task.blockedBy.length > 1 ? "s" : ""}
          </div>
        )}
      </Card>
      </button>
    </div>
  );
}
