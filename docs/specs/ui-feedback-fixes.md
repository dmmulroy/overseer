# UI Feedback Fixes Spec

**Created:** 2026-02-01  
**Status:** Draft  
**Author:** Agent (Oracle-reviewed)

## Overview

This spec addresses user feedback on the Overseer Task Viewer UI. Issues span graph view, detail panel, timestamps, kanban, list view, and animations.

---

## Issues Summary

| # | Category | Issue | Severity |
|---|----------|-------|----------|
| 1 | Graph | Tiny on load | Medium |
| 2 | Graph | Hotkey hint overlaps zoom controls | Low |
| 3 | Graph | Minimap broken (black screen) | High |
| 4 | Graph | Node overlap when zoomed | Medium |
| 5 | Panel | Open by default | Medium |
| 6 | Panel | No resize handle | Medium |
| 7 | Keys | D key confusion (toggle vs delete) | High |
| 8 | Time | Always shows "just now" | High |
| 9 | Time | Flash on update | Medium |
| 10 | Kanban | Sidebar overlaps cards | Medium |
| 11 | Kanban | Column order wrong | Low |
| 12 | Kanban | No filters | Medium |
| 13 | Filter | No milestone filter (all views) | Medium |
| 14 | List | Can't collapse subtrees | Medium |
| 15 | Anim | Animations not visible | Low |

---

## Root Cause Analysis

### Timestamp Issues (#8, #9)
- **"Just now" forever**: Using TanStack Query's `dataUpdatedAt` which updates on every 5s refetch, not actual data changes
- **Flash**: Passing `isFetching` as `isLoading`, causing "syncing..." to blink and hide timestamp repeatedly

### D Key Conflict (#7)
- Global scope: `d` → toggle detail panel
- Detail scope: `d` → delete task
- When detail panel is open with task selected, both scopes are active
- Current keyboard system: "most recently activated scope wins"
- User confusion: pressing `d` to close panel can trigger delete if detail scope activated last

### Animation Visibility (#15)
- `animate-pulse-active`: Scaling 10px dot by 1.15x is too subtle
- `animate-flash-change`: Ends at `background-color: transparent` with `forwards`, causes pop-back when class removed

---

## Implementation Plan

### Phase 1: Critical Fixes

#### 1.1 Panel Closed by Default

**File:** `ui/src/client/lib/store.ts`

```diff
 export const useUIStore = create<UIStore>((set) => ({
   viewMode: "graph",
   selectedTaskId: null,
   focusedTaskId: null,
-  detailPanelOpen: true,
+  detailPanelOpen: false,
```

**Behavior note:** Keep auto-open on task selection (current behavior in `setSelectedTaskId`).

#### 1.2 Remove Minimap

**File:** `ui/src/client/components/TaskGraph.tsx`

Remove:
1. `showMinimap` state (line 821)
2. `onToggleMinimap` callback and prop drilling
3. `m` keyboard shortcut (lines 785-790)
4. `<MiniMap>` component (lines 946-966)
5. Minimap toggle button (lines 970-1011)

**File:** `ui/src/client/styles/global.css`

Remove:
```css
/* React Flow MiniMap theming */
.react-flow-minimap-themed {
  background-color: var(--color-surface-primary) !important;
  border: 1px solid var(--color-border) !important;
}
```

#### 1.3 Fix Hotkey Hint Overlap

**File:** `ui/src/client/components/TaskGraph.tsx`

```diff
-      <div className="absolute bottom-4 left-4 z-10 px-2 py-1 ...">
+      <div className="absolute bottom-16 left-4 z-10 px-2 py-1 ...">
```

**Alternative (cleaner):** Move ReactFlow `<Controls position="top-left" />` instead.

#### 1.4 Fix D Key Conflict

Change delete hotkey from `d` to `Backspace`.

**File:** `ui/src/client/components/TaskDetail.tsx`

```diff
       {
-        key: "d",
+        key: "Backspace",
         description: "Delete task",
         scope: "detail",
         handler: () => {
           if (!task.completed) {
             setShowDeleteDialog(true);
           }
         },
       },
```

Update UI hint in footer:
```diff
           <Button variant="danger" ...>
             Delete
-            <Kbd size="sm" className="ml-1">d</Kbd>
+            <Kbd size="sm" className="ml-1">⌫</Kbd>
           </Button>
```

Update `KeyboardHelp.tsx` if it lists the shortcut.

---

### Phase 2: Timestamp & Loading Fix

#### 2.1 Derive lastUpdated from Task Data

**File:** `ui/src/client/App.tsx`

```typescript
// Replace:
const lastUpdated = dataUpdatedAt
  ? new Date(dataUpdatedAt).toISOString()
  : undefined;

// With:
const lastUpdated = useMemo(() => {
  if (!tasks?.length) return undefined;
  return tasks.reduce((max, t) => 
    t.updatedAt > max ? t.updatedAt : max, 
    tasks[0].updatedAt
  );
}, [tasks]);
```

#### 2.2 Fix Loading Props

**File:** `ui/src/client/App.tsx`

```diff
 <Header
   lastUpdated={lastUpdated}
   isError={error !== null}
-  isLoading={isFetching}
+  isLoading={isLoading}
+  isRefetching={isFetching && !isLoading}
 />
```

**File:** `ui/src/client/components/Header.tsx`

```diff
 interface HeaderProps {
   lastUpdated?: string;
   isError?: boolean;
   isLoading?: boolean;
+  isRefetching?: boolean;
 }
```

Update display logic:
```typescript
{/* Loading indicator - only on initial load */}
{isLoading && (
  <span className="text-xs text-text-dim font-mono">loading...</span>
)}

{/* Refetch indicator - subtle, doesn't hide timestamp */}
{isRefetching && !isLoading && (
  <span className="text-xs text-text-dim font-mono opacity-50">•</span>
)}

{/* Last updated - always show when available */}
{lastUpdated && !isLoading && (
  <span className="text-xs text-text-dim font-mono">
    {formatRelativeTime(new Date(lastUpdated))}
  </span>
)}
```

---

### Phase 3: Layout & Spacing

#### 3.1 Resizable Detail Panel

**File:** `ui/src/client/lib/store.ts`

Add to state:
```typescript
interface UIState {
  // ...existing
  detailPanelHeight: number;
}

// Initial state
detailPanelHeight: 320,

// Actions
setDetailPanelHeight: (height: number) => 
  set({ detailPanelHeight: Math.min(Math.max(height, 120), window.innerHeight * 0.6) }),
```

**File:** `ui/src/client/components/DetailPanel.tsx`

```tsx
import { useCallback, useRef, useEffect } from "react";

export function DetailPanel() {
  const detailPanelHeight = useUIStore((s) => s.detailPanelHeight);
  const setDetailPanelHeight = useUIStore((s) => s.setDetailPanelHeight);
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = detailPanelHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [detailPanelHeight]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const delta = startY.current - e.clientY;
    setDetailPanelHeight(startHeight.current + delta);
  }, [setDetailPanelHeight]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div 
      className={panel({ open: detailPanelOpen })}
      style={detailPanelOpen ? { height: detailPanelHeight } : undefined}
    >
      {/* Resize handle - only when open */}
      {detailPanelOpen && (
        <div
          className="h-1 cursor-ns-resize bg-border hover:bg-accent transition-colors shrink-0"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      )}
      
      {/* Toggle bar */}
      <button className="h-10 px-4 flex items-center ...">
        ...
      </button>
      
      {/* Content */}
      ...
    </div>
  );
}
```

Update panel styling to use dynamic height:
```typescript
const panel = tv({
  base: [
    "border-t border-border bg-bg-secondary flex flex-col",
  ],
  variants: {
    open: {
      true: "", // height set via style prop
      false: "h-10",
    },
  },
});
```

#### 3.2 Increase Node Spacing

**File:** `ui/src/client/components/TaskGraph.tsx`

```diff
   dagreGraph.setGraph({
     rankdir: "LR",
-    nodesep: 24,
+    nodesep: 40,
     ranksep: 80,
     marginx: 24,
     marginy: 24,
   });
```

#### 3.3 Kanban Column Reorder

**File:** `ui/src/client/components/views/KanbanView.tsx`

```diff
-const COLUMNS: StatusColumn[] = ["pending", "active", "blocked", "done"];
+const COLUMNS: StatusColumn[] = ["pending", "blocked", "active", "done"];
```

---

### Phase 4: Graph Initial Zoom

**File:** `ui/src/client/components/TaskGraph.tsx`

Add zoom clamping after initial render:

```typescript
// In TaskGraph component, add effect after ReactFlow renders:
const { fitView, getZoom, setViewport, getViewport } = useReactFlow();

useEffect(() => {
  // After initial layout, clamp zoom if too small
  const timer = setTimeout(() => {
    const zoom = getZoom();
    if (zoom < 0.25) {
      const viewport = getViewport();
      setViewport({ ...viewport, zoom: 0.25 });
    }
  }, 100); // Small delay for dagre layout to complete
  return () => clearTimeout(timer);
}, [tasks.length]); // Re-run when task count changes significantly
```

**Alternative approach:** Reduce fitView padding for larger initial size:

```diff
 <ReactFlow
   ...
   fitView
-  fitViewOptions={{ padding: 0.2 }}
+  fitViewOptions={{ padding: 0.1, minZoom: 0.25 }}
```

---

### Phase 5: Filtering (URL-based)

#### 5.1 Create URL State Hook

**File:** `ui/src/client/lib/use-url-filter.ts` (new file)

```typescript
import { useState, useEffect, useCallback } from "react";
import type { TaskId } from "../../types.js";

/**
 * Hook for URL-based milestone filter state.
 * Uses ?milestone=task_xxx param, replaceState to avoid history spam.
 */
export function useMilestoneFilter() {
  // Initialize from URL
  const [filterMilestoneId, setFilterInternal] = useState<TaskId | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("milestone") as TaskId | null;
  });

  // Sync URL on change
  const setFilterMilestoneId = useCallback((id: TaskId | null) => {
    setFilterInternal(id);
    
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("milestone", id);
    } else {
      url.searchParams.delete("milestone");
    }
    window.history.replaceState({}, "", url.toString());
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      setFilterInternal(params.get("milestone") as TaskId | null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return [filterMilestoneId, setFilterMilestoneId] as const;
}
```

#### 5.2 Add Filter UI to Header

**File:** `ui/src/client/components/Header.tsx`

```tsx
interface HeaderProps {
  // ...existing
  milestones?: Task[];
  filterMilestoneId: TaskId | null;
  onFilterChange: (id: TaskId | null) => void;
}

// In Header, after view tabs:
<div className="flex items-center gap-2">
  {/* Milestone filter dropdown */}
  {milestones && milestones.length > 0 && (
    <select
      value={filterMilestoneId ?? ""}
      onChange={(e) => onFilterChange(e.target.value as TaskId || null)}
      className="px-2 py-1 text-xs font-mono bg-surface-primary border border-border rounded text-text-primary focus:border-accent focus:outline-none"
    >
      <option value="">All milestones</option>
      {milestones.map((m) => (
        <option key={m.id} value={m.id}>
          {m.description.slice(0, 30)}
        </option>
      ))}
    </select>
  )}

  {/* Active filter chip - loud indicator */}
  {filterMilestoneId && (
    <div className="flex items-center gap-1 px-2 py-1 bg-accent-subtle border border-accent/30 rounded">
      <span className="text-[10px] font-mono text-accent uppercase tracking-wider">
        Filtered
      </span>
      <button
        onClick={() => onFilterChange(null)}
        className="text-accent hover:text-accent-muted ml-1"
        aria-label="Clear milestone filter"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  )}
</div>
```

#### 5.3 Compute Visible Tasks with External Blockers

**File:** `ui/src/client/App.tsx`

```typescript
import { useMilestoneFilter } from "./lib/use-url-filter.js";

// In AppContent:
const [filterMilestoneId, setFilterMilestoneId] = useMilestoneFilter();

// Get milestones for filter dropdown
const milestones = useMemo(() => 
  tasks?.filter((t) => t.depth === 0) ?? [],
  [tasks]
);

// Validate filter exists (clear if milestone deleted)
useEffect(() => {
  if (filterMilestoneId && tasks) {
    const exists = tasks.some(t => t.id === filterMilestoneId && t.depth === 0);
    if (!exists) {
      setFilterMilestoneId(null);
    }
  }
}, [tasks, filterMilestoneId, setFilterMilestoneId]);

// Compute visible tasks and external blockers
const { visibleTasks, externalBlockers } = useMemo(() => {
  if (!tasks) return { visibleTasks: [], externalBlockers: new Map() };
  if (!filterMilestoneId) return { visibleTasks: tasks, externalBlockers: new Map() };
  
  // Get all descendants of selected milestone
  const descendants = new Set<TaskId>([filterMilestoneId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (task.parentId && descendants.has(task.parentId) && !descendants.has(task.id)) {
        descendants.add(task.id);
        changed = true;
      }
    }
  }
  
  const visible = tasks.filter((t) => descendants.has(t.id));
  
  // Find external blockers (blockers not in visible set)
  const external = new Map<TaskId, Task>();
  for (const task of visible) {
    for (const blockerId of task.blockedBy ?? []) {
      if (!descendants.has(blockerId)) {
        const blocker = tasks.find(t => t.id === blockerId);
        if (blocker) {
          external.set(blockerId, blocker);
        }
      }
    }
  }
  
  return { visibleTasks: visible, externalBlockers: external };
}, [tasks, filterMilestoneId]);

// Clear selection if filtered out
useEffect(() => {
  if (selectedTaskId && visibleTasks.length > 0) {
    const stillVisible = visibleTasks.some((t) => t.id === selectedTaskId);
    if (!stillVisible) {
      setSelectedTaskId(null);
    }
  }
}, [visibleTasks, selectedTaskId, setSelectedTaskId]);
```

Pass to views (including external blockers for graph):
```tsx
<ViewContainer
  viewMode={viewMode}
  tasks={visibleTasks}
  externalBlockers={externalBlockers}  // new prop for graph view
  selectedId={selectedTaskId}
  onSelect={handleTaskSelect}
/>
```

---

### Phase 6: List View Collapse

**File:** `ui/src/client/components/TaskList.tsx`

#### 6.1 Add Collapse State

```typescript
const [collapsedIds, setCollapsedIds] = useState<Set<TaskId>>(new Set());

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
```

#### 6.2 Update Visibility Logic

```typescript
// Update flatVisibleTasks to exclude collapsed descendants
const flatVisibleTasks = useMemo(() => {
  const result: Task[] = [];

  function traverse(parentId: TaskId | null): void {
    const children = tasksByParent.get(parentId) ?? [];
    for (const child of children) {
      if (visibleTaskIds.has(child.id)) {
        result.push(child);
        // Only traverse children if not collapsed
        if (!collapsedIds.has(child.id)) {
          traverse(child.id);
        }
      }
    }
  }

  traverse(null);
  return result;
}, [tasksByParent, visibleTaskIds, collapsedIds]);
```

#### 6.3 Add Toggle Button to TaskItem

```tsx
function TaskItem({ task, hasChildren, isCollapsed, onToggleCollapse, ...props }) {
  return (
    <button ...>
      <div className="flex items-center gap-2">
        {/* Collapse toggle for nodes with children */}
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(task.id);
            }}
            className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            >
              <path d="M3 1L7 5L3 9" stroke="currentColor" fill="none" />
            </svg>
          </button>
        )}
        
        {/* Tree prefix */}
        {treePrefix && !hasChildren && (
          <span className="text-text-dim font-mono text-sm select-none whitespace-pre flex-shrink-0 w-4">
            {/* spacer for alignment */}
          </span>
        )}
        
        ...rest of item
      </div>
    </button>
  );
}
```

---

### Phase 7: Animation Fixes

**File:** `ui/src/client/styles/global.css`

#### 7.1 Enhance Pulse Animation

```css
@keyframes pulse-active {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
    box-shadow: 0 0 0 0 oklch(0.7 0.18 45 / 0);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.25);
    box-shadow: 0 0 8px 4px oklch(0.7 0.18 45 / 0.4);
  }
}

.animate-pulse-active {
  animation: pulse-active 2s ease-in-out infinite;
}
```

#### 7.2 Fix Flash Animation

```css
@keyframes flash-change {
  0% {
    background-color: var(--color-accent-subtle);
  }
  100% {
    background-color: var(--color-surface-primary);
  }
}

.animate-flash-change {
  animation: flash-change 1s ease-out;
  /* Removed 'forwards' - let element return to normal styling */
}
```

---

## Testing Checklist

### Phase 1
- [ ] Panel starts closed on fresh page load
- [ ] Selecting task opens panel
- [ ] Minimap button and 'm' shortcut removed
- [ ] Hotkey hint doesn't overlap zoom controls
- [ ] `d` toggles panel globally
- [ ] `Backspace` deletes task when in detail view

### Phase 2
- [ ] Timestamp shows actual last data change, not "just now" forever
- [ ] "syncing..." only shows on initial load, not refetches
- [ ] No timestamp flash during background refetch

### Phase 3
- [ ] Can drag panel resize handle to change height
- [ ] Panel height persists across view switches
- [ ] Panel height persists across page reloads (localStorage)
- [ ] Height clamped to min 120px, max 60vh
- [ ] Graph nodes have more vertical spacing
- [ ] Kanban columns: Pending → Blocked → Active → Done

### Phase 4
- [ ] Graph not tiny on initial load
- [ ] Zoom level at least 0.25 after fitView

### Phase 5
- [ ] Milestone dropdown appears in header
- [ ] Selecting milestone filters all views
- [ ] "All milestones" shows everything
- [ ] Selection cleared if filtered out
- [ ] URL updates with `?milestone=task_xxx` on filter change
- [ ] Page reload preserves filter from URL
- [ ] Browser back/forward navigates filter state
- [ ] Filter auto-clears if milestone deleted
- [ ] "Filtered" chip visible when filter active
- [ ] External blockers shown as placeholder nodes in graph
- [ ] External blocker count badge in list/kanban

### Phase 6
- [ ] Can collapse/expand any task with children in list view
- [ ] Keyboard navigation skips collapsed descendants
- [ ] Collapse state persists during session

### Phase 7
- [ ] Active status indicator has visible glow/pulse
- [ ] Task change flash visible without weird pop-back

---

## Design Decisions (Oracle-reviewed)

### 1. Panel Height Persistence → **localStorage**

**Decision:** Persist panel height in localStorage with versioned key.

**Implementation:**
```typescript
// Key: ui.layout.v1.detailPanelHeight
const LAYOUT_STORAGE_KEY = "ui.layout.v1.detailPanelHeight";

// On mount: load from localStorage, validate, clamp
const loadPanelHeight = (): number => {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (stored) {
      const height = parseInt(stored, 10);
      if (!isNaN(height) && height >= 120 && height <= window.innerHeight * 0.6) {
        return height;
      }
    }
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
  return 320; // default
};

// On change: persist
const savePanelHeight = (height: number): void => {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, String(height));
  } catch {
    // Silently fail
  }
};
```

**Rationale:**
- Panel height is a personal layout preference
- Local-first apps should remember user customizations
- Versioned key allows safe migration if schema changes
- Matches user expectation that "my machine remembers my setup"

**Guardrails:**
- Validate/clamp on load (handle corrupt or out-of-range values)
- Single key, no cruft accumulation
- Provide "Reset layout" action (future: command palette)

---

### 2. Filter Persistence → **URL param** (`?milestone=task_xxx`)

**Decision:** Store milestone filter in URL, not localStorage.

**Implementation:**
```typescript
// Read from URL on mount
const getInitialMilestoneFilter = (): TaskId | null => {
  const params = new URLSearchParams(window.location.search);
  const milestone = params.get("milestone");
  return milestone as TaskId | null;
};

// Update URL on filter change (replaceState to avoid history spam)
const updateMilestoneFilter = (id: TaskId | null): void => {
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set("milestone", id);
  } else {
    url.searchParams.delete("milestone");
  }
  window.history.replaceState({}, "", url.toString());
};

// On data load: validate filter still exists
useEffect(() => {
  if (filterMilestoneId && tasks) {
    const exists = tasks.some(t => t.id === filterMilestoneId && t.depth === 0);
    if (!exists) {
      setFilterMilestoneId(null); // Auto-clear stale filter
    }
  }
}, [tasks, filterMilestoneId]);
```

**UI requirement:** Always show visible filter indicator when active:
```tsx
{filterMilestoneId && (
  <div className="flex items-center gap-2 px-2 py-1 bg-accent-subtle border border-accent rounded">
    <span className="text-xs font-mono text-accent">
      Milestone: {selectedMilestone?.description.slice(0, 20)}
    </span>
    <button 
      onClick={() => setFilterMilestoneId(null)}
      className="text-accent hover:text-accent-muted"
      aria-label="Clear filter"
    >
      ×
    </button>
  </div>
)}
```

**Rationale:**
- URL state is explicit, not hidden memory
- Reload/back/forward/bookmark/share all behave transparently
- Avoids "why is my list empty?" confusion
- Single param minimal clutter, provides debuggability

**Guardrails:**
- Auto-clear if milestone deleted (replaceState to remove param)
- Loud visual indicator prevents "forgot I filtered" confusion
- Single-keystroke clear (Escape or click ×)

---

### 3. Blocker Edges When Filtered → **External placeholder nodes**

**Decision:** Show blockers pointing outside filter as "external" stub nodes, not hidden.

**Implementation (Graph view):**
```typescript
// When building graph, for blockers outside visible set:
interface ExternalBlockerNode {
  id: string; // e.g., "external-{blockerId}"
  type: "external";
  data: {
    taskId: TaskId;
    taskDescription?: string; // if available from full task list
    milestoneName?: string;
  };
}

// Render external node as compact stub:
const ExternalNodeComponent = ({ data }: NodeProps<ExternalBlockerNode>) => (
  <div 
    className="px-2 py-1 bg-surface-secondary border border-dashed border-text-dim rounded text-xs text-text-muted"
    title={`External: ${data.taskDescription ?? data.taskId}`}
  >
    <span className="opacity-50">↗</span> External task
    {data.milestoneName && (
      <span className="ml-1 text-text-dim">({data.milestoneName})</span>
    )}
  </div>
);

// Edge to external node: dashed, muted
const externalEdgeStyle = {
  stroke: "var(--color-text-dim)",
  strokeDasharray: "4,4",
  opacity: 0.5,
};
```

**Implementation (List/Kanban view):**
```tsx
// Badge for tasks with external blockers
{hasExternalBlockers && (
  <span className="text-[10px] font-mono text-status-blocked opacity-70">
    + {externalBlockerCount} external
  </span>
)}
```

**Future enhancement:** "Reveal external task" action that temporarily expands filter scope.

**Rationale:**
- Hiding loses critical scheduling info (task appears unblocked when it isn't)
- Auto-including breaks filter semantics and can explode scope
- Placeholder preserves information density while signaling "outside your slice"
- Consistent mental model: filter controls scope, but dependencies are always truthful

**Guardrails:**
- If task details unavailable, show count: "Blocked by 2 external tasks"
- External nodes not selectable (no detail panel for them)
- Tooltip shows full task ID for debugging

---

## Future Considerations

1. **Multi-milestone filter**: URL could accept `milestone=x&milestone=y`. Defer until requested.
2. **"Reveal external" action**: Temporary scope expansion. Medium effort, defer.
3. **Reset layout command**: Add to command palette when implemented.

---

## References

- User feedback session: 2026-02-01
- Oracle review: ses_3e4ce24e4ffeMbAVBZR7conbp1
- Related files:
  - `ui/src/client/lib/store.ts`
  - `ui/src/client/components/TaskGraph.tsx`
  - `ui/src/client/components/views/KanbanView.tsx`
  - `ui/src/client/components/TaskList.tsx`
  - `ui/src/client/components/DetailPanel.tsx`
  - `ui/src/client/components/TaskDetail.tsx`
  - `ui/src/client/components/Header.tsx`
  - `ui/src/client/App.tsx`
  - `ui/src/client/styles/global.css`
