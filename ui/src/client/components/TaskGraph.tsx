import { useState, useMemo, useCallback, memo } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
  Handle,
  Position,
  BackgroundVariant,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type { Task, TaskId } from "../../types.js";

import "@xyflow/react/dist/style.css";

// Node dimensions
const NODE_WIDTH = 280;
const NODE_HEIGHT = 80;
const NODE_HEIGHT_COLLAPSED = 60; // Smaller when showing hidden count

// Edge data with typed kind
interface TaskEdgeData extends Record<string, unknown> {
  kind: "parent" | "blocker";
}

// Custom data for task nodes - needs index signature for xyflow
interface TaskNodeData extends Record<string, unknown> {
  task: Task;
  childCount: number;
  isCollapsed: boolean;
  hiddenDescendantCount: number;
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
  edges: TaskEdge[],
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: "LR", // Left-to-right: shows hierarchy horizontally
    nodesep: 20, // Vertical spacing between siblings
    ranksep: 60, // Horizontal spacing between hierarchy levels
    marginx: 20,
    marginy: 20,
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
  taskMap: Map<TaskId, Task>,
  childrenMap: Map<TaskId, TaskId[]>,
): Set<TaskId> {
  const descendants = new Set<TaskId>();
  const stack = childrenMap.get(taskId) ?? [];

  while (stack.length > 0) {
    const id = stack.pop()!;
    descendants.add(id);
    const children = childrenMap.get(id) ?? [];
    stack.push(...children);
  }

  return descendants;
}

/**
 * Build nodes and edges from tasks, respecting collapsed state
 */
function buildGraphElements(
  tasks: Task[],
  collapsedIds: Set<TaskId>,
  onToggleCollapse: (id: TaskId) => void,
): {
  nodes: TaskNode[];
  edges: TaskEdge[];
} {
  // Build lookup maps
  const taskMap = new Map<TaskId, Task>(tasks.map((t) => [t.id, t]));
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
    const descendants = getDescendantIds(collapsedId, taskMap, childrenMap);
    for (const id of descendants) {
      hiddenIds.add(id);
    }
  }

  // Count hidden descendants for each collapsed node
  const hiddenDescendantCounts = new Map<TaskId, number>();
  for (const collapsedId of collapsedIds) {
    const descendants = getDescendantIds(collapsedId, taskMap, childrenMap);
    hiddenDescendantCounts.set(collapsedId, descendants.size);
  }

  // Filter to visible tasks only
  const visibleTasks = tasks.filter((t) => !hiddenIds.has(t.id));

  // Build child count map (direct children only, for visible tasks)
  const childCounts = new Map<TaskId, number>();
  for (const task of tasks) {
    if (task.parentId) {
      childCounts.set(task.parentId, (childCounts.get(task.parentId) ?? 0) + 1);
    }
  }

  // Create nodes for visible tasks
  const nodes: TaskNode[] = visibleTasks.map((task) => ({
    id: task.id,
    type: "task",
    position: { x: 0, y: 0 }, // Will be set by dagre
    data: {
      task,
      childCount: childCounts.get(task.id) ?? 0,
      isCollapsed: collapsedIds.has(task.id),
      hiddenDescendantCount: hiddenDescendantCounts.get(task.id) ?? 0,
      onToggleCollapse,
    },
  }));

  // Create edges for visible tasks only
  const edges: TaskEdge[] = [];
  const visibleIds = new Set(visibleTasks.map((t) => t.id));
  const blockerEdgeIds = new Set<string>();

  for (const task of visibleTasks) {
    // Parent → child edges (prominent, solid)
    if (task.parentId && visibleIds.has(task.parentId)) {
      edges.push({
        id: `parent-${task.parentId}-${task.id}`,
        source: task.parentId,
        target: task.id,
        type: "smoothstep",
        style: {
          stroke: "var(--color-text-muted)",
          strokeWidth: 2,
        },
        data: { kind: "parent" },
      });
    }

    // BlockedBy edges (subtle, dashed) - blocker → blocked
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
              style: {
                stroke: "var(--color-accent)",
                strokeWidth: 1,
                strokeDasharray: "4,4",
                opacity: 0.5,
              },
              data: { kind: "blocker" },
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
              style: {
                stroke: "var(--color-accent)",
                strokeWidth: 1,
                strokeDasharray: "4,4",
                opacity: 0.5,
              },
              data: { kind: "blocker" },
            });
          }
        }
      }
    }
  }

  return getLayoutedElements(nodes, edges);
}

/**
 * Custom task node component with collapse/expand support
 */
const TaskNodeComponent = memo(function TaskNodeComponent({
  data,
  selected,
}: NodeProps<TaskNode>) {
  const { task, childCount, isCollapsed, hiddenDescendantCount, onToggleCollapse } =
    data;

  const isBlocked = (task.blockedBy?.length ?? 0) > 0 && !task.completed;
  const isInProgress = task.startedAt !== null && !task.completed;
  const hasChildren = childCount > 0;

  const depthLabel =
    task.depth === 0 ? "Milestone" : task.depth === 1 ? "Task" : "Subtask";

  // Status styling
  const statusColor = task.completed
    ? "var(--color-success)"
    : isBlocked
      ? "var(--color-error)"
      : isInProgress
        ? "var(--color-accent)"
        : "var(--color-text-muted)";

  const statusLabel = task.completed
    ? "Done"
    : isBlocked
      ? "Blocked"
      : isInProgress
        ? "Active"
        : "Pending";

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Don't trigger node selection
      onToggleCollapse(task.id);
    },
    [onToggleCollapse, task.id],
  );

  return (
    <>
      {/* LR layout: target handle on left, source on right */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        className={`
          rounded-lg border-2 p-3 transition-all
          bg-[var(--color-surface-primary)]
          ${selected ? "border-[var(--color-accent)] shadow-lg shadow-[var(--color-accent)]/20" : "border-[var(--color-border)] hover:border-[var(--color-border-hover)]"}
        `}
        style={{ width: NODE_WIDTH }}
      >
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            {/* Collapse/expand button for nodes with children */}
            {hasChildren && (
              <button
                onClick={handleToggle}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
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
            {/* Status indicator */}
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: statusColor }}
            />
            {/* Depth label */}
            <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--color-text-muted)]">
              {depthLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Status badge */}
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: `color-mix(in srgb, ${statusColor} 20%, transparent)`,
                color: statusColor,
              }}
            >
              {statusLabel}
            </span>
            {/* Priority */}
            <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
              P{task.priority}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-[var(--color-text-primary)] line-clamp-2 leading-tight">
          {task.description}
        </p>

        {/* Collapsed indicator showing hidden count */}
        {isCollapsed && hiddenDescendantCount > 0 && (
          <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
            <span className="text-[10px] font-mono text-[var(--color-accent)]">
              +{hiddenDescendantCount} hidden{" "}
              {hiddenDescendantCount === 1 ? "task" : "tasks"}
            </span>
          </div>
        )}
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
 * Interactive task dependency graph (read-only, fully derived from props)
 * Supports collapsible nodes for progressive disclosure.
 */
export function TaskGraph({
  tasks,
  selectedId,
  onSelect,
  showBlockers = false,
}: TaskGraphProps) {
  // Track collapsed node IDs - default to collapsing depth-1 tasks with children
  const [collapsedIds, setCollapsedIds] = useState<Set<TaskId>>(() =>
    getDefaultCollapsedIds(tasks),
  );

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

  // Compute layout only when tasks or collapsed state changes
  const { nodes: layoutedNodes, edges: allEdges } = useMemo(
    () => buildGraphElements(tasks, collapsedIds, handleToggleCollapse),
    [tasks, collapsedIds, handleToggleCollapse],
  );

  // Filter edges based on showBlockers toggle
  const edges = useMemo(
    () =>
      showBlockers
        ? allEdges
        : allEdges.filter((e) => e.data?.kind !== "blocker"),
    [allEdges, showBlockers],
  );

  // Apply selection separately (cheap, no Dagre re-run)
  const nodes = useMemo(
    () =>
      layoutedNodes.map((n) => ({
        ...n,
        selected: selectedId !== null && n.data.task.id === selectedId,
      })),
    [layoutedNodes, selectedId],
  );

  // Handle node click via onNodeClick (not stored in node data)
  const handleNodeClick: NodeMouseHandler<TaskNode> = useCallback(
    (_, node) => {
      if (isTaskNodeData(node.data)) {
        onSelect(node.data.task.id);
      }
    },
    [onSelect],
  );

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
        <p>No tasks to display</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-0" style={{ minHeight: 0 }}>
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
      </ReactFlow>
    </div>
  );
}
