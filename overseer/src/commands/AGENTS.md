# CLI COMMAND HANDLERS

Command handlers for `os` CLI - wire clap to core services.

## FILES

| File | Lines | Purpose |
|------|-------|---------|
| `task.rs` | 614 | Task CRUD, lifecycle, queries |
| `learning.rs` | - | Learning CRUD |
| `vcs.rs` | - | VCS operations (detect, status, log, diff, commit) |
| `data.rs` | - | Import/export tasks + learnings (JSON) |
| `mod.rs` | - | Re-exports all commands |

## PATTERNS

### Handler Signature

```rust
pub fn handle(conn: &Connection, cmd: FooCommand) -> Result<FooResult>
```

- **Input**: clap-parsed command enum (owned after clone in main.rs)
- **Output**: Domain result enum (converted to JSON in main.rs)
- **No I/O**: All formatting/printing in main.rs `print_human()`

### Command Cloning (main.rs:147-234)

Explicit field clones (no #[derive(Clone)] on Args structs):
```rust
fn clone_task_cmd(cmd: &TaskCommand) -> TaskCommand {
    match cmd {
        TaskCommand::Create(args) => TaskCommand::Create(CreateArgs { ... }),
    }
}
```

### ID Parsing

```rust
#[arg(value_parser = parse_task_id)]  // validates prefix at CLI boundary
```

### Result Enums

```rust
pub enum TaskResult {
    One(Task),
    OneWithContext(TaskWithContext),
    Many(Vec<Task>),
    Deleted,
    Tree(TaskTree),
}
```

## CONVENTIONS

- **No business logic**: Handlers delegate to services
- **Error propagation**: `?` operator throughout
- **Validation in services**: Handlers trust service layer
- **VCS handlers stateless**: No DB conn

## KEY FUNCTIONS (task.rs)

- `build_tree()` / `build_tree_recursive()`: Hierarchy construction
- `search_tasks()`: Substring matching across description/context/result
