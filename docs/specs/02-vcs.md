# VCS Model and Stacked Diffs

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 01-core-domain (Task, TaskVcs, Repo, IDs)  
**Blocks:** 03-review, 05-relay

## Overview

This spec defines the VCS abstraction, jj-first semantics, stacked diff rules, and TaskVcs lifecycle. It is the canonical contract for VCS-related APIs and algorithms.

**Principles**
- jj-first, ChangeId stable across rewrites.
- VCS artifacts are separate from tasks (TaskVcs).
- Stacked diffs: each task diff is based on parent head.
- Preserve refs on complete; archive/gc cleans up.

---

## Inputs/Outputs

### VcsBackend API (conceptual)

```rust
pub trait VcsBackend {
    fn detect(repo_path: &Path) -> Result<VcsType, VcsError>;
    fn ensure_clean(repo_path: &Path) -> Result<(), VcsError>;
    fn head_commit(repo_path: &Path) -> Result<String, VcsError>;
    fn create_ref(repo_path: &Path, name: &str) -> Result<String, VcsError>; // returns change_id or branch name
    fn checkout_ref(repo_path: &Path, name: &str) -> Result<(), VcsError>;
    fn commit_all(repo_path: &Path, message: &str) -> Result<String, VcsError>; // returns commit id
    fn diff_range(repo_path: &Path, base: &str, head: &str) -> Result<Diff, VcsError>;
    fn delete_ref(repo_path: &Path, name: &str) -> Result<(), VcsError>;
}
```

### Diff

```rust
pub struct Diff {
    pub base: String,
    pub head: String,
    pub unified: String,
    pub files: Vec<DiffFile>,
}

pub struct DiffFile {
    pub path: String,
    pub hunks: Vec<DiffHunk>,
}

pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

pub struct DiffLine {
    pub kind: DiffLineKind,
    pub content: String,
}

pub enum DiffLineKind { Add, Remove, Context }
```

### Errors

```rust
pub enum VcsError {
    RepoNotFound,
    DirtyWorkingCopy,
    RefAlreadyExists { name: String },
    RefNotFound { name: String },
    CommitFailed { reason: String },
    DiffFailed { reason: String },
    BackendError { reason: String },
}
```

---

## TaskVcs Lifecycle

### Start

Input: `AnyTaskId`, `RepoId`, optional `base_commit` override (human only).  
Output: `TaskVcs` created, task status -> InProgress.

Algorithm:
1. Ensure repo clean (no uncommitted changes).
2. Resolve base commit:
   - If task has parent: base = parent TaskVcs.head_commit (must exist).
   - Else: base = repo main HEAD.
3. Create ref/branch/bookmark with deterministic name (see naming).
4. Checkout ref and record TaskVcs.

### Submit

Input: `AnyTaskId`, commit message.  
Output: `TaskVcs.head_commit` updated, task status -> InReview, Review created.

Algorithm:
1. Ensure repo clean OR only staged changes allowed (implementation choice, must be consistent).
2. Commit all changes to VCS (single commit per submit).
3. Set `head_commit` to resulting commit id.
4. Emit events: `Committed`, `TaskSubmitted`, `ReviewCreated`.

### Archive

Input: `AnyTaskId`.  
Output: `TaskVcs.archived_at` set, VCS ref deleted.

Rules:
- Allowed for Completed or Cancelled tasks only.
- Archive preserves Task and Review history.
- GC may call archive for eligible tasks.

---

## Stacked Diff Rules

### Base/Head Selection

- For any task with TaskVcs:
  - `base_commit` is recorded at start.
  - `head_commit` set on submit.
- Diff range: `base_commit..head_commit`.

### Parent/Child Rules

- Parent must have `head_commit` before child can submit.
- Child base = parent head at time of child start.
- Parent updates do not auto-rebase child; child must handle drift explicitly.

### Standalone Task

- base = repo main HEAD at start.
- No parent constraints.

### Algorithm: Resolve Base Commit

```
function resolve_base(task):
  if task.parent_id is None:
    return repo.head_commit(main)
  parent_vcs = task_vcs_repo.get(task.parent_id)
  if parent_vcs.head_commit is None:
    return error("parent not submitted")
  return parent_vcs.head_commit
```

---

## jj vs git Mapping

### jj

- `ref_name` = bookmark name (e.g., `task/task_01HX...`).
- `change_id` = jj ChangeId (stable).
- `start_commit` = commit id at start.
- `head_commit` = commit id at submit.

### git

- `ref_name` = branch name (e.g., `task/task_01HX...`).
- `change_id` = branch name (stable ref surrogate).
- `start_commit` = commit SHA at start.
- `head_commit` = commit SHA at submit.

### Ref Naming

```
task/{task_id}
```

Rules:
- Unique per repo.
- Deterministic from task id.
- Reserved namespace `task/`.

---

## REST/OpenAPI Endpoints (Full Catalog)

All endpoints are under `/api`.

### Tasks
- `POST /tasks`
- `GET /tasks/{id}`
- `GET /tasks`
- `PATCH /tasks/{id}`
- `DELETE /tasks/{id}`
- `POST /tasks/{id}/start`
- `POST /tasks/{id}/submit`
- `POST /tasks/{id}/cancel`
- `POST /tasks/{id}/force-complete`
- `POST /tasks/{id}/set-status`
- `POST /tasks/{id}/block`
- `POST /tasks/{id}/unblock`
- `GET /tasks/tree`
- `GET /tasks/progress`
- `GET /tasks/next-ready`

### VCS
- `GET /vcs/task/{id}`
- `GET /vcs/task` (list by repo or filter)
- `POST /vcs/task/{id}/archive`
- `GET /vcs/diff/{id}`

### Reviews
- `GET /reviews/{id}`
- `GET /tasks/{id}/reviews/active`
- `GET /tasks/{id}/reviews`
- `POST /reviews/{id}/comments`
- `GET /reviews/{id}/comments`
- `POST /comments/{id}/resolve`
- `POST /reviews/{id}/approve`
- `POST /reviews/{id}/request-changes`

### Gates
- `POST /gates`
- `GET /gates`
- `GET /gates/effective/{task_id}`
- `DELETE /gates/{id}`
- `PATCH /gates/{id}`
- `GET /gates/results/{review_id}`
- `POST /gates/rerun/{review_id}`

### Help
- `POST /help`
- `POST /help/{id}/respond`
- `POST /help/{task_id}/resume`
- `GET /help/active/{task_id}`
- `GET /help/{task_id}`

### Learnings
- `POST /learnings/{task_id}`
- `GET /learnings/{task_id}`
- `GET /learnings/{task_id}/inherited`

### Repos
- `POST /repos`
- `GET /repos/{id}`
- `GET /repos/by-path`
- `GET /repos`
- `DELETE /repos/{id}`

### Events
- `GET /events`
- `GET /events/replay`
- `GET /events/subscribe` (SSE)
- `GET /events/stream` (WS)

### Relay
- `GET /relay/ws` (WS upgrade)

### Git-AI
- `POST /git-ai/review`
- `GET /git-ai/review/{id}`
- `GET /git-ai/review/{id}/result`

### Agent Primitives
- `POST /agents/register`
- `GET /agents/capabilities`
- `POST /sessions`
- `POST /sessions/{id}/heartbeat`
- `POST /sessions/{id}/complete`

---

## Invariants

- TaskVcs exists only for started tasks.
- `base_commit` is immutable after start.
- `head_commit` only set on submit.
- One TaskVcs per task.
- Refs are preserved on completion until archive/gc.

---

## Observability

- Emit `RefCreated`, `Committed`, `TaskSubmitted` events.
- Emit `TaskArchived` (new event in 04-events).

---

**Phase: DRAFT v1 | Status: Ready for review**
