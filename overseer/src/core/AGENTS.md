# CORE BUSINESS LOGIC

Business logic layer - orchestrates task operations, validation, context assembly, learning inheritance.

## FILES

| File | Lines | Purpose |
|------|-------|---------|
| `mod.rs` | - | Module exports |
| `task_service.rs` | 1407 | Task CRUD, validation, cycle detection, depth enforcement |
| `workflow_service.rs` | 816 | Task lifecycle: start/complete with VCS |
| `context.rs` | 480 | Context chain assembly, learning aggregation |

## KEY ALGORITHMS

### DFS Cycle Detection (task_service.rs:267-301)

**Parent cycles**: Linear traversal up parent chain.
```
current -> parent -> parent.parent -> ... -> task_id? (cycle!)
```

**Blocker cycles**: DFS with visited set.
```
new_blocker -> its blockers -> their blockers -> ... -> task_id? (cycle!)
```
- HashSet for O(1) visited check
- Stack-based iteration (no recursion)
- Early termination on cycle found

### Next Ready Resolution (task_service.rs:419-548)

**`next_ready()`**: DFS to find deepest unblocked leaf
**`resolve_start_target()`**: Follows blockers to find startable work
**`collect_incomplete_leaves()`**: Recursive leaf path collection

### Context Chain Assembly (context.rs:57-83)

**Depth-based inheritance**:
- **Depth 0** (Milestone): own only
- **Depth 1** (Task): own + milestone (parent)
- **Depth 2** (Subtask): own + parent + milestone (grandparent)

### Learnings Bubbling (workflow_service.rs)

On task completion with learnings:
1. Learnings attached to completed task
2. Copy to immediate parent (preserves `source_task_id`)
3. Siblings see learnings after code merges to common ancestor

## PATTERNS

### Service Layer
- `TaskService<'a>` wraps all business logic
- `TaskWorkflowService<'a>` handles VCS-integrated lifecycle
- DB connection passed by reference (&Connection)
- All ops return `Result<T, OsError>`

### Validation Order
1. Existence checks (parent, blockers)
2. Cycle detection (more specific error)
3. Depth limit enforcement
4. DB mutation

### VCS Integration (workflow_service.rs)
- `start()`: Creates VCS bookmark
- `complete_with_learnings()`: Squashes commits, captures SHA, adds learnings
- Graceful degradation if no VCS
- VCS errors never block task state transitions
- Task state updated BEFORE VCS ops

## INVARIANTS

1. MAX_DEPTH = 2 (3 levels: 0, 1, 2)
2. Cycle detection BEFORE depth check
3. Depth always recomputed, never trusted from DB
4. Context chain matches depth semantics exactly
5. Learnings bubble to immediate parent only (preserves source_task_id)
6. VCS ops are best-effort
