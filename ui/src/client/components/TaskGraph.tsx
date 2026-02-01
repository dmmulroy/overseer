import { useState, useMemo, useCallback, memo, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
  Handle,
  Position,
  BackgroundVariant,
  useReactFlow,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type { Task, TaskId } from "../../types.js";
import { useKeyboardShortcuts } from "../lib/keyboard.js";
import { useKeyboardScope } from "../lib/use-keyboard-scope.js";
import { Badge } from "./ui/Badge.js";

import "@xyflow/react/dist/style.css";

// Node dimensions - slightly larger for industrial style
const NODE_WIDTH = 300;
const NODE_HEIGHT = 90;
const NODE_HEIGHT_COLLAPSED = 70;

// Edge data with typed kind
interface TaskEdgeData extends Record<string, unknown> {
  kind: "parent" | "blocker";
  label?: string;
}

// Custom data for task nodes - needs index signature for xyflow
interface TaskNodeData extends Record<string, unknown> {
  task: Task;
  childCount: number;
  completedChildCount: number;
  isCollapsed: boolean;
  hiddenDescendantCount: number;
  isFocused: boolean;
  onToggleCollapse: (id: TaskId) => void;
}

type TaskNode = Node<TaskNodeData, "task">;
type TaskEdge = Edge<TaskEdgeData>;

/** Type guard for TaskNodeData */
function isTaskNodeData(data: unknown): data is TaskNodeData {
  return (
    data !== null &&
    typeof data === "object" &&
    "task" in data &&
    "childCount" in data
  );
}

interface TaskGraphProps {
  tasks: Task[];
  selectedId: TaskId | null;
  onSelect: (id: TaskId) => void;
  showBlockers?: boolean;
}

// Virtual root node ID (not rendered)
const VIRTUAL_ROOT_ID = "__root__";

/**
 * Apply dagre layout to nodes and edges.
 * Uses LR (left-to-right) layout: milestones on left, tasks in middle, subtasks on right.
 * Siblings stack vertically, making tree structure clear.
 */
function getLayoutedElements(
  nodes: TaskNode[],
  edges: TaskEdge[]
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: "LR", // Left-to-right: shows hierarchy horizontally
    nodesep: 24, // Vertical spacing between siblings
    ranksep: 80, // Horizontal spacing between hierarchy levels
    marginx: 24,
    marginy: 24,
  });

  // Find milestone nodes (depth 0, no parent)
  const milestones = nodes.filter((n) => n.data.task.depth === 0);

  // Add virtual root to connect all milestones (creates single connected graph)
  if (milestones.length > 1) {
    dagreGraph.setNode(VIRTUAL_ROOT_ID, { width: 0, height: 0 });
  }

  // Add all task nodes with appropriate height
  nodes.forEach((node) => {
    const height =
      node.data.isCollapsed && node.data.hiddenDescendantCount > 0
        ? NODE_HEIGHT_COLLAPSED
        : NODE_HEIGHT;
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height });
  });

  // Connect virtual root to all milestones
  if (milestones.length > 1) {
    milestones.forEach((m) => {
      dagreGraph.setEdge(VIRTUAL_ROOT_ID, m.id, { weight: 0, minlen: 1 });
    });
  }

  // Add parent edges for layout (not blocker edges)
  edges
    .filter((edge) => edge.data?.kind === "parent")
    .forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target, { weight: 1, minlen: 1 });
    });

  dagre.layout(dagreGraph);

  // Get virtual root position to offset all nodes
  const rootNode =
    milestones.length > 1 ? dagreGraph.node(VIRTUAL_ROOT_ID) : null;
  const xOffset = rootNode ? rootNode.x + 50 : 0;

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const height =
      node.data.isCollapsed && node.data.hiddenDescendantCount > 0
        ? NODE_HEIGHT_COLLAPSED
        : NODE_HEIGHT;
    return {
      ...node,
      // LR layout: handles on left/right instead of top/bottom
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2 - xOffset,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Get all descendant task IDs for a given task
 */
function getDescendantIds(
  taskId: TaskId,
  childrenMap: Map<TaskId, TaskId[]>
): Set<TaskId> {
  const descendants = new Set<TaskId>();
  const stack = [...(childrenMap.get(taskId) ?? [])];

  let id = stack.pop();
  while (id !== undefined) {
    descendants.add(id);
    const children = childrenMap.get(id) ?? [];
    stack.push(...children);
    id = stack.pop();
  }

  return descendants;
}

/**
 * Build nodes and edges from tasks, respecting collapsed state.
 * NOTE: focusedId and onToggleCollapse are applied separately to avoid
 * expensive dagre re-layout on every focus change.
 */
function buildGraphElements(
  tasks: Task[],
  collapsedIds: Set<TaskId>
): {
  nodes: TaskNode[];
  edges: TaskEdge[];
} {
  // Build lookup maps
  const childrenMap = new Map<TaskId, TaskId[]>();

  for (const task of tasks) {
    if (task.parentId) {
      const siblings = childrenMap.get(task.parentId) ?? [];
      siblings.push(task.id);
      childrenMap.set(task.parentId, siblings);
    }
  }

  // Find all hidden task IDs (descendants of collapsed nodes)
  const hiddenIds = new Set<TaskId>();
  for (const collapsedId of collapsedIds) {
    const descendants = getDescendantIds(collapsedId, childrenMap);
    for (const id of descendants) {
      hiddenIds.add(id);
    }
  }

  // Count hidden descendants for each collapsed node
  const hiddenDescendantCounts = new Map<TaskId, number>();
  for (const collapsedId of collapsedIds) {
    const descendants = getDescendantIds(collapsedId, childrenMap);
    hiddenDescendantCounts.set(collapsedId, descendants.size);
  }

  // Filter to visible tasks only
  const visibleTasks = tasks.filter((t) => !hiddenIds.has(t.id));

  // Build child count map and completed child count map
  const childCounts = new Map<TaskId, number>();
  const completedChildCounts = new Map<TaskId, number>();
  for (const task of tasks) {
    if (task.parentId) {
      childCounts.set(task.parentId, (childCounts.get(task.parentId) ?? 0) + 1);
      if (task.completed) {
        completedChildCounts.set(
          task.parentId,
          (completedChildCounts.get(task.parentId) ?? 0) + 1
        );
      }
    }
  }

  // Create nodes for visible tasks (isFocused and onToggleCollapse applied later)
  const nodes: TaskNode[] = visibleTasks.map((task) => ({
    id: task.id,
    type: "task",
    position: { x: 0, y: 0 }, // Will be set by dagre
    data: {
      task,
      childCount: childCounts.get(task.id) ?? 0,
      completedChildCount: completedChildCounts.get(task.id) ?? 0,
      isCollapsed: collapsedIds.has(task.id),
      hiddenDescendantCount: hiddenDescendantCounts.get(task.id) ?? 0,
      isFocused: false, // Applied in separate memo
      onToggleCollapse: () => {}, // Applied in separate memo
    },
  }));

  // Create edges for visible tasks only
  const edges: TaskEdge[] = [];
  const visibleIds = new Set(visibleTasks.map((t) => t.id));
  const blockerEdgeIds = new Set<string>();

  for (const task of visibleTasks) {
    // Parent → child edges (solid, muted)
    if (task.parentId && visibleIds.has(task.parentId)) {
      edges.push({
        id: `parent-${task.parentId}-${task.id}`,
        source: task.parentId,
        target: task.id,
        type: "smoothstep",
        style: {
          stroke: "var(--color-text-dim)",
          strokeWidth: 2,
        },
        data: { kind: "parent" },
      });
    }

    // BlockedBy edges (dashed, animated, accent color) - blocker → blocked
    if (task.blockedBy) {
      for (const blockerId of task.blockedBy) {
        if (visibleIds.has(blockerId)) {
          const edgeId = `blocker-${blockerId}-${task.id}`;
          if (!blockerEdgeIds.has(edgeId)) {
            blockerEdgeIds.add(edgeId);
            edges.push({
              id: edgeId,
              source: blockerId,
              target: task.id,
              type: "straight",
              className: "graph-edge-blocker",
              style: {
                stroke: "var(--color-status-blocked)",
                strokeWidth: 2,
                strokeDasharray: "6,4",
              },
              data: { kind: "blocker", label: "blocks" },
            });
          }
        }
      }
    }

    // Blocks edges (same direction: blocker → blocked) - dedupe with blockedBy
    if (task.blocks) {
      for (const blockedId of task.blocks) {
        if (visibleIds.has(blockedId)) {
          const edgeId = `blocker-${task.id}-${blockedId}`;
          if (!blockerEdgeIds.has(edgeId)) {
            blockerEdgeIds.add(edgeId);
            edges.push({
              id: edgeId,
              source: task.id,
              target: blockedId,
              type: "straight",
              className: "graph-edge-blocker",
              style: {
                stroke: "var(--color-status-blocked)",
                strokeWidth: 2,
                strokeDasharray: "6,4",
              },
              data: { kind: "blocker", label: "blocks" },
            });
          }
        }
      }
    }
  }

  return getLayoutedElements(nodes, edges);
}

/**
 * Get status variant for Badge component
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
 * Custom task node component - industrial card style
 */
const TaskNodeComponent = memo(function TaskNodeComponent({
  data,
  selected,
}: NodeProps<TaskNode>) {
  const {
    task,
    childCount,
    completedChildCount,
    isCollapsed,
    hiddenDescendantCount,
    isFocused,
    onToggleCollapse,
  } = data;

  const isInProgress = task.startedAt !== null && !task.completed;
  const hasChildren = childCount > 0;

  const depthLabel =
    task.depth === 0 ? "MILESTONE" : task.depth === 1 ? "TASK" : "SUBTASK";
  const statusVariant = getStatusVariant(task);
  const statusLabel = getStatusLabel(task);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Don't trigger node selection
      onToggleCollapse(task.id);
    },
    [onToggleCollapse, task.id]
  );

  return (
    <>
      {/* LR layout: target handle on left, source on right */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        className={`
          border p-3 transition-colors motion-reduce:transition-none
          bg-surface-primary
          ${
            selected
              ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]"
              : isFocused
                ? "border-accent/60"
                : "border-border hover:border-border-hover"
          }
        `}
        style={{ width: NODE_WIDTH }}
        data-task-id={task.id}
      >
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            {/* Collapse/expand button for nodes with children */}
            {hasChildren && (
              <button
                onClick={handleToggle}
                className="w-5 h-5 flex items-center justify-center hover:bg-surface-secondary text-text-muted hover:text-text-primary transition-colors motion-reduce:transition-none"
                title={isCollapsed ? "Expand (→)" : "Collapse (←)"}
                aria-label={isCollapsed ? "Expand" : "Collapse"}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className={`transition-transform motion-reduce:transition-none ${isCollapsed ? "" : "rotate-90"}`}
                  aria-hidden="true"
                >
                  <path
                    d="M4 2L8 6L4 10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            {/* Status indicator with pulsing animation for active */}
            <span
              className={`
                w-2.5 h-2.5 rounded-full flex-shrink-0
                ${isInProgress ? "animate-pulse-active motion-reduce:animate-none" : ""}
              `}
              style={{
                backgroundColor:
                  statusVariant === "done"
                    ? "var(--color-status-done)"
                    : statusVariant === "blocked"
                      ? "var(--color-status-blocked)"
                      : statusVariant === "active"
                        ? "var(--color-status-active)"
                        : "var(--color-status-pending)",
              }}
              aria-hidden="true"
            />
            {/* Depth label */}
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              {depthLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Priority */}
            <span className="text-[10px] font-mono text-text-dim">
              P{task.priority}
            </span>
          </div>
        </div>

        {/* Description */}
        <p
          className={`
            text-sm font-mono line-clamp-2 leading-tight mb-2
            ${task.completed ? "text-text-muted line-through" : "text-text-primary"}
          `}
        >
          {task.description}
        </p>

        {/* Footer: Status badge + Progress indicator */}
        <div className="flex items-center justify-between">
          <Badge variant={statusVariant} pulsing={statusVariant === "active"}>{statusLabel}</Badge>

          {/* Progress indicator for parent tasks */}
          {hasChildren && !isCollapsed && (
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
                <div 
                  aria-hidden="true"
                  className="h-full bg-accent transition-all duration-300 motion-reduce:transition-none"
                  style={{ width: `${childCount > 0 ? (completedChildCount / childCount) * 100 : 0}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-text-muted">
                {completedChildCount}/{childCount}
              </span>
            </div>
          )}

          {/* Collapsed indicator showing hidden count */}
          {isCollapsed && hiddenDescendantCount > 0 && (
            <span className="text-[10px] font-mono text-accent">
              +{hiddenDescendantCount} hidden
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
});

const nodeTypes = {
  task: TaskNodeComponent,
};

/**
 * Get default collapsed IDs - collapse all depth-1 tasks (show milestones + their direct children)
 */
function getDefaultCollapsedIds(tasks: Task[]): Set<TaskId> {
  const collapsed = new Set<TaskId>();
  // Collapse depth-1 tasks that have children
  for (const task of tasks) {
    if (task.depth === 1) {
      const hasChildren = tasks.some((t) => t.parentId === task.id);
      if (hasChildren) {
        collapsed.add(task.id);
      }
    }
  }
  return collapsed;
}

/**
 * Build flat list of visible task IDs for keyboard navigation
 */
function buildFlatTaskList(
  tasks: Task[],
  collapsedIds: Set<TaskId>
): TaskId[] {
  const childrenMap = new Map<TaskId, TaskId[]>();

  for (const task of tasks) {
    if (task.parentId) {
      const siblings = childrenMap.get(task.parentId) ?? [];
      siblings.push(task.id);
      childrenMap.set(task.parentId, siblings);
    }
  }

  // Find all hidden task IDs (descendants of collapsed nodes)
  const hiddenIds = new Set<TaskId>();
  for (const collapsedId of collapsedIds) {
    const descendants = getDescendantIds(collapsedId, childrenMap);
    for (const id of descendants) {
      hiddenIds.add(id);
    }
  }

  // Build flat list in tree order
  const result: TaskId[] = [];

  function traverseChildren(parentId: TaskId): void {
    const children = childrenMap.get(parentId) ?? [];
    for (const childId of children) {
      if (!hiddenIds.has(childId)) {
        result.push(childId);
        traverseChildren(childId);
      }
    }
  }

  // Start with root tasks (parentId = null)
  for (const task of tasks) {
    if (task.parentId === null && !hiddenIds.has(task.id)) {
      result.push(task.id);
      traverseChildren(task.id);
    }
  }

  return result;
}

/**
 * Graph navigation controller - uses ReactFlow's fitView
 */
function GraphNavigation({
  tasks,
  focusedId,
  setFocusedId,
  collapsedIds,
  setCollapsedIds,
  onSelect,
  onToggleMinimap,
}: {
  tasks: Task[];
  focusedId: TaskId | null;
  setFocusedId: (id: TaskId | null) => void;
  collapsedIds: Set<TaskId>;
  setCollapsedIds: React.Dispatch<React.SetStateAction<Set<TaskId>>>;
  onSelect: (id: TaskId) => void;
  onToggleMinimap: () => void;
}) {
  const { fitView } = useReactFlow();

  // Build flat task list for j/k navigation
  const flatTasks = useMemo(
    () => buildFlatTaskList(tasks, collapsedIds),
    [tasks, collapsedIds]
  );

  // Build task map and children map
  const taskMap = useMemo(
    () => new Map<TaskId, Task>(tasks.map((t) => [t.id, t])),
    [tasks]
  );

  const childrenMap = useMemo(() => {
    const map = new Map<TaskId, TaskId[]>();
    for (const task of tasks) {
      if (task.parentId) {
        const siblings = map.get(task.parentId) ?? [];
        siblings.push(task.id);
        map.set(task.parentId, siblings);
      }
    }
    return map;
  }, [tasks]);

  // Center view on focused node - use fitView directly without DOM check
  // (node may be offscreen due to onlyRenderVisibleElements virtualization)
  const centerOnNode = useCallback(
    (id: TaskId) => {
      fitView({
        nodes: [{ id }],
        duration: 150,
        padding: 0.5,
      });
    },
    [fitView]
  );

  // Navigation handlers
  const moveDown = useCallback(() => {
    if (flatTasks.length === 0) return;
    const currentIdx = focusedId ? flatTasks.indexOf(focusedId) : -1;
    const nextIdx = currentIdx < flatTasks.length - 1 ? currentIdx + 1 : 0;
    const nextId = flatTasks[nextIdx];
    if (nextId) {
      setFocusedId(nextId);
      centerOnNode(nextId);
    }
  }, [flatTasks, focusedId, setFocusedId, centerOnNode]);

  const moveUp = useCallback(() => {
    if (flatTasks.length === 0) return;
    const currentIdx = focusedId ? flatTasks.indexOf(focusedId) : flatTasks.length;
    const nextIdx = currentIdx > 0 ? currentIdx - 1 : flatTasks.length - 1;
    const nextId = flatTasks[nextIdx];
    if (nextId) {
      setFocusedId(nextId);
      centerOnNode(nextId);
    }
  }, [flatTasks, focusedId, setFocusedId, centerOnNode]);

  const moveToParent = useCallback(() => {
    if (!focusedId) return;
    const task = taskMap.get(focusedId);
    if (!task) return;

    // If has children and not collapsed, collapse
    const hasChildren = childrenMap.has(focusedId);
    const isCollapsed = collapsedIds.has(focusedId);

    if (hasChildren && !isCollapsed) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        next.add(focusedId);
        return next;
      });
      return;
    }

    // Otherwise, move to parent
    if (task.parentId) {
      setFocusedId(task.parentId);
      centerOnNode(task.parentId);
    }
  }, [focusedId, taskMap, childrenMap, collapsedIds, setCollapsedIds, setFocusedId, centerOnNode]);

  const moveToChild = useCallback(() => {
    if (!focusedId) return;

    // If collapsed, expand
    if (collapsedIds.has(focusedId)) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        next.delete(focusedId);
        return next;
      });
      return;
    }

    // Move to first child
    const children = childrenMap.get(focusedId);
    if (children && children.length > 0) {
      const firstChild = children[0];
      if (firstChild) {
        setFocusedId(firstChild);
        centerOnNode(firstChild);
      }
    }
  }, [focusedId, collapsedIds, setCollapsedIds, childrenMap, setFocusedId, centerOnNode]);

  const toggleCollapse = useCallback(() => {
    if (!focusedId) return;
    const hasChildren = childrenMap.has(focusedId);
    if (hasChildren) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        if (next.has(focusedId)) {
          next.delete(focusedId);
        } else {
          next.add(focusedId);
        }
        return next;
      });
    }
  }, [focusedId, childrenMap, setCollapsedIds]);

  const selectFocused = useCallback(() => {
    if (focusedId) {
      onSelect(focusedId);
    }
  }, [focusedId, onSelect]);

  // Register keyboard shortcuts
  useKeyboardShortcuts(
    () => [
      {
        key: "j",
        description: "Next node",
        scope: "graph",
        handler: moveDown,
      },
      {
        key: "k",
        description: "Previous node",
        scope: "graph",
        handler: moveUp,
      },
      {
        key: "ArrowDown",
        description: "Next node",
        scope: "graph",
        handler: moveDown,
      },
      {
        key: "ArrowUp",
        description: "Previous node",
        scope: "graph",
        handler: moveUp,
      },
      {
        key: "h",
        description: "Parent / collapse",
        scope: "graph",
        handler: moveToParent,
      },
      {
        key: "l",
        description: "Child / expand",
        scope: "graph",
        handler: moveToChild,
      },
      {
        key: "ArrowLeft",
        description: "Parent / collapse",
        scope: "graph",
        handler: moveToParent,
      },
      {
        key: "ArrowRight",
        description: "Child / expand",
        scope: "graph",
        handler: moveToChild,
      },
      {
        key: "Space",
        description: "Toggle collapse",
        scope: "graph",
        handler: toggleCollapse,
      },
      {
        key: "Enter",
        description: "Select focused task",
        scope: "graph",
        handler: selectFocused,
      },
      {
        key: "m",
        description: "Toggle minimap",
        scope: "graph",
        handler: onToggleMinimap,
      },
    ],
    [moveDown, moveUp, moveToParent, moveToChild, toggleCollapse, selectFocused, onToggleMinimap]
  );

  return null; // This component only handles navigation, no UI
}

/**
 * Interactive task dependency graph (read-only, fully derived from props)
 * Supports collapsible nodes for progressive disclosure.
 */
export function TaskGraph({
  tasks,
  selectedId,
  onSelect,
  showBlockers = false,
}: TaskGraphProps) {
  // Claim keyboard scope at TaskGraph level (not GraphNavigation) because
  // GraphNavigation is renderless and can't receive pointer/focus events
  const scopeProps = useKeyboardScope("graph");

  // Track collapsed node IDs - default to collapsing depth-1 tasks with children
  const [collapsedIds, setCollapsedIds] = useState<Set<TaskId>>(() =>
    getDefaultCollapsedIds(tasks)
  );

  // Track focused node for keyboard navigation
  const [focusedId, setFocusedId] = useState<TaskId | null>(null);

  // Track minimap visibility
  const [showMinimap, setShowMinimap] = useState(false);

  // Toggle collapse state for a node
  const handleToggleCollapse = useCallback((id: TaskId) => {
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

  // Sync focusedId with selectedId when selectedId changes
  useEffect(() => {
    if (selectedId) {
      setFocusedId(selectedId);
    }
  }, [selectedId]);

  // Initialize focus to first task if none
  useEffect(() => {
    if (!focusedId && tasks.length > 0) {
      const firstTask = tasks.find((t) => t.depth === 0) ?? tasks[0];
      if (firstTask) {
        setFocusedId(firstTask.id);
      }
    }
  }, [tasks, focusedId]);

  // Compute layout only when tasks or collapsed state changes (expensive dagre layout)
  const { nodes: layoutedNodes, edges: allEdges } = useMemo(
    () => buildGraphElements(tasks, collapsedIds),
    [tasks, collapsedIds]
  );

  // Filter edges based on showBlockers toggle
  const edges = useMemo(
    () =>
      showBlockers
        ? allEdges
        : allEdges.filter((e) => e.data?.kind !== "blocker"),
    [allEdges, showBlockers]
  );

  // Apply focus, selection, and onToggleCollapse separately (cheap, no Dagre re-run)
  const nodes = useMemo(
    () =>
      layoutedNodes.map((n) => ({
        ...n,
        selected: selectedId !== null && n.data.task.id === selectedId,
        data: {
          ...n.data,
          isFocused: n.data.task.id === focusedId,
          onToggleCollapse: handleToggleCollapse,
        },
      })),
    [layoutedNodes, selectedId, focusedId, handleToggleCollapse]
  );

  // Handle node click via onNodeClick (not stored in node data)
  const handleNodeClick: NodeMouseHandler<TaskNode> = useCallback(
    (_, node) => {
      if (isTaskNodeData(node.data)) {
        onSelect(node.data.task.id);
        setFocusedId(node.data.task.id);
      }
    },
    [onSelect]
  );

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
        <div className="text-4xl select-none" aria-hidden="true">&#9044;</div>
        <p className="font-mono uppercase tracking-wider">NO TASKS IN STORE</p>
        <p className="text-text-dim text-sm font-mono">Run `os task create -d "Your task"` to begin</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-0 relative" style={{ minHeight: 0 }} {...scopeProps}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        // Read-only: disable all editing interactions
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        // Viewport settings
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        // Performance: virtualization for large graphs
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <GraphNavigation
          tasks={tasks}
          focusedId={focusedId}
          setFocusedId={setFocusedId}
          collapsedIds={collapsedIds}
          setCollapsedIds={setCollapsedIds}
          onSelect={onSelect}
          onToggleMinimap={() => setShowMinimap((prev) => !prev)}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border)"
        />
        <Controls
          showInteractive={false}
          className="react-flow-controls-themed"
        />
        {showMinimap && (
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={(node) => {
              if (!isTaskNodeData(node.data)) return "var(--color-border)";
              const variant = getStatusVariant(node.data.task);
              switch (variant) {
                case "done":
                  return "var(--color-status-done)";
                case "blocked":
                  return "var(--color-status-blocked)";
                case "active":
                  return "var(--color-status-active)";
                default:
                  return "var(--color-status-pending)";
              }
            }}
            className="react-flow-minimap-themed"
            maskColor="rgba(0, 0, 0, 0.7)"
          />
        )}
      </ReactFlow>

      {/* Minimap toggle button */}
      <button
        onClick={() => setShowMinimap((prev) => !prev)}
        className={`
          absolute bottom-4 right-14 z-10
          w-8 h-8 flex items-center justify-center
          border transition-colors motion-reduce:transition-none
          ${
            showMinimap
              ? "bg-accent text-bg-primary border-accent"
              : "bg-surface-primary text-text-muted border-border hover:border-border-hover hover:text-text-primary"
          }
        `}
        title="Toggle minimap (m)"
        aria-label={showMinimap ? "Hide minimap" : "Show minimap"}
        aria-pressed={showMinimap}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="1"
            y="1"
            width="14"
            height="14"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="3"
            y="3"
            width="4"
            height="4"
            fill="currentColor"
            opacity="0.5"
          />
        </svg>
      </button>

      {/* Navigation hint */}
      <div className="absolute bottom-4 left-4 z-10 px-2 py-1 bg-surface-primary/80 border border-border text-xs text-text-dim font-mono">
        <span className="opacity-70">h/l</span> collapse/expand{" "}
        <span className="opacity-70">j/k</span> navigate{" "}
        <span className="opacity-70">Enter</span> select
      </div>
    </div>
  );
}
