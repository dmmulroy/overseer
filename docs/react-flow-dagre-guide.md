# React Flow + Dagre: Technical Deep Dive & Integration Guide

**Generated:** 2026-01-31

A comprehensive technical reference for building node-based UIs with React Flow and automated hierarchical layout via Dagre.

---

## Table of Contents

1. [Overview](#overview)
2. [React Flow Architecture](#react-flow-architecture)
3. [React Flow API Reference](#react-flow-api-reference)
4. [Dagre Architecture](#dagre-architecture)
5. [Dagre API Reference](#dagre-api-reference)
6. [Integration Patterns](#integration-patterns)
7. [Performance Optimization](#performance-optimization)
8. [TypeScript Reference](#typescript-reference)
9. [Recipes & Patterns](#recipes--patterns)
10. [Troubleshooting](#troubleshooting)

---

## Overview

| Library | Purpose | Key Tech |
|---------|---------|----------|
| **@xyflow/react** | Interactive node-based UI components | React, Zustand, d3-zoom |
| **@dagrejs/dagre** | Hierarchical graph layout algorithm | Sugiyama framework |

**Typical Use Case**: Build a workflow editor, dependency graph, or org chart where users can drag nodes, create connections, and automatically lay out the graph.

---

## React Flow Architecture

### Package Structure (Monorepo)

```
xyflow/
├── packages/system/     # Framework-agnostic core (d3-zoom, d3-drag)
├── packages/react/      # React wrapper (@xyflow/react)
└── packages/svelte/     # Svelte implementation
```

### Component Hierarchy

```
<ReactFlow />                          // Main container
├── <Wrapper />                        // State provider (Zustand)
│   └── <GraphView />                  // Core rendering
│       ├── <FlowRenderer />           // Pane interactions
│       │   └── <ZoomPane />           // d3-zoom integration
│       └── <Viewport />               // Transform container
│           ├── <EdgeRenderer />       // SVG edges layer
│           ├── <ConnectionLine />     // Active connection preview
│           └── <NodeRenderer />       // Nodes layer (absolute positioned)
├── <StoreUpdater />                   // Props → store sync
├── <Background />                     // Optional grid/dots
├── <MiniMap />                        // Optional minimap
└── <Controls />                       // Optional zoom controls
```

### State Management

React Flow uses **Zustand** for centralized state:

```typescript
type ReactFlowStore = {
  // Core data
  nodes: Node[];
  edges: Edge[];
  nodeLookup: Map<string, InternalNode>;
  edgeLookup: Map<string, Edge>;
  
  // Viewport
  transform: [x: number, y: number, zoom: number];
  
  // Interaction state
  nodesSelectionActive: boolean;
  userSelectionActive: boolean;
  connection: ConnectionState;
  
  // Configuration flags
  nodesDraggable: boolean;
  nodesConnectable: boolean;
  elementsSelectable: boolean;
  // ... 50+ more properties
  
  // Actions
  setNodes: (payload) => void;
  setEdges: (payload) => void;
  updateNode: (id, update) => void;
  // ...
};
```

### Controlled vs Uncontrolled

**Uncontrolled** (internal state):
```tsx
<ReactFlow 
  defaultNodes={initialNodes}
  defaultEdges={initialEdges}
/>
```

**Controlled** (external state):
```tsx
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
/>
```

---

## React Flow API Reference

### ReactFlow Props (Complete)

```typescript
interface ReactFlowProps<NodeType extends Node, EdgeType extends Edge> {
  // === Core Data ===
  nodes?: NodeType[];
  edges?: EdgeType[];
  defaultNodes?: NodeType[];
  defaultEdges?: EdgeType[];
  
  // === Change Handlers ===
  onNodesChange?: OnNodesChange<NodeType>;
  onEdgesChange?: OnEdgesChange<EdgeType>;
  
  // === Connection Events ===
  onConnect?: OnConnect;
  onConnectStart?: OnConnectStart;
  onConnectEnd?: OnConnectEnd;
  
  // === Node Events ===
  onNodeClick?: NodeMouseHandler<NodeType>;
  onNodeDoubleClick?: NodeMouseHandler<NodeType>;
  onNodeDragStart?: OnNodeDrag<NodeType>;
  onNodeDrag?: OnNodeDrag<NodeType>;
  onNodeDragStop?: OnNodeDrag<NodeType>;
  onNodeMouseEnter?: NodeMouseHandler<NodeType>;
  onNodeMouseMove?: NodeMouseHandler<NodeType>;
  onNodeMouseLeave?: NodeMouseHandler<NodeType>;
  onNodeContextMenu?: NodeMouseHandler<NodeType>;
  
  // === Edge Events ===
  onEdgeClick?: EdgeMouseHandler<EdgeType>;
  onEdgeDoubleClick?: EdgeMouseHandler<EdgeType>;
  onEdgeContextMenu?: EdgeMouseHandler<EdgeType>;
  onEdgeMouseEnter?: EdgeMouseHandler<EdgeType>;
  onEdgeMouseMove?: EdgeMouseHandler<EdgeType>;
  onEdgeMouseLeave?: EdgeMouseHandler<EdgeType>;
  onReconnect?: OnReconnect<EdgeType>;
  
  // === Viewport Events ===
  onMove?: OnMove;
  onMoveStart?: OnMoveStart;
  onMoveEnd?: OnMoveEnd;
  onInit?: OnInit<NodeType, EdgeType>;
  onViewportChange?: (viewport: Viewport) => void;
  
  // === Pane Events ===
  onPaneClick?: (event: ReactMouseEvent) => void;
  onPaneContextMenu?: (event: ReactMouseEvent | MouseEvent) => void;
  onPaneScroll?: (event?: WheelEvent) => void;
  
  // === Selection Events ===
  onSelectionChange?: OnSelectionChangeFunc<NodeType, EdgeType>;
  onSelectionDragStart?: SelectionDragHandler<NodeType>;
  onSelectionDrag?: SelectionDragHandler<NodeType>;
  onSelectionDragStop?: SelectionDragHandler<NodeType>;
  onSelectionContextMenu?: (event, nodes) => void;
  
  // === Deletion Events ===
  onNodesDelete?: OnNodesDelete<NodeType>;
  onEdgesDelete?: OnEdgesDelete<EdgeType>;
  onDelete?: OnDelete<NodeType, EdgeType>;
  onBeforeDelete?: OnBeforeDelete<NodeType, EdgeType>;
  
  // === Custom Components ===
  nodeTypes?: Record<string, ComponentType<NodeProps<any>>>;
  edgeTypes?: Record<string, ComponentType<EdgeProps<any>>>;
  connectionLineComponent?: ConnectionLineComponent<NodeType>;
  
  // === Viewport Control ===
  viewport?: Viewport;
  defaultViewport?: Viewport;
  minZoom?: number;               // default: 0.5
  maxZoom?: number;               // default: 2
  translateExtent?: CoordinateExtent;
  fitView?: boolean;
  fitViewOptions?: FitViewOptions;
  
  // === Interaction Flags ===
  nodesDraggable?: boolean;       // default: true
  nodesConnectable?: boolean;     // default: true
  nodesFocusable?: boolean;       // default: true
  edgesFocusable?: boolean;       // default: true
  edgesReconnectable?: boolean;   // default: true
  elementsSelectable?: boolean;   // default: true
  selectNodesOnDrag?: boolean;    // default: true
  
  // === Pan/Zoom ===
  panOnDrag?: boolean | number[]; // default: true
  panOnScroll?: boolean;          // default: false
  panOnScrollSpeed?: number;      // default: 0.5
  zoomOnScroll?: boolean;         // default: true
  zoomOnPinch?: boolean;          // default: true
  zoomOnDoubleClick?: boolean;    // default: true
  preventScrolling?: boolean;     // default: true
  
  // === Keyboard Shortcuts ===
  selectionKeyCode?: KeyCode | null;      // default: 'Shift'
  multiSelectionKeyCode?: KeyCode | null; // default: 'Meta'/'Control'
  deleteKeyCode?: KeyCode | null;         // default: 'Backspace'
  panActivationKeyCode?: KeyCode | null;  // default: 'Space'
  
  // === Grid/Snap ===
  snapToGrid?: boolean;
  snapGrid?: [number, number];
  
  // === Connection ===
  connectionMode?: 'strict' | 'loose';
  connectionLineType?: ConnectionLineType;
  connectionRadius?: number;      // default: 20
  isValidConnection?: IsValidConnection;
  autoPanOnConnect?: boolean;
  autoPanOnNodeDrag?: boolean;
  
  // === Visual ===
  colorMode?: 'light' | 'dark' | 'system';
  nodeOrigin?: [number, number];  // default: [0, 0]
  elevateNodesOnSelect?: boolean; // default: true
  elevateEdgesOnSelect?: boolean; // default: false
  defaultEdgeOptions?: DefaultEdgeOptions;
  
  // === Performance ===
  onlyRenderVisibleElements?: boolean;
}
```

### useReactFlow Hook

```typescript
const {
  // === Node Operations ===
  getNode,          // (id: string) => Node | undefined
  getNodes,         // () => Node[]
  setNodes,         // (nodes | updater) => void
  addNodes,         // (node | nodes) => void
  updateNode,       // (id, update, options?) => void
  updateNodeData,   // (id, dataUpdate, options?) => void
  deleteElements,   // ({ nodes?, edges? }) => Promise<{ deletedNodes, deletedEdges }>
  getInternalNode,  // (id) => InternalNode | undefined
  
  // === Edge Operations ===
  getEdge,          // (id: string) => Edge | undefined
  getEdges,         // () => Edge[]
  setEdges,         // (edges | updater) => void
  addEdges,         // (edge | edges) => void
  
  // === Viewport Operations ===
  zoomIn,           // (options?) => Promise<boolean>
  zoomOut,          // (options?) => Promise<boolean>
  zoomTo,           // (level, options?) => Promise<boolean>
  getZoom,          // () => number
  setViewport,      // (viewport, options?) => Promise<boolean>
  getViewport,      // () => Viewport
  fitView,          // (options?) => Promise<boolean>
  setCenter,        // (x, y, options?) => Promise<boolean>
  fitBounds,        // (bounds, options?) => Promise<boolean>
  
  // === Coordinate Conversion ===
  screenToFlowPosition, // (pos) => XYPosition
  flowToScreenPosition, // (pos) => XYPosition
  
  // === Intersection ===
  getIntersectingNodes, // (node | rect, partially?, nodes?) => Node[]
  isNodeIntersecting,   // (node | rect, area, partially?) => boolean
  
  // === Advanced ===
  updateNodeInternals,  // (nodeIds) => void
  toObject,             // () => ReactFlowJsonObject
} = useReactFlow();
```

### Node Type Definition

```typescript
type Node<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Type extends string | undefined = string | undefined
> = {
  id: string;
  position: { x: number; y: number };
  data: Data;
  type?: Type;  // 'input' | 'output' | 'default' | 'group' | custom
  
  // Positioning
  sourcePosition?: 'top' | 'right' | 'bottom' | 'left';
  targetPosition?: 'top' | 'right' | 'bottom' | 'left';
  
  // State
  hidden?: boolean;
  selected?: boolean;
  dragging?: boolean;
  
  // Behavior overrides
  draggable?: boolean;
  selectable?: boolean;
  connectable?: boolean;
  deletable?: boolean;
  focusable?: boolean;
  
  // Dimensions (measured or explicit)
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
  
  // Parent/child (for groups)
  parentId?: string;
  extent?: 'parent' | CoordinateExtent | null;
  expandParent?: boolean;
  
  // Styling
  style?: CSSProperties;
  className?: string;
  zIndex?: number;
  
  // Drag handle (CSS selector)
  dragHandle?: string;
  
  // Accessibility
  ariaLabel?: string;
};
```

### Edge Type Definition

```typescript
type Edge<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Type extends string | undefined = string | undefined
> = {
  id: string;
  source: string;
  target: string;
  type?: Type;  // 'default' | 'straight' | 'step' | 'smoothstep' | 'simplebezier' | custom
  
  // Handle targeting (if node has multiple handles)
  sourceHandle?: string | null;
  targetHandle?: string | null;
  
  // Visual
  animated?: boolean;
  hidden?: boolean;
  selected?: boolean;
  style?: CSSProperties;
  className?: string;
  
  // Labels
  label?: ReactNode;
  labelStyle?: CSSProperties;
  labelShowBg?: boolean;
  labelBgStyle?: CSSProperties;
  labelBgPadding?: [number, number];
  labelBgBorderRadius?: number;
  
  // Markers
  markerStart?: EdgeMarkerType;
  markerEnd?: EdgeMarkerType;
  
  // Behavior
  selectable?: boolean;
  deletable?: boolean;
  focusable?: boolean;
  reconnectable?: boolean | 'source' | 'target';
  
  // Path options (type-specific)
  pathOptions?: {
    curvature?: number;       // bezier
    offset?: number;          // step/smoothstep
    borderRadius?: number;    // smoothstep
  };
  
  // Data payload
  data?: Data;
  
  // Advanced
  zIndex?: number;
  interactionWidth?: number;  // Clickable area width
};
```

### Custom Node Component

```tsx
import { Handle, Position, NodeProps } from '@xyflow/react';

type CustomNodeData = {
  label: string;
  status: 'pending' | 'running' | 'complete';
};

function CustomNode({ data, isConnectable }: NodeProps<Node<CustomNodeData>>) {
  return (
    <div className="custom-node">
      <Handle 
        type="target" 
        position={Position.Top}
        isConnectable={isConnectable}
      />
      
      <div className="label">{data.label}</div>
      <div className={`status status-${data.status}`} />
      
      <Handle 
        type="source" 
        position={Position.Bottom}
        id="a"
        isConnectable={isConnectable}
      />
      <Handle 
        type="source" 
        position={Position.Bottom}
        id="b"
        style={{ left: '75%' }}
        isConnectable={isConnectable}
      />
    </div>
  );
}

// Register
const nodeTypes = { custom: CustomNode };
<ReactFlow nodeTypes={nodeTypes} />
```

### Custom Edge Component

```tsx
import { BaseEdge, EdgeProps, getBezierPath } from '@xyflow/react';

function CustomEdge({
  id,
  sourceX, sourceY,
  targetX, targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY,
    targetX, targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <text x={labelX} y={labelY} className="edge-label">
        {data?.label}
      </text>
    </>
  );
}

const edgeTypes = { custom: CustomEdge };
```

### CSS Variables

```css
.react-flow {
  /* Node styling */
  --xy-node-background-color-default: #fff;
  --xy-node-border-default: 1px solid #1a192b;
  --xy-node-border-radius-default: 3px;
  --xy-node-boxshadow-hover-default: 0 1px 4px 1px rgba(0, 0, 0, 0.08);
  --xy-node-boxshadow-selected-default: 0 0 0 0.5px #1a192b;
  
  /* Handle styling */
  --xy-handle-background-color-default: #1a192b;
  --xy-handle-border-color-default: #fff;
  
  /* Edge styling */
  --xy-edge-stroke-default: #b1b1b7;
  --xy-edge-stroke-width-default: 1;
  --xy-edge-stroke-selected-default: #555;
  
  /* Selection */
  --xy-selection-background-color-default: rgba(0, 89, 220, 0.08);
  --xy-selection-border-default: 1px dotted rgba(0, 89, 220, 0.8);
  
  /* Background */
  --xy-background-pattern-dots-color-default: #91919a;
  --xy-background-pattern-lines-color-default: #eee;
}

/* Dark mode */
.react-flow.dark {
  --xy-node-background-color-default: #1e1e1e;
  --xy-node-color-default: #f8f8f8;
  --xy-edge-stroke-default: #3e3e3e;
}
```

---

## Dagre Architecture

### Algorithm: Sugiyama Framework

Dagre implements hierarchical (Sugiyama-style) layout in 4 phases:

```
Input Graph
    │
    ▼
┌─────────────────────────────────────┐
│ Phase 1: Cycle Removal              │
│ - Reverse edges to break cycles     │
│ - Algorithm: DFS or Greedy FAS      │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Phase 2: Rank Assignment            │
│ - Assign vertical layer to nodes    │
│ - Algorithm: Network Simplex        │
│ - Break long edges with dummies     │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Phase 3: Node Ordering              │
│ - Minimize edge crossings           │
│ - Algorithm: Barycenter + Median    │
│ - 24 iterations by default          │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Phase 4: Coordinate Assignment      │
│ - X: Brandes-Kopf algorithm         │
│ - Y: Layer-by-layer placement       │
│ - Compute edge bend points          │
└─────────────────────────────────────┘
    │
    ▼
Positioned Graph
```

### Complexity

- **Time**: O(|V| * |E|) worst case, typically O(|E|)
- **Space**: O(|V| + |E|)
- **Practical limits**: < 500 nodes for smooth UX

---

## Dagre API Reference

### Graph Construction

```typescript
import dagre from '@dagrejs/dagre';

// Create graph
const g = new dagre.graphlib.Graph({
  directed: true,   // Required for dagre
  multigraph: true, // Allow parallel edges
  compound: true    // Allow nested nodes (groups)
});

// Set defaults
g.setDefaultNodeLabel(() => ({}));
g.setDefaultEdgeLabel(() => ({}));

// Configure layout
g.setGraph({
  rankdir: 'TB',    // 'TB' | 'BT' | 'LR' | 'RL'
  nodesep: 50,      // Horizontal spacing between nodes
  edgesep: 20,      // Spacing between edges
  ranksep: 50,      // Vertical spacing between ranks
  marginx: 0,       // Horizontal margin
  marginy: 0,       // Vertical margin
  acyclicer: undefined,     // 'greedy' for faster cycle removal
  ranker: 'network-simplex' // 'tight-tree' | 'longest-path'
});
```

### Graph Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rankdir` | `'TB'` \| `'BT'` \| `'LR'` \| `'RL'` | `'TB'` | Layout direction |
| `nodesep` | `number` | `50` | Min horizontal separation between nodes |
| `edgesep` | `number` | `20` | Min separation between edges |
| `ranksep` | `number` | `50` | Vertical separation between ranks |
| `marginx` | `number` | `0` | Left/right margin |
| `marginy` | `number` | `0` | Top/bottom margin |
| `acyclicer` | `'greedy'` \| `undefined` | `undefined` | Cycle removal algorithm |
| `ranker` | `'network-simplex'` \| `'tight-tree'` \| `'longest-path'` | `'network-simplex'` | Ranking algorithm |
| `rankalign` | `'top'` \| `'center'` \| `'bottom'` | `'center'` | Vertical alignment within rank |

### Node Operations

```typescript
// Add node (width/height REQUIRED for layout)
g.setNode('node1', {
  width: 150,
  height: 50,
  label: 'Node 1'
});

// Get node
const node = g.node('node1');
// After layout: { x, y, width, height, rank, order, ... }

// Check existence
g.hasNode('node1'); // true

// Remove node (removes connected edges)
g.removeNode('node1');

// Get all node IDs
g.nodes(); // ['node1', 'node2', ...]

// Compound graph: set parent
g.setParent('child', 'parent');
g.parent('child');    // 'parent'
g.children('parent'); // ['child', ...]
```

### Node Options Reference

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `width` | `number` | Yes | Node width in pixels |
| `height` | `number` | Yes | Node height in pixels |
| `label` | `string` | No | Display label |
| `rank` | `number` | No | Pre-assigned rank (layer) |

**Output** (computed by layout):
- `x`: Center X coordinate
- `y`: Center Y coordinate
- `rank`: Assigned rank
- `order`: Position within rank

### Edge Operations

```typescript
// Add edge
g.setEdge('source', 'target', {
  label: 'edge label',
  weight: 1,        // Higher = stronger constraint
  minlen: 1,        // Min rank separation
  width: 0,         // Label width
  height: 0,        // Label height
  labelpos: 'c',    // 'l' | 'c' | 'r'
  labeloffset: 10
});

// For multigraphs, add name
g.setEdge('a', 'b', { label: 'first' }, 'edge1');
g.setEdge('a', 'b', { label: 'second' }, 'edge2');

// Get edge
const edge = g.edge('source', 'target');
// After layout: { points: [{x, y}, ...], x, y, ... }

// Check existence
g.hasEdge('source', 'target'); // true

// Remove edge
g.removeEdge('source', 'target');

// Get all edges
g.edges(); // [{ v: 'source', w: 'target', name?: string }, ...]

// Get connected edges
g.inEdges('node');   // Edges pointing TO node
g.outEdges('node');  // Edges FROM node
g.nodeEdges('node'); // All edges
```

### Edge Options Reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `minlen` | `number` | `1` | Minimum rank separation |
| `weight` | `number` | `1` | Edge weight (higher = stronger) |
| `width` | `number` | `0` | Label width |
| `height` | `number` | `0` | Label height |
| `labelpos` | `'l'` \| `'c'` \| `'r'` | `'r'` | Label position |
| `labeloffset` | `number` | `10` | Label offset from edge |

**Output** (computed by layout):
- `points`: Array of `{x, y}` defining edge path
- `x`, `y`: Label position (if label has dimensions)

### Running Layout

```typescript
// Basic usage
dagre.layout(g);

// With options
dagre.layout(g, {
  debugTiming: true,                    // Log timing
  disableOptimalOrderHeuristic: true    // Skip crossing minimization (faster)
});

// Access results
g.nodes().forEach(id => {
  const node = g.node(id);
  console.log(`${id}: (${node.x}, ${node.y})`);
});

g.edges().forEach(e => {
  const edge = g.edge(e);
  console.log('Path:', edge.points);
});

// Get graph dimensions
const { width, height } = g.graph();
```

---

## Integration Patterns

### Basic React Flow + Dagre

```typescript
import dagre from '@dagrejs/dagre';
import { Node, Edge, Position } from '@xyflow/react';

const NODE_WIDTH = 172;
const NODE_HEIGHT = 36;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  
  const isHorizontal = direction === 'LR';
  
  g.setGraph({
    rankdir: direction,
    nodesep: 50,
    ranksep: 50,
  });

  // Add nodes with dimensions
  nodes.forEach(node => {
    g.setNode(node.id, {
      width: node.measured?.width ?? node.width ?? NODE_WIDTH,
      height: node.measured?.height ?? node.height ?? NODE_HEIGHT,
    });
  });

  // Add edges
  edges.forEach(edge => {
    g.setEdge(edge.source, edge.target);
  });

  // Run layout
  dagre.layout(g);

  // Apply positions (dagre uses center, React Flow uses top-left)
  const layoutedNodes = nodes.map(node => {
    const dagreNode = g.node(node.id);
    const nodeWidth = node.measured?.width ?? node.width ?? NODE_WIDTH;
    const nodeHeight = node.measured?.height ?? node.height ?? NODE_HEIGHT;

    return {
      ...node,
      position: {
        x: dagreNode.x - nodeWidth / 2,
        y: dagreNode.y - nodeHeight / 2,
      },
      // Update handle positions based on direction
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
    };
  });

  return { nodes: layoutedNodes, edges };
}
```

### Usage in Component

```tsx
import { useCallback } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react';

function LayoutFlow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { fitView } = useReactFlow();

  const onLayout = useCallback((direction: 'TB' | 'LR') => {
    const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      direction
    );
    
    setNodes([...layouted]);
    setEdges([...layoutedEdges]);
    
    // Fit view after layout
    window.requestAnimationFrame(() => fitView());
  }, [nodes, edges, setNodes, setEdges, fitView]);

  return (
    <div style={{ height: '100vh' }}>
      <div className="controls">
        <button onClick={() => onLayout('TB')}>Vertical</button>
        <button onClick={() => onLayout('LR')}>Horizontal</button>
      </div>
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      />
    </div>
  );
}
```

### Auto-Layout on Node Add

```tsx
function useAutoLayout() {
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow();
  
  const layoutNodes = useCallback(() => {
    const nodes = getNodes();
    const edges = getEdges();
    
    // Skip if no nodes or all nodes have positions
    if (nodes.length === 0) return;
    
    const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      'TB'
    );
    
    setNodes(layouted);
    setEdges(layoutedEdges);
  }, [getNodes, getEdges, setNodes, setEdges]);
  
  return { layoutNodes };
}

// Usage
function Flow() {
  const { layoutNodes } = useAutoLayout();
  
  const onConnect = useCallback((connection) => {
    setEdges(eds => addEdge(connection, eds));
    // Re-layout after new connection
    layoutNodes();
  }, [layoutNodes]);
}
```

### Wait for Node Measurements

```tsx
function useLayoutOnMeasure() {
  const { getNodes, setNodes, getEdges, setEdges } = useReactFlow();
  const [isLayouted, setIsLayouted] = useState(false);

  useEffect(() => {
    const nodes = getNodes();
    
    // Check if all nodes are measured
    const allMeasured = nodes.every(
      n => n.measured?.width && n.measured?.height
    );
    
    if (allMeasured && !isLayouted && nodes.length > 0) {
      const { nodes: layouted } = getLayoutedElements(
        nodes,
        getEdges(),
        'TB'
      );
      setNodes(layouted);
      setIsLayouted(true);
    }
  }, [getNodes, getEdges, setNodes, isLayouted]);

  return isLayouted;
}
```

### Using Edge Points from Dagre

```tsx
function DagreEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps) {
  // Access dagre edge points (stored in edge data)
  const edge = useStore(s => s.edgeLookup.get(id));
  const points = edge?.data?.points as Array<{x: number; y: number}> | undefined;
  
  if (points && points.length > 2) {
    // Use dagre's computed bend points
    const pathData = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');
    
    return (
      <g>
        <path
          id={id}
          d={pathData}
          fill="none"
          stroke="#b1b1b7"
          strokeWidth={2}
        />
      </g>
    );
  }
  
  // Fallback to straight line
  return (
    <g>
      <path
        id={id}
        d={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`}
        fill="none"
        stroke="#b1b1b7"
        strokeWidth={2}
      />
    </g>
  );
}
```

---

## Performance Optimization

### React Flow Optimizations

```tsx
// 1. Memoize custom components
const CustomNode = memo(({ data }: NodeProps) => (
  <div>{data.label}</div>
));

// 2. Use specific hooks (avoid useNodes/useEdges for large graphs)
// Bad: re-renders on ANY node change
const nodes = useNodes();

// Good: only re-renders when specific node changes
const nodeData = useNodesData('node-1');

// Good: custom selector with shallow comparison
import { shallow } from 'zustand/shallow';
const selectedIds = useStore(
  s => s.nodes.filter(n => n.selected).map(n => n.id),
  shallow
);

// 3. Enable virtualization for large graphs
<ReactFlow onlyRenderVisibleElements={true} />

// 4. Disable unused features
<ReactFlow
  nodesFocusable={false}
  edgesFocusable={false}
  autoPanOnConnect={false}
  autoPanOnNodeDrag={false}
/>

// 5. Batch updates with startTransition
import { startTransition } from 'react';
startTransition(() => {
  setNodes(newNodes);
  setEdges(newEdges);
});
```

### Dagre Optimizations

```typescript
// 1. Skip crossing minimization (2-3x faster)
dagre.layout(g, { disableOptimalOrderHeuristic: true });

// 2. Use faster ranker for large graphs
g.setGraph({ ranker: 'longest-path' });

// 3. Reduce spacing for denser layouts
g.setGraph({
  nodesep: 20,
  ranksep: 30,
  edgesep: 10,
});

// 4. Cache layouts
const layoutCache = new Map<string, { x: number; y: number }>();

function getLayoutKey(nodes: Node[], edges: Edge[]): string {
  return JSON.stringify({
    nodes: nodes.map(n => n.id).sort(),
    edges: edges.map(e => `${e.source}-${e.target}`).sort(),
  });
}

// 5. Web Worker for large graphs
// worker.ts
self.onmessage = (e) => {
  const { nodes, edges, options } = e.data;
  const result = getLayoutedElements(nodes, edges, options);
  self.postMessage(result);
};

// main.ts
const worker = new Worker('./layout-worker.ts');
worker.postMessage({ nodes, edges });
worker.onmessage = (e) => setNodes(e.data.nodes);
```

### Size Guidelines

| Graph Size | Dagre Performance | Recommendation |
|------------|-------------------|----------------|
| < 100 nodes | < 50ms | No optimization needed |
| 100-500 nodes | 50-500ms | Consider virtualization |
| 500-2000 nodes | 500ms-5s | Use worker, skip heuristics |
| > 2000 nodes | > 5s | Consider ELK or server-side |

---

## TypeScript Reference

### React Flow Types

```typescript
import type {
  // Core
  Node,
  Edge,
  Connection,
  
  // Props
  NodeProps,
  EdgeProps,
  ReactFlowProps,
  
  // Hooks
  ReactFlowInstance,
  
  // Changes
  NodeChange,
  EdgeChange,
  OnNodesChange,
  OnEdgesChange,
  
  // Events
  OnConnect,
  OnConnectStart,
  OnConnectEnd,
  OnSelectionChangeFunc,
  
  // Viewport
  Viewport,
  FitViewOptions,
  
  // Positions
  Position,
  XYPosition,
  
  // Utilities
  HandleType,
  ConnectionMode,
  ConnectionLineType,
} from '@xyflow/react';

// Custom node type
type MyNode = Node<{ label: string; status: string }, 'custom'>;

// Custom edge type  
type MyEdge = Edge<{ weight: number }, 'custom'>;

// Typed hooks
const { getNode } = useReactFlow<MyNode, MyEdge>();
const node: MyNode | undefined = getNode('id');
```

### Dagre Types

```typescript
import dagre from '@dagrejs/dagre';

// Graph label (configuration)
interface DagreGraphLabel {
  width?: number;
  height?: number;
  rankdir?: 'TB' | 'BT' | 'LR' | 'RL';
  nodesep?: number;
  edgesep?: number;
  ranksep?: number;
  marginx?: number;
  marginy?: number;
  acyclicer?: 'greedy';
  ranker?: 'network-simplex' | 'tight-tree' | 'longest-path';
}

// Node input
interface DagreNodeInput {
  width: number;
  height: number;
  label?: string;
  rank?: number;
}

// Node output (after layout)
interface DagreNodeOutput extends DagreNodeInput {
  x: number;
  y: number;
  rank: number;
  order: number;
}

// Edge input
interface DagreEdgeInput {
  minlen?: number;
  weight?: number;
  width?: number;
  height?: number;
  labelpos?: 'l' | 'c' | 'r';
  labeloffset?: number;
}

// Edge output (after layout)
interface DagreEdgeOutput extends DagreEdgeInput {
  points: Array<{ x: number; y: number }>;
  x?: number;  // Label position
  y?: number;
}

// Typed graph
const g = new dagre.graphlib.Graph<
  DagreGraphLabel,
  DagreNodeInput,
  DagreEdgeInput
>();
```

---

## Recipes & Patterns

### Multi-Root DAG Layout

```typescript
function layoutMultiRootDAG(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB' });
  g.setDefaultEdgeLabel(() => ({}));
  
  // Find root nodes (no incoming edges)
  const targets = new Set(edges.map(e => e.target));
  const roots = nodes.filter(n => !targets.has(n.id));
  
  // Add virtual root if multiple roots
  if (roots.length > 1) {
    g.setNode('__root__', { width: 0, height: 0 });
    roots.forEach(r => {
      g.setEdge('__root__', r.id, { weight: 0, minlen: 0 });
    });
  }
  
  nodes.forEach(n => g.setNode(n.id, { width: 150, height: 50 }));
  edges.forEach(e => g.setEdge(e.source, e.target));
  
  dagre.layout(g);
  
  // Remove virtual root and shift coordinates
  if (roots.length > 1) {
    g.removeNode('__root__');
  }
  
  return nodes.map(n => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 75, y: pos.y - 25 } };
  });
}
```

### Compound Graph (Groups)

```typescript
function layoutWithGroups(
  nodes: Node[],
  edges: Edge[],
  parentMap: Map<string, string>
) {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 50 });
  g.setDefaultEdgeLabel(() => ({}));
  
  // Add all nodes
  nodes.forEach(n => {
    g.setNode(n.id, {
      width: n.width ?? 150,
      height: n.height ?? 50,
    });
    
    // Set parent relationship
    const parent = parentMap.get(n.id);
    if (parent) {
      g.setParent(n.id, parent);
    }
  });
  
  edges.forEach(e => g.setEdge(e.source, e.target));
  
  dagre.layout(g);
  
  return nodes.map(n => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - (n.width ?? 150) / 2, y: pos.y - (n.height ?? 50) / 2 },
      // Parent nodes get computed dimensions
      width: pos.width,
      height: pos.height,
    };
  });
}
```

### Incremental Layout (Only New Nodes)

```typescript
const positionCache = new Map<string, { x: number; y: number }>();

function incrementalLayout(nodes: Node[], edges: Edge[]) {
  const newNodes = nodes.filter(n => !positionCache.has(n.id));
  
  if (newNodes.length === 0) {
    // Return cached positions
    return nodes.map(n => ({
      ...n,
      position: positionCache.get(n.id)!,
    }));
  }
  
  // Full layout
  const { nodes: layouted } = getLayoutedElements(nodes, edges);
  
  // Update cache
  layouted.forEach(n => {
    positionCache.set(n.id, n.position);
  });
  
  return layouted;
}
```

### Animated Layout Transitions

```tsx
import { useSpring, animated } from '@react-spring/web';

function AnimatedNode({ data, positionAbsoluteX, positionAbsoluteY }: NodeProps) {
  const style = useSpring({
    left: positionAbsoluteX,
    top: positionAbsoluteY,
    config: { tension: 300, friction: 30 },
  });
  
  return (
    <animated.div style={style} className="animated-node">
      {data.label}
    </animated.div>
  );
}
```

### Connection Validation

```tsx
const isValidConnection = useCallback((connection: Connection) => {
  const nodes = getNodes();
  const edges = getEdges();
  
  // Prevent self-connections
  if (connection.source === connection.target) return false;
  
  // Prevent duplicate edges
  const exists = edges.some(
    e => e.source === connection.source && e.target === connection.target
  );
  if (exists) return false;
  
  // Prevent cycles
  const wouldCreateCycle = checkCycle(
    nodes,
    [...edges, connection as Edge]
  );
  if (wouldCreateCycle) return false;
  
  return true;
}, [getNodes, getEdges]);

function checkCycle(nodes: Node[], edges: Edge[]): boolean {
  const g = new dagre.graphlib.Graph();
  nodes.forEach(n => g.setNode(n.id));
  edges.forEach(e => g.setEdge(e.source, e.target));
  return !dagre.graphlib.alg.isAcyclic(g);
}
```

---

## Troubleshooting

### Nodes Overlap

**Cause**: Insufficient spacing or missing dimensions

**Solution**:
```typescript
g.setGraph({
  nodesep: 100,  // Increase horizontal spacing
  ranksep: 100,  // Increase vertical spacing
});

// Ensure all nodes have dimensions
g.setNode(id, {
  width: node.measured?.width ?? 150,  // Always provide fallback
  height: node.measured?.height ?? 50,
});
```

### Layout Jumps on Re-render

**Cause**: Node IDs or dimensions changing

**Solution**:
```typescript
// Use stable IDs
const nodeId = `${type}-${stableIdentifier}`;

// Memoize layout function
const layoutedNodes = useMemo(
  () => getLayoutedElements(nodes, edges),
  [JSON.stringify(nodes.map(n => n.id)), JSON.stringify(edges)]
);
```

### Edges Don't Connect to Handles

**Cause**: Coordinate system mismatch (dagre uses center, React Flow uses top-left)

**Solution**:
```typescript
// Convert dagre center coords to React Flow top-left
position: {
  x: dagreNode.x - nodeWidth / 2,
  y: dagreNode.y - nodeHeight / 2,
}
```

### Cycles Cause Infinite Loop

**Cause**: Graph has cycles that dagre can't resolve

**Solution**:
```typescript
// Check before layout
if (!dagre.graphlib.alg.isAcyclic(g)) {
  console.warn('Graph has cycles, using greedy cycle removal');
  g.setGraph({ ...g.graph(), acyclicer: 'greedy' });
}
```

### Layout Takes Too Long

**Cause**: Large graph or expensive heuristics

**Solution**:
```typescript
// Disable crossing optimization
dagre.layout(g, { disableOptimalOrderHeuristic: true });

// Use faster ranker
g.setGraph({ ranker: 'longest-path' });

// Move to Web Worker
const worker = new Worker('./layout.worker.ts');
```

### TypeScript: Property 'x' Does Not Exist

**Cause**: Accessing layout results before calling `dagre.layout()`

**Solution**:
```typescript
// Always call layout first
dagre.layout(g);

// Then access properties
const node = g.node('id');
console.log(node.x, node.y);  // Now defined
```

---

## Resources

### Documentation
- [React Flow Docs](https://reactflow.dev/)
- [Dagre Wiki](https://github.com/dagrejs/dagre/wiki)

### Examples
- [React Flow Examples](https://reactflow.dev/examples)
- [n8n Workflow Editor](https://github.com/n8n-io/n8n)
- [Supabase Schema Viewer](https://github.com/supabase/supabase)

### Algorithm References
- Gansner et al. (1993). "A technique for drawing directed graphs"
- Brandes & Kopf (2002). "Fast and simple horizontal coordinate assignment"

### Alternatives
- **ELK**: For large/complex graphs (WebAssembly)
- **Graphviz**: Server-side, publication quality
- **D3-Force**: Undirected, force-directed layouts
