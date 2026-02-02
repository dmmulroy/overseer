# VCS MODULE

Native VCS backends: jj-lib (primary), gix (fallback). No subprocess spawning for read ops.

## FILES

| File | Lines | Purpose |
|------|-------|---------|
| `mod.rs` | - | Public API: `get_backend()`, `detect()`, re-exports |
| `backend.rs` | - | `VcsBackend` trait, error types, data structs |
| `detection.rs` | - | `detect_vcs_type()`: walks up dirs, `.jj/` before `.git/` |
| `jj.rs` | ~650 | `JjBackend`: jj-lib native, sync via pollster |
| `git.rs` | ~730 | `GixBackend`: gix for read ops, git CLI for commits |

## KEY OPERATIONS

### Common (both backends)
- `status()`: Working copy status (modified, added, deleted files)
- `log()`: Commit history with change IDs
- `commit()`: Snapshot working copy changes
- `create_bookmark()` / `delete_bookmark()`: Branch/bookmark management
- `checkout()`: Switch working copy to target
- `current_commit_id()`: Get HEAD/working copy commit ID
- `list_bookmarks()`: List branches/bookmarks with optional prefix filter

### jj.rs specifics
- `commit()`: Rewrite commit + rebase descendants + new working copy
- `resolve_to_commit_id()`: Bookmark/change ID resolution

### git.rs specifics
- `status()`: gix status API with staged/worktree change detection
- Uses git CLI for `commit()` - gix staging API unstable

## UNIFIED STACKING SEMANTICS

Both jj and git backends implement identical workflow behavior:
- **start**: Create bookmark/branch at HEAD, checkout
- **complete**: Commit → checkout start_commit → delete bookmark/branch
- This solves git's "cannot delete checked-out branch" error

## CONVENTIONS

- **jj-first**: Detection checks `.jj/` before `.git/` (detection.rs:9-10)
- **jj-lib pinned**: `=0.37` exact version - API breaks between minors
- **Workspace reload**: `JjBackend` reloads workspace per operation (no stale state)
- **gix commit fallback**: Uses git CLI for `commit()` - gix staging API unstable
- **Change ID format**: jj uses reverse-hex encoded change IDs, truncated to 8-12 chars
- **Timestamps**: `chrono::DateTime<Utc>` for all log entries

## ANTI-PATTERNS

- Never cache `Workspace`/`ReadonlyRepo` - reload each operation
- Never assume git CLI available in jj backend - use jj-lib only
- Never skip `rebase_descendants()` after `rewrite_commit()` in jj
- Never use async directly - jj-lib async blocked on pollster where needed
- Never check `.git/` first - jj repos can have both, jj takes precedence
