import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { Task, TaskId } from "../../types.js";
import { Badge } from "./ui/Badge.js";
import { useKeyboardShortcuts } from "../lib/keyboard.js";
import { useKeyboardScope } from "../lib/use-keyboard-scope.js";
import { useChangedTasks } from "../lib/use-changed-tasks.js";
import {
  getStatusVariant,
  getStatusLabel,
  getDepthLabel,
  computeExternalBlockerCounts,
} from "../lib/utils.js";

type FilterType = "all" | "active" | "completed" | "blocked" | "ready";

interface TaskListProps {
  tasks: Task[];
  externalBlockers: Map<TaskId, Task>;
  selectedId: TaskId | null;
  onSelect: (id: TaskId) => void;
}

/**
 * Hierarchical task list with filters, industrial styling, and j/k navigation
 */
export function TaskList({
  tasks,
  externalBlockers,
  selectedId,
  onSelect,
}: TaskListProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  // Track focus by ID (stable across list changes) - index derived from flatVisibleTasks
  const [focusedId, setFocusedId] = useState<TaskId | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<TaskId>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const scopeProps = useKeyboardScope("list");
  const changedTaskIds = useChangedTasks(tasks);

  // Compute external blocker counts using shared utility
  const externalBlockerCounts = useMemo(
    () => computeExternalBlockerCounts(tasks, externalBlockers),
    [tasks, externalBlockers]
  );

  // Toggle collapse state for a task
  const toggleCollapse = useCallback((id: TaskId) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Build parent->children map for hierarchy, sorted by createdAt for consistent ordering
  const tasksByParent = useMemo(() => {
    const map = new Map<TaskId | null, Task[]>();
    for (const task of tasks) {
      const parentId = task.parentId;
      const existing = map.get(parentId) ?? [];
      existing.push(task);
      map.set(parentId, existing);
    }
    // Sort children by priority, then createdAt for consistent ordering
    for (const children of map.values()) {
      children.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.createdAt.localeCompare(b.createdAt);
      });
    }
    return map;
  }, [tasks]);

  // Get all task IDs that match the filter (and their ancestors)
  const visibleTaskIds = useMemo(() => {
    const matchesFilter = (task: Task): boolean => {
      // Use effectivelyBlocked for domain-correct blocked state
      const isBlocked = task.effectivelyBlocked && !task.completed;
      // Ready = workable (not completed, not blocked) - includes both started and not-started
      const isWorkable = !task.completed && !isBlocked;

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
          return isWorkable;
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
  // Respects collapsed state - children of collapsed nodes are not traversed
  const flatVisibleTasks = useMemo(() => {
    const result: Task[] = [];

    function traverse(parentId: TaskId | null): void {
      const children = tasksByParent.get(parentId) ?? [];
      for (const child of children) {
        if (visibleTaskIds.has(child.id)) {
          result.push(child);
          // Only traverse children if this node is not collapsed
          if (!collapsedIds.has(child.id)) {
            traverse(child.id);
          }
        }
      }
    }

    traverse(null);
    return result;
  }, [tasksByParent, visibleTaskIds, collapsedIds]);

  // Precompute taskId -> index map for O(1) lookup in TaskTreeNode
  const indexById = useMemo(
    () => new Map(flatVisibleTasks.map((t, i) => [t.id, i] as const)),
    [flatVisibleTasks]
  );

  // Build task map for ancestor lookup
  const taskMap = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks]
  );

  // Derive focusedIndex from focusedId (ID is stable, index changes with list)
  const focusedIndex = useMemo(() => {
    if (!focusedId) return 0;
    const idx = indexById.get(focusedId);
    return idx ?? 0;
  }, [focusedId, indexById]);

  // Get milestones (depth 0) that are visible - use tasksByParent for consistent ordering
  const visibleMilestones = useMemo(() => {
    const roots = tasksByParent.get(null) ?? [];
    return roots.filter((t) => visibleTaskIds.has(t.id));
  }, [tasksByParent, visibleTaskIds]);

  // Count tasks by filter type for badges
  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let blocked = 0;
    let ready = 0;

    for (const task of tasks) {
      const isBlocked = task.effectivelyBlocked && !task.completed;
      // Ready = workable (not completed, not blocked) - matches filter logic
      const isWorkable = !task.completed && !isBlocked;

      if (task.completed) {
        completed++;
      } else {
        active++;
        if (isBlocked) blocked++;
        if (isWorkable) ready++;
      }
    }

    return { all: tasks.length, active, completed, blocked, ready };
  }, [tasks]);

  // When focused task becomes hidden (e.g., parent collapsed), find closest visible ancestor
  useEffect(() => {
    if (!focusedId) {
      // Initialize focus to first task
      if (flatVisibleTasks.length > 0) {
        const firstTask = flatVisibleTasks[0];
        if (firstTask) setFocusedId(firstTask.id);
      }
      return;
    }
    // If focused task is still visible, nothing to do
    if (indexById.has(focusedId)) return;

    // Find closest visible ancestor
    let current = taskMap.get(focusedId);
    while (current?.parentId) {
      if (indexById.has(current.parentId)) {
        setFocusedId(current.parentId);
        return;
      }
      current = taskMap.get(current.parentId);
    }
    // No visible ancestor found, focus first task
    if (flatVisibleTasks.length > 0) {
      const firstTask = flatVisibleTasks[0];
      if (firstTask) setFocusedId(firstTask.id);
    }
  }, [focusedId, indexById, taskMap, flatVisibleTasks]);

  // Sync focusedId with selectedId when selectedId changes externally
  useEffect(() => {
    if (!selectedId) return;
    if (indexById.has(selectedId)) {
      setFocusedId(selectedId);
    }
  }, [selectedId, indexById]);

  // Scroll focused item into view
  useEffect(() => {
    const el = itemRefs.current.get(focusedIndex);
    if (el) {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
    }
  }, [focusedIndex]);

  // Navigation handlers - move DOM focus for screen reader announcement
  const moveUp = useCallback(() => {
    if (flatVisibleTasks.length === 0) return;
    const currentIdx = focusedId ? indexById.get(focusedId) ?? 0 : 0;
    const nextIdx = Math.max(0, currentIdx - 1);
    const nextTask = flatVisibleTasks[nextIdx];
    if (nextTask) {
      setFocusedId(nextTask.id);
      // Move DOM focus after state update
      setTimeout(() => itemRefs.current.get(nextIdx)?.focus({ preventScroll: true }), 0);
    }
  }, [flatVisibleTasks, focusedId, indexById]);

  const moveDown = useCallback(() => {
    if (flatVisibleTasks.length === 0) return;
    const currentIdx = focusedId ? indexById.get(focusedId) ?? 0 : 0;
    const nextIdx = Math.min(flatVisibleTasks.length - 1, currentIdx + 1);
    const nextTask = flatVisibleTasks[nextIdx];
    if (nextTask) {
      setFocusedId(nextTask.id);
      // Move DOM focus after state update
      setTimeout(() => itemRefs.current.get(nextIdx)?.focus({ preventScroll: true }), 0);
    }
  }, [flatVisibleTasks, focusedId, indexById]);

  const selectFocused = useCallback(() => {
    if (focusedId) {
      onSelect(focusedId);
    }
  }, [focusedId, onSelect]);

  // h key: collapse OR move to parent (matches TaskGraph behavior)
  const collapseFocused = useCallback(() => {
    if (!focusedId) return;
    const task = taskMap.get(focusedId);
    if (!task) return;

    // Get visible children
    const children = (tasksByParent.get(focusedId) ?? []).filter((t) =>
      visibleTaskIds.has(t.id)
    );
    const hasVisibleChildren = children.length > 0;
    const isCollapsed = collapsedIds.has(focusedId);

    // If has children and not collapsed, collapse
    if (hasVisibleChildren && !isCollapsed) {
      toggleCollapse(focusedId);
      return;
    }

    // Otherwise, move to parent
    if (task.parentId && indexById.has(task.parentId)) {
      setFocusedId(task.parentId);
    }
  }, [focusedId, taskMap, tasksByParent, visibleTaskIds, collapsedIds, indexById, toggleCollapse]);

  // l key: expand OR move to first child (matches TaskGraph behavior)
  const expandFocused = useCallback(() => {
    if (!focusedId) return;

    // If collapsed, expand
    if (collapsedIds.has(focusedId)) {
      toggleCollapse(focusedId);
      return;
    }

    // Otherwise, move to first visible child
    const children = (tasksByParent.get(focusedId) ?? []).filter((t) =>
      visibleTaskIds.has(t.id)
    );
    if (children.length > 0) {
      const firstChild = children[0];
      if (firstChild) {
        setFocusedId(firstChild.id);
      }
    }
  }, [focusedId, collapsedIds, tasksByParent, visibleTaskIds, toggleCollapse]);

  // Register keyboard shortcuts (j/k for vim users, arrows for accessibility)
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
        key: "ArrowDown",
        description: "Move down in list",
        scope: "list",
        handler: moveDown,
      },
      {
        key: "ArrowUp",
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
      {
        key: "h",
        description: "Collapse / parent",
        scope: "list",
        handler: collapseFocused,
      },
      {
        key: "l",
        description: "Expand / child",
        scope: "list",
        handler: expandFocused,
      },
      {
        key: "ArrowLeft",
        description: "Collapse / parent",
        scope: "list",
        handler: collapseFocused,
      },
      {
        key: "ArrowRight",
        description: "Expand / child",
        scope: "list",
        handler: expandFocused,
      },
    ],
    [moveDown, moveUp, selectFocused, collapseFocused, expandFocused]
  );

  const filterButtons: { type: FilterType; label: string }[] = [
    { type: "all", label: "ALL" },
    { type: "active", label: "ACTIVE" },
    { type: "completed", label: "DONE" },
    { type: "blocked", label: "BLOCKED" },
    { type: "ready", label: "READY" },
  ];

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-text-muted registration-mark">
        <div className="chevron-lg select-none" aria-hidden="true">&gt;&gt;&gt;&gt;</div>
        <p className="text-display text-2xl text-text-primary">NO TASKS IN STORE</p>
        <p className="text-text-dim text-sm font-mono uppercase tracking-wider">
          Run <span className="text-accent">os task create -d "Your task"</span> to begin
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" {...scopeProps}>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-1 p-2 border-b-2 border-border">
        {filterButtons.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => setFilter(type)}
            aria-pressed={filter === type}
            className={`
              px-2 py-1 text-xs font-mono uppercase tracking-[0.15em] rounded-none border-2
              transition-colors motion-reduce:transition-none
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary
              ${
                filter === type
                  ? "bg-accent text-text-inverse border-accent font-bold"
                  : "bg-surface-primary text-text-muted hover:bg-surface-secondary border-border"
              }
            `}
          >
            {label}
            <span className="ml-1 opacity-70">{counts[type]}</span>
          </button>
        ))}
      </div>

      {/* Task list - uses roving tabindex for keyboard nav */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-2"
        aria-label="Task list"
      >
        {visibleMilestones.length === 0 ? (
          <div className="p-4 text-text-muted text-sm text-center font-mono uppercase">
            No tasks match filter
          </div>
        ) : (
          <div>
            {visibleMilestones.map((milestone, idx) => (
              <TaskTreeNode
                key={milestone.id}
                task={milestone}
                tasksByParent={tasksByParent}
                visibleTaskIds={visibleTaskIds}
                collapsedIds={collapsedIds}
                selectedId={selectedId}
                focusedIndex={focusedIndex}
                indexById={indexById}
                changedTaskIds={changedTaskIds}
                externalBlockerCounts={externalBlockerCounts}
                onSelect={onSelect}
                onFocus={setFocusedId}
                onToggleCollapse={toggleCollapse}
                itemRefs={itemRefs}
                depth={0}
                isLast={idx === visibleMilestones.length - 1}
                ancestorHasMore={[]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Navigation hint */}
      <div className="px-2 py-1 border-t-2 border-border text-xs text-text-dim font-mono uppercase tracking-wider">
        <span className="text-accent">j/k</span> navigate{" "}
        <span className="text-accent">h/l</span> collapse/expand{" "}
        <span className="text-accent">Enter</span> select
      </div>
    </div>
  );
}

interface TaskTreeNodeProps {
  task: Task;
  tasksByParent: Map<TaskId | null, Task[]>;
  visibleTaskIds: Set<TaskId>;
  collapsedIds: Set<TaskId>;
  selectedId: TaskId | null;
  focusedIndex: number;
  indexById: Map<TaskId, number>;
  changedTaskIds: Set<TaskId>;
  externalBlockerCounts: Map<TaskId, number>;
  onSelect: (id: TaskId) => void;
  onFocus: (id: TaskId) => void;
  onToggleCollapse: (id: TaskId) => void;
  itemRefs: React.MutableRefObject<Map<number, HTMLButtonElement>>;
  depth: number;
  /** Whether this is the last sibling at its level */
  isLast: boolean;
  /** Track which ancestor levels have more siblings (for drawing │ lines) */
  ancestorHasMore: boolean[];
}

/**
 * Configuration for CSS-based tree line rendering.
 * Returns data about which lines to draw at each depth level.
 */
interface TreeLineConfig {
  /** Which depth levels need a continuous vertical line (ancestor has more siblings) */
  verticalLines: boolean[];
  /** Is this the last sibling at its level (use └ instead of ├) */
  isLast: boolean;
  /** Depth of this node */
  depth: number;
}

function TaskTreeNode({
  task,
  tasksByParent,
  visibleTaskIds,
  collapsedIds,
  selectedId,
  focusedIndex,
  indexById,
  changedTaskIds,
  externalBlockerCounts,
  onSelect,
  onFocus,
  onToggleCollapse,
  itemRefs,
  depth,
  isLast,
  ancestorHasMore,
}: TaskTreeNodeProps) {
  const children = (tasksByParent.get(task.id) ?? []).filter((t) =>
    visibleTaskIds.has(t.id)
  );
  const taskIndex = indexById.get(task.id) ?? -1;
  const isFocused = taskIndex === focusedIndex;
  const isSelected = selectedId === task.id;
  const isChanged = changedTaskIds.has(task.id);
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedIds.has(task.id);
  
  // Tree line config for CSS-based rendering
  const treeLineConfig: TreeLineConfig = {
    verticalLines: ancestorHasMore,
    isLast,
    depth,
  };

  return (
    <div>
      <TaskItem
        task={task}
        isSelected={isSelected}
        isFocused={isFocused}
        isChanged={isChanged}
        taskIndex={taskIndex}
        hasChildren={hasChildren}
        isCollapsed={isCollapsed}
        externalBlockerCount={externalBlockerCounts.get(task.id) ?? 0}
        onSelect={onSelect}
        onFocus={onFocus}
        onToggleCollapse={onToggleCollapse}
        itemRefs={itemRefs}
        treeLineConfig={treeLineConfig}
      />
      {hasChildren && !isCollapsed && (
        <div>
          {children.map((child, idx) => (
            <TaskTreeNode
              key={child.id}
              task={child}
              tasksByParent={tasksByParent}
              visibleTaskIds={visibleTaskIds}
              collapsedIds={collapsedIds}
              selectedId={selectedId}
              focusedIndex={focusedIndex}
              indexById={indexById}
              changedTaskIds={changedTaskIds}
              externalBlockerCounts={externalBlockerCounts}
              onSelect={onSelect}
              onFocus={onFocus}
              onToggleCollapse={onToggleCollapse}
              itemRefs={itemRefs}
              depth={depth + 1}
              isLast={idx === children.length - 1}
              ancestorHasMore={[...ancestorHasMore, !isLast]}
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
  isChanged: boolean;
  taskIndex: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  externalBlockerCount: number;
  onSelect: (id: TaskId) => void;
  onFocus: (id: TaskId) => void;
  onToggleCollapse: (id: TaskId) => void;
  itemRefs: React.MutableRefObject<Map<number, HTMLButtonElement>>;
  treeLineConfig: TreeLineConfig;
}

/** Width of each indent level in pixels (4 characters at ~8px each) */
const INDENT_WIDTH = 32;
/** Horizontal offset for the branch line start */
const BRANCH_OFFSET = 12;

function TaskItem({
  task,
  isSelected,
  isFocused,
  isChanged,
  taskIndex,
  hasChildren,
  isCollapsed,
  externalBlockerCount,
  onSelect,
  onFocus,
  onToggleCollapse,
  itemRefs,
  treeLineConfig,
}: TaskItemProps) {
  const { isLast, verticalLines, depth } = treeLineConfig;
  const statusVariant = getStatusVariant(task);
  const statusLabel = getStatusLabel(task);
  const depthLabel = getDepthLabel(task.depth);

  const handleRef = useCallback(
    (el: HTMLButtonElement | null) => {
      if (el) {
        itemRefs.current.set(taskIndex, el);
      } else {
        itemRefs.current.delete(taskIndex);
      }
    },
    [taskIndex]
  );

  const handleToggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleCollapse(task.id);
    },
    [onToggleCollapse, task.id]
  );

  // Calculate total indent width for the tree prefix area
  const treeWidth = depth > 0 ? depth * INDENT_WIDTH : 0;

  return (
    <button
      ref={handleRef}
      type="button"
      tabIndex={isFocused ? 0 : -1}
      aria-current={isSelected ? "true" : undefined}
      onClick={() => onSelect(task.id)}
      onMouseEnter={() => onFocus(task.id)}
      className={`
        relative w-full text-left py-1 px-2 transition-colors motion-reduce:transition-none
        ${isSelected ? "bg-surface-secondary ring-2 ring-inset ring-accent highlight-bar-active" : "hover:bg-surface-primary"}
        ${isChanged ? "animate-flash-change-transparent" : ""}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent
      `}
    >
      {/* CSS-based tree lines - positioned absolutely to span full row height */}
      {depth > 0 && (
        <div 
          className="absolute left-2 top-0 bottom-0 pointer-events-none"
          style={{ width: treeWidth + BRANCH_OFFSET }}
          aria-hidden="true"
        >
          {/* Vertical continuation lines for ancestors that have more siblings */}
          {/* verticalLines[i] = whether ancestor at depth i has more siblings */}
          {/* Draw at position (i-1)*INDENT to show continuation at that ancestor's branch point */}
          {verticalLines.slice(1, depth).map((hasMore, i) =>
            hasMore ? (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-text-dim"
                style={{ left: i * INDENT_WIDTH + BRANCH_OFFSET }}
              />
            ) : null
          )}
          {/* Vertical line for current level - extends from top to center (or bottom if not last) */}
          <div
            className="absolute w-px bg-text-dim"
            style={{
              left: (depth - 1) * INDENT_WIDTH + BRANCH_OFFSET,
              top: 0,
              bottom: isLast ? "50%" : 0,
            }}
          />
          {/* Horizontal branch line from vertical toward chevron (with small gap) */}
          <div
            className="absolute h-px bg-text-dim"
            style={{
              left: (depth - 1) * INDENT_WIDTH + BRANCH_OFFSET,
              right: 6,
              top: "50%",
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Spacer for tree indent + chevron area - chevron centered at treeWidth + BRANCH_OFFSET */}
        <span
          className="flex-shrink-0 flex items-center justify-end"
          style={{ width: treeWidth + BRANCH_OFFSET + 8 }}
        >
          <span
            className={`
              inline-flex items-center justify-center w-4 h-4 text-text-dim text-sm
              ${hasChildren ? "cursor-pointer hover:text-text-muted" : ""}
            `}
            onClick={hasChildren ? handleToggleCollapse : undefined}
            role={hasChildren ? "button" : undefined}
            tabIndex={hasChildren ? -1 : undefined}
            aria-label={hasChildren ? (isCollapsed ? "Expand subtree" : "Collapse subtree") : undefined}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
          >
            {hasChildren ? (isCollapsed ? "▸" : "▾") : null}
          </span>
        </span>

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
        <Badge variant={statusVariant} pulsing={statusVariant === "active"}>
          {statusLabel}
        </Badge>

        {/* External blockers badge (shown when filtering by milestone) */}
        {externalBlockerCount > 0 && (
          <span className="text-[10px] font-mono text-text-dim">
            +{externalBlockerCount} external
          </span>
        )}

        {/* Priority */}
        <span className="text-xs font-mono text-text-dim">P{task.priority}</span>
      </div>
    </button>
  );
}
