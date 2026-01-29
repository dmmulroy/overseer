# OS (Rust CLI)

Overseer CLI binary. All business logic lives here - MCP wrapper just spawns and parses JSON.

## STRUCTURE

```
src/
├── main.rs           # Entry, clap CLI, JSON/human output (484 lines)
├── commands/         # Subcommand handlers (task, learning, vcs, data)
│   └── mod.rs        # Exports TaskCommand, LearningCommand, etc.
├── core/
│   ├── task_service.rs     # Business logic: validation, cycles (1407 lines)
│   ├── workflow_service.rs # Start/complete with VCS (816 lines)
│   └── context.rs          # Context chain assembly (480 lines)
├── db/
│   ├── schema.rs        # SQLite DDL, migrations
│   ├── task_repo.rs     # Task CRUD (388 lines)
│   └── learning_repo.rs # Learning CRUD
├── vcs/
│   ├── detection.rs     # Detect .jj/ vs .git/
│   ├── backend.rs       # VcsBackend trait, types
│   ├── jj.rs            # jj-lib (primary, 754 lines)
│   └── git.rs           # gix (fallback, 854 lines)
├── error.rs          # OsError enum (thiserror)
├── types.rs          # Task, CreateTaskInput, filters
└── id.rs             # TaskId, LearningId (prefixed ULIDs)
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Add CLI subcommand | `commands/{name}.rs` | Wire in `commands/mod.rs` + `main.rs` |
| Task validation | `core/task_service.rs` | Depth, cycles, blockers |
| Task lifecycle | `core/workflow_service.rs` | Start/complete with VCS |
| SQL queries | `db/task_repo.rs` | All raw SQL here |
| Schema changes | `db/schema.rs` | Bump `SCHEMA_VERSION` |
| VCS detection | `vcs/detection.rs` | Returns (VcsType, Option<PathBuf>) |
| Error variants | `error.rs` | Add to `OsError` enum |
| New ID type | `id.rs` | Follow TaskId pattern |

## CONVENTIONS

- **Result everywhere**: `error::Result<T>` = `Result<T, OsError>`
- **Prefixed IDs**: `task_01ARZ...`, `lrn_01ARZ...` - stored with prefix
- **Newtypes**: `TaskId`, `LearningId` implement `ToSql`/`FromSql`
- **serde rename_all**: Use `camelCase` for JSON output
- **Clone for clap**: Commands cloned before handle() (ownership)
- **VcsBackend trait**: All VCS ops go through trait, not concrete types
- **pollster::block_on**: jj-lib is async, block at boundaries

## ANTI-PATTERNS

- Never bypass `TaskService` for task mutations
- Never use depth limit for cycle detection - DFS in `would_create_*_cycle`
- Never hardcode VCS type - always detect via `detection.rs`
- Never store IDs without prefix - CHECK constraints enforce `task_%`/`lrn_%`
- Never skip foreign key pragma - `PRAGMA foreign_keys = ON` in `open_db`

## COMMANDS

```bash
cargo build --release   # Build CLI
cargo test              # Run tests
cargo test -- --nocapture  # See output
./target/release/os --help  # CLI usage
./target/release/os --json task list  # JSON mode
```

## TESTS

| Location | Type |
|----------|------|
| `tests/*.rs` | Integration (3 files) |
| `src/**/*.rs` | Unit (inline #[test]) |
| `testutil.rs` | Helpers: JjTestRepo, GitTestRepo |
