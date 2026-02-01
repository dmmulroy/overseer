import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { Task, TaskId } from "../../types.js";
import { Badge } from "./ui/Badge.js";
import { useKeyboardShortcuts, useKeyboardContext } from "../lib/keyboard.js";

type FilterType = "all" | "active" | "completed" | "blocked" | "ready";

interface TaskListProps {
  tasks: Task[];
  selectedId: TaskId | null;
  onSelect: (id: TaskId) => void;
}

/**
 * Get the technical label for a task based on depth
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

/**
 * Get the status variant for the Badge component
 */
function getStatusVariant(
  task: Task
): "pending" | "active" | "blocked" | "done" {
  if (task.completed) return "done";
  const isBlocked = (task.blockedBy?.length ?? 0) > 0;
  if (isBlocked) return "blocked";
  if (task.startedAt !== null) return "active";
  return "pending";
}

/**
 * Get human-readable status label
 */
function getStatusLabel(task: Task): string {
  if (task.completed) return "DONE";
  const isBlocked = (task.blockedBy?.length ?? 0) > 0;
  if (isBlocked) return "BLOCKED";
  if (task.startedAt !== null) return "ACTIVE";
  return "PENDING";
}

/**
 * Hierarchical task list with filters, industrial styling, and j/k navigation
 */
export function TaskList({ tasks, selectedId, onSelect }: TaskListProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const { setActiveScope } = useKeyboardContext();

  // Build parent->children map for hierarchy
  const tasksByParent = useMemo(() => {
    const map = new Map<TaskId | null, Task[]>();
    for (const task of tasks) {
      const parentId = task.parentId;
      const existing = map.get(parentId) ?? [];
      existing.push(task);
      map.set(parentId, existing);
    }
    return map;
  }, [tasks]);

  // Get all task IDs that match the filter (and their ancestors)
  const visibleTaskIds = useMemo(() => {
    const matchesFilter = (task: Task): boolean => {
      const isBlocked = (task.blockedBy?.length ?? 0) > 0 && !task.completed;
      const isReady = !task.completed && !isBlocked && !task.startedAt;

      switch (filter) {
        case "all":
          return true;
        case "active":
          return !task.completed;
        case "completed":
          return task.completed;
        case "blocked":
          return isBlocked;
        case "ready":
          return isReady || (task.startedAt !== null && !task.completed);
      }
    };

    // Find all tasks that match filter
    const matching = new Set<TaskId>();
    for (const task of tasks) {
      if (matchesFilter(task)) {
        matching.add(task.id);
      }
    }

    // Add ancestors of matching tasks (so hierarchy is visible)
    const taskMap = new Map<TaskId, Task>(tasks.map((t) => [t.id, t]));
    const withAncestors = new Set<TaskId>(matching);

    for (const id of matching) {
      let current = taskMap.get(id);
      while (current?.parentId) {
        withAncestors.add(current.parentId);
        current = taskMap.get(current.parentId);
      }
    }

    return withAncestors;
  }, [tasks, filter]);

  // Build flat list of visible tasks in tree order for keyboard navigation
  const flatVisibleTasks = useMemo(() => {
    const result: Task[] = [];

    function traverse(parentId: TaskId | null): void {
      const children = tasksByParent.get(parentId) ?? [];
      for (const child of children) {
        if (visibleTaskIds.has(child.id)) {
          result.push(child);
          traverse(child.id);
        }
      }
    }

    traverse(null);
    return result;
  }, [tasksByParent, visibleTaskIds]);

  // Get milestones (depth 0) that are visible
  const visibleMilestones = useMemo(() => {
    return tasks.filter((t) => t.depth === 0 && visibleTaskIds.has(t.id));
  }, [tasks, visibleTaskIds]);

  // Count tasks by filter type for badges
  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let blocked = 0;
    let ready = 0;

    for (const task of tasks) {
      const isBlocked = (task.blockedBy?.length ?? 0) > 0 && !task.completed;
      const isReadyOrInProgress =
        !task.completed && (!isBlocked || task.startedAt !== null);

      if (task.completed) {
        completed++;
      } else {
        active++;
        if (isBlocked) blocked++;
        if (isReadyOrInProgress) ready++;
      }
    }

    return { all: tasks.length, active, completed, blocked, ready };
  }, [tasks]);

  // Keep focusedIndex in bounds when list changes
  useEffect(() => {
    if (flatVisibleTasks.length === 0) {
      setFocusedIndex(0);
    } else if (focusedIndex >= flatVisibleTasks.length) {
      setFocusedIndex(flatVisibleTasks.length - 1);
    }
  }, [flatVisibleTasks.length, focusedIndex]);

  // Sync focusedIndex with selectedId when selectedId changes externally
  useEffect(() => {
    if (selectedId) {
      const idx = flatVisibleTasks.findIndex((t) => t.id === selectedId);
      if (idx !== -1 && idx !== focusedIndex) {
        setFocusedIndex(idx);
      }
    }
  }, [selectedId, flatVisibleTasks, focusedIndex]);

  // Scroll focused item into view
  useEffect(() => {
    const el = itemRefs.current.get(focusedIndex);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusedIndex]);

  // Navigation handlers
  const moveUp = useCallback(() => {
    setFocusedIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const moveDown = useCallback(() => {
    setFocusedIndex((prev) =>
      Math.min(flatVisibleTasks.length - 1, prev + 1)
    );
  }, [flatVisibleTasks.length]);

  const selectFocused = useCallback(() => {
    const task = flatVisibleTasks[focusedIndex];
    if (task) {
      onSelect(task.id);
    }
  }, [flatVisibleTasks, focusedIndex, onSelect]);

  // Register keyboard shortcuts
  useKeyboardShortcuts(
    () => [
      {
        key: "j",
        description: "Move down in list",
        scope: "list",
        handler: moveDown,
      },
      {
        key: "k",
        description: "Move up in list",
        scope: "list",
        handler: moveUp,
      },
      {
        key: "Enter",
        description: "Select focused task",
        scope: "list",
        handler: selectFocused,
      },
    ],
    [moveDown, moveUp, selectFocused]
  );

  // Set active scope when list is rendered
  useEffect(() => {
    setActiveScope("list");
    return () => setActiveScope("global");
  }, [setActiveScope]);

  const filterButtons: { type: FilterType; label: string }[] = [
    { type: "all", label: "ALL" },
    { type: "active", label: "ACTIVE" },
    { type: "completed", label: "DONE" },
    { type: "blocked", label: "BLOCKED" },
    { type: "ready", label: "READY" },
  ];

  if (tasks.length === 0) {
    return (
      <div className="p-4 text-text-muted text-sm font-mono">
        NO TASKS FOUND
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-border">
        {filterButtons.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => setFilter(type)}
            aria-pressed={filter === type}
            className={`
              px-2 py-1 text-xs font-mono uppercase tracking-wider rounded 
              transition-colors motion-reduce:transition-none
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary
              ${
                filter === type
                  ? "bg-accent text-bg-primary"
                  : "bg-surface-primary text-text-muted hover:bg-surface-secondary"
              }
            `}
          >
            {label}
            <span className="ml-1 opacity-70">{counts[type]}</span>
          </button>
        ))}
      </div>

      {/* Task list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-2"
        role="listbox"
        aria-label="Task list"
      >
        {visibleMilestones.length === 0 ? (
          <div className="p-4 text-text-muted text-sm text-center font-mono uppercase">
            No tasks match filter
          </div>
        ) : (
          <div className="space-y-0.5">
            {visibleMilestones.map((milestone) => (
              <TaskTreeNode
                key={milestone.id}
                task={milestone}
                tasksByParent={tasksByParent}
                visibleTaskIds={visibleTaskIds}
                selectedId={selectedId}
                focusedIndex={focusedIndex}
                flatVisibleTasks={flatVisibleTasks}
                onSelect={onSelect}
                onFocus={setFocusedIndex}
                itemRefs={itemRefs}
                depth={0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Navigation hint */}
      <div className="px-2 py-1 border-t border-border text-xs text-text-dim font-mono">
        <span className="opacity-70">j/k</span> navigate{" "}
        <span className="opacity-70">Enter</span> select
      </div>
    </div>
  );
}

interface TaskTreeNodeProps {
  task: Task;
  tasksByParent: Map<TaskId | null, Task[]>;
  visibleTaskIds: Set<TaskId>;
  selectedId: TaskId | null;
  focusedIndex: number;
  flatVisibleTasks: Task[];
  onSelect: (id: TaskId) => void;
  onFocus: (index: number) => void;
  itemRefs: React.MutableRefObject<Map<number, HTMLButtonElement>>;
  depth: number;
}

function TaskTreeNode({
  task,
  tasksByParent,
  visibleTaskIds,
  selectedId,
  focusedIndex,
  flatVisibleTasks,
  onSelect,
  onFocus,
  itemRefs,
  depth,
}: TaskTreeNodeProps) {
  const children = (tasksByParent.get(task.id) ?? []).filter((t) =>
    visibleTaskIds.has(t.id)
  );
  const taskIndex = flatVisibleTasks.findIndex((t) => t.id === task.id);
  const isFocused = taskIndex === focusedIndex;
  const isSelected = selectedId === task.id;

  return (
    <div>
      <TaskItem
        task={task}
        isSelected={isSelected}
        isFocused={isFocused}
        taskIndex={taskIndex}
        onSelect={onSelect}
        onFocus={onFocus}
        itemRefs={itemRefs}
        depth={depth}
      />
      {children.length > 0 && (
        <div className="ml-4 pl-3 border-l border-border">
          {children.map((child) => (
            <TaskTreeNode
              key={child.id}
              task={child}
              tasksByParent={tasksByParent}
              visibleTaskIds={visibleTaskIds}
              selectedId={selectedId}
              focusedIndex={focusedIndex}
              flatVisibleTasks={flatVisibleTasks}
              onSelect={onSelect}
              onFocus={onFocus}
              itemRefs={itemRefs}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TaskItemProps {
  task: Task;
  isSelected: boolean;
  isFocused: boolean;
  taskIndex: number;
  onSelect: (id: TaskId) => void;
  onFocus: (index: number) => void;
  itemRefs: React.MutableRefObject<Map<number, HTMLButtonElement>>;
  depth: number;
}

function TaskItem({
  task,
  isSelected,
  isFocused,
  taskIndex,
  onSelect,
  onFocus,
  itemRefs,
  depth,
}: TaskItemProps) {
  const statusVariant = getStatusVariant(task);
  const statusLabel = getStatusLabel(task);
  const depthLabel = getDepthLabel(depth);

  const handleRef = useCallback(
    (el: HTMLButtonElement | null) => {
      if (el) {
        itemRefs.current.set(taskIndex, el);
      } else {
        itemRefs.current.delete(taskIndex);
      }
    },
    [itemRefs, taskIndex]
  );

  return (
    <button
      ref={handleRef}
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(task.id)}
      onMouseEnter={() => onFocus(taskIndex)}
      className={`
        w-full text-left p-2 rounded transition-colors motion-reduce:transition-none
        ${isSelected ? "bg-surface-secondary" : "hover:bg-surface-primary"}
        ${isFocused ? "ring-2 ring-accent ring-offset-1 ring-offset-bg-primary" : ""}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary
      `}
    >
      <div className="flex items-center gap-2">
        {/* Type label */}
        <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider w-16 flex-shrink-0">
          {depthLabel}
        </span>

        {/* Description */}
        <span
          className={`
            text-sm font-mono truncate flex-1
            ${task.completed ? "text-text-muted line-through" : "text-text-primary"}
          `}
        >
          {task.description}
        </span>

        {/* Status badge */}
        <Badge variant={statusVariant} aria-label={`Status: ${statusLabel}`}>
          {statusLabel}
        </Badge>

        {/* Priority */}
        <span className="text-xs font-mono text-text-dim">P{task.priority}</span>
      </div>
    </button>
  );
}
