# OS SOURCE

Rust CLI source. All business logic - MCP wrapper just spawns and parses JSON.

## MODULES

| Module | Purpose | Key Files |
|--------|---------|-----------|
| `commands/` | CLI subcommand handlers | task.rs, learning.rs, vcs.rs, data.rs |
| `core/` | Business logic layer | task_service.rs (1407), workflow_service.rs (816), context.rs (480) |
| `db/` | SQLite persistence | schema.rs, task_repo.rs (388), learning_repo.rs |
| `vcs/` | Native VCS backends | jj.rs (754), git.rs (854), detection.rs |

## ENTRY POINTS

| File | Purpose |
|------|---------|
| `main.rs` | clap CLI, JSON/human output, command dispatch (484 lines) |
| `lib.rs` | Re-exports for integration tests |

## DATA FLOW

```
main.rs (clap parse)
    |
    +-- commands/*.rs (dispatch)
    |       |
    |       +-- core/task_service.rs (validation, cycles)
    |       |       |
    |       |       +-- db/task_repo.rs (SQL)
    |       |
    |       +-- core/workflow_service.rs (VCS integration)
    |               |
    |               +-- vcs/*.rs (jj-lib or gix)
    |
    +-- print_human() or JSON output
```

## CONVENTIONS

- `Result<T>` = `Result<T, OsError>` (aliased in error.rs)
- Prefixed IDs: `task_*`, `lrn_*` with CHECK constraints
- `serde(rename_all = "camelCase")` for JSON
- `pollster::block_on` for jj-lib async at boundaries
- Clone commands before handle() (clap ownership)

## COMPLEXITY HOTSPOTS

| File | Lines | Key Algorithms |
|------|-------|----------------|
| `core/task_service.rs` | 1407 | DFS cycles, next_ready, resolve_start_target |
| `core/workflow_service.rs` | 816 | Complete with learnings, bubble_up_completion |
| `vcs/git.rs` | 854 | squash(), rebase_onto() |
| `vcs/jj.rs` | 754 | commit(), squash() with rebase_descendants |
