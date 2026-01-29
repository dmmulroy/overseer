# VCS MODULE

Native VCS backends: jj-lib (primary), gix (fallback). No subprocess spawning for read ops.

## FILES

| File | Lines | Purpose |
|------|-------|---------|
| `mod.rs` | - | Public API: `get_backend()`, `detect()`, re-exports |
| `backend.rs` | - | `VcsBackend` trait, error types, data structs |
| `detection.rs` | - | `detect_vcs_type()`: walks up dirs, `.jj/` before `.git/` |
| `jj.rs` | 754 | `JjBackend`: jj-lib native, sync via pollster |
| `git.rs` | 854 | `GixBackend`: gix for read ops, git CLI for commits |

## KEY OPERATIONS

### jj.rs
- `commit()`: Rewrite commit + rebase descendants + new working copy (lines 197-259)
- `squash()`: Parent rewrite with tree from working copy (lines 377-435)
- `resolve_to_commit_id()`: Bookmark/change ID resolution (lines 487-523)

### git.rs
- `status()`: gix status API with staged/worktree change detection
- `squash()`: Git reset --soft + recommit workflow (lines 458-542)
- `rebase_onto()`: Rebase with conflict detection/abort (lines 544-581)

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
