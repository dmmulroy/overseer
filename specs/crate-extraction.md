# Crate Extraction: Multi-Crate Workspace Rebuild

**Status:** Draft
**Type:** Architecture / Rebuild
**Effort:** XL (multi-week)
**Approach:** Tracer-bullet — thin end-to-end vertical slices proving crate boundaries

---

> **NO BACKWARDS COMPATIBILITY.** No migrations, no deprecation periods, no dual-schema support. Clean-slate DB schema. The best code is the code we don't write, keep, or maintain. Start from `main` bookmark, build fresh. `v2-greenfield` is read-only reference (`jj file show -r v2-greenfield -- <path>`).

---

## Table of Contents

- [Problem](#problem)
- [Scope](#scope)
  - [Keep from v2](#keep-from-v2)
  - [Drop from v2](#drop-from-v2)
  - [Preserve from main](#preserve-from-main-implement-fresh-using-main-as-reference)
- [Target Architecture](#target-architecture)
  - [Dependency Graph](#dependency-graph)
  - [Async Strategy](#async-strategy)
  - [Architecture Diagrams](#architecture-diagrams)
- [Interface Contracts](#interface-contracts)
- [Sequence Diagrams](#sequence-diagrams)
- [Simplified Store Trait](#simplified-store-trait)
- [Domain Types](#domain-types)
  - [IDs](#ids)
  - [Enums](#enums)
  - [Task](#task)
  - [Learning](#learning)
  - [TaskVcs](#taskvcs-separate-entity-v2-pattern)
  - [TaskContext](#taskcontext)
  - [InheritedLearnings](#inheritedlearnings)
  - [TaskWithContext](#taskwithcontext-enriched-response)
  - [TaskProgress](#taskprogress)
  - [TaskTree](#tasktree)
  - [Repo](#repo)
  - [Input DTOs](#input-dtos)
- [Algorithms](#algorithms)
- [Serde Conventions](#serde-conventions)
- [Rust Coding Rules](#rust-coding-rules)
- [Test Doubles](#test-doubles)
- [Repository Traits](#repository-traits)
- [SQLite Schema](#sqlite-schema)
- [Error Types](#error-types)
- [HTTP Route Table (os-serve)](#http-route-table-os-serve)
- [VcsBackend Trait](#vcsbackend-trait)
- [MCP API Surface](#mcp-api-surface)
- [Build Orchestration (Justfile)](#build-orchestration-justfile)
- [Workspace Cargo.toml Skeleton](#workspace-cargotoml-skeleton)
- [Dependency Versions](#dependency-versions)
- [Test Strategy (TDD)](#test-strategy-tdd)
- [Task Execution Protocol](#task-execution-protocol)
- [Reverse Dependency Index](#reverse-dependency-index)
- [Implementation Plan](#implementation-plan)
  - [Phase 0: Workspace Scaffold](#phase-0-workspace-scaffold)
  - [Tracer 1: os-core -> os-db](#tracer-1-create-task-get-it-back-os-core---os-db)
  - [Tracer 3: os-vcs](#tracer-3-git-backend-manages-bookmarks-os-vcs)
  - [Tracer 4: os-core <-> os-vcs <-> os-db](#tracer-4-task-start-creates-bookmark-os-core---os-vcs---os-db)
  - [Tracer 5: os-serve <-> os-core](#tracer-5-http-endpoint-creates-and-lists-tasks-os-serve---os-core)
  - [Tracer 6: os-mcp <-> os-core](#tracer-6-mcp-js-creates-a-task-os-mcp---os-core)
  - [Tracer 7: os-cli](#tracer-7-cli-binary-wires-everything-os-cli)
  - [Phase 2: Widen Core](#phase-2-widen-core)
  - [Phase 3: Widen VCS Backends](#phase-3-widen-vcs-backends)
  - [Phase 4: Widen HTTP API](#phase-4-widen-http-api-os-serve)
  - [Phase 5: Widen MCP](#phase-5-widen-mcp-os-mcp)
  - [Phase 6: Widen CLI](#phase-6-widen-cli-os-cli)
  - [Phase 7: Integration + Cleanup](#phase-7-integration--cleanup)
- [Resolved Decisions](#resolved-decisions)
- [Risks](#risks)
- [Non-Goals](#non-goals)
- [Reference Files](#reference-files)

---

## Problem

Main is a monolithic single-crate Rust binary (`overseer/`) with Node.js dependencies for MCP and UI serving. This creates:

- Tight coupling between domain logic, storage, VCS, and presentation
- Node.js runtime dependency — can't ship as single binary
- No compile-time enforcement of module boundaries
- Difficult to test components in isolation

A v2 greenfield rewrite (`v2-greenfield` bookmark) solved these structurally but overcooked scope with gates, reviews, git-ai, harness integrations, relay, and help systems. We're abandoning v2 but adopting its architectural patterns, implementing fresh using main as reference.

## Scope

### Keep from v2

| Pattern | What |
|---------|------|
| Multi-crate workspace | 6 crates: `os-cli`, `os-core`, `os-db`, `os-vcs`, `os-serve`, `os-mcp` |
| Store super-trait | GAT-based repository abstraction; traits in core, impls in db |
| Overseer\<S: Store\> facade | Sub-API pattern (`overseer.tasks()`, `overseer.vcs()`, etc.) |
| VcsBackend trait | `Box<dyn VcsBackend>` trait objects for jj + git dispatch |
| rquickjs MCP executor | Rust-native JS execution, no Node dependency |
| Axum HTTP server | Native Rust server for UI API |
| ID scheme | `ms_`/`task_`/`sub_` prefixes per depth level |
| Priority enum | `Low`/`Normal`/`High`/`Critical` |
| Multi-repo support | `Repo` as first-class entity, `RepoId` on tasks |
| Single binary | No Node.js at runtime |

### Drop from v2

- Gates (types, executor, config, polling, repo, events)
- Reviews (pipeline, comments, status states, repo)
- Git-AI (types, repo, routes)
- Sessions / Harnesses / Relay (WebSocket server, types, repos)
- Help requests (types, repo)
- Agent primitives
- Idempotency middleware
- OpenAPI / utoipa generation (can add later)

### Preserve from main (implement fresh, using main as reference)

- Core domain: tasks + learnings
- Task lifecycle: Pending -> InProgress -> Completed, plus Cancelled + Archived
- CLI commands: create, get, list, update, start, complete, reopen, cancel, archive, delete, block, unblock, next-ready, tree, search, progress
- MCP API surface (functionally equivalent, details change)
- React UI (ported from Hono API to Axum API)
- Skills (`overseer`, `overseer-plan`)
- npm distribution (updated for single binary)

---

## Target Architecture

```
Cargo.toml (workspace, edition 2024)
crates/
├── os-cli/        # Binary: [[bin]] name = "os". Thin: clap CLI + tokio runtime + wiring
├── os-core/       # Domain types, repository traits, Store, Overseer<S> facade, business logic
├── os-db/         # SQLite: DbStore impl, per-entity repos, schema
├── os-vcs/        # VcsBackend trait, JjBackend, GitBackend (no internal deps)
├── os-serve/      # Axum: API routes, static file serving, middleware
└── os-mcp/        # rquickjs: MCP executor, JS bootstrap, SDK bridge
```

### Dependency Graph

```
os-vcs    ─── jj-lib, gix, chrono, thiserror (zero internal deps)
os-core   ─── os-vcs, serde, serde_json, chrono, ulid, thiserror
os-db     ─── os-core, rusqlite
os-serve  ─── os-core, os-db, axum, tokio
os-mcp    ─── os-core, os-db, rquickjs
os-cli    ─── all crates, clap, tokio
```

### Async Strategy

**Sync core, async boundaries.**

- `os-core`: sync. Repository traits return `Result<T>`, not futures.
- `os-db`: sync. `rusqlite` is inherently sync.
- `os-vcs`: sync. `jj-lib` and `gix` are sync.
- `os-serve`: async. Axum handlers use `spawn_blocking` for Overseer calls.
- `os-mcp`: sync executor with async timeout wrapper.
- `os-cli`: `#[tokio::main]` entry point.

Rationale: avoids async poisoning the entire codebase. VCS and DB operations are inherently sync. Async only where it matters — HTTP server I/O.

### Architecture Diagrams

#### System Layers

Three-tier architecture: entry points construct `Overseer<DbStore>`, domain logic is generic over `S: Store`, infrastructure provides implementations.

```
+-------------------------------------------------------------------+
|                         ENTRY POINTS                              |
|                                                                   |
|  +--------------+    +--------------+    +--------------+         |
|  |    os-cli    |    |   os-serve   |    |    os-mcp    |         |
|  |  binary: os  |    |  Axum HTTP   |    |   rquickjs   |         |
|  |  clap+tokio  |    |  REST API    |    |  JS sandbox  |         |
|  +--------------+    +--------------+    +--------------+         |
|                                                                   |
+-------------------------------------------------------------------+
           |                   |                   |
           v                   v                   v
+-------------------------------------------------------------------+
|                       DOMAIN  (os-core)                           |
|                                                                   |
|  Overseer<S: Store>                                               |
|  +----------+ +---------+ +--------------+ +----------+           |
|  | TasksApi | | VcsApi  | | LearningsApi | | ReposApi |           |
|  +----------+ +---------+ +--------------+ +----------+           |
|                                                                   |
|  Types:  AnyTaskId  Task  Learning  Repo  TaskVcs                 |
|  Traits: Store  TaskRepository  LearningRepository  ...           |
|  Errors: OverseerError (thiserror)                                |
|                                                                   |
+-------------------------------------------------------------------+
           |                   |
           v                   v
+-------------------------------------------------------------------+
|                       INFRASTRUCTURE                              |
|                                                                   |
|  +--------------+    +--------------+                             |
|  |    os-db     |    |    os-vcs    |                             |
|  |   DbStore    |    |  JjBackend   |                             |
|  |   rusqlite   |    |  GitBackend  |                             |
|  +--------------+    +--------------+                             |
|                                                                   |
+-------------------------------------------------------------------+
```

#### Crate Dependency DAG

Arrows flow from dependent to dependency. Leaf crates have zero internal deps.

```
Layer 4 (binary)          +---------+
                          | os-cli  |  ---> all crates
                          +---------+
                               |
          +--------------------+--------------------+
          |                                         |
          v                                         v
Layer 3 (entry)     +-----------+         +-----------+
                    | os-serve  |         |  os-mcp   |
                    +-----------+         +-----------+
                       core,db               core,db
                          |                     |
          +---------------+---------------------+
          |                     |
          v                     v
Layer 2 (storage)         +-----------+
                          |   os-db   |  ---> core
                          +-----------+
                               |
                               v
Layer 1 (domain)          +-----------+
                          |  os-core  |  ---> vcs
                          +-----------+
                               |
                               v
Layer 0 (leaf)           +--------+
                         | os-vcs |
                         +--------+
                         jj-lib,gix
```

#### Request Flow

All three entry points converge on the same `Overseer<DbStore>` facade.

```
  CLI command        HTTP request        MCP JS code
       |                  |                   |
       v                  v                   v
  +----------+      +-----------+      +-----------+
  |  os-cli  |      | os-serve  |      |  os-mcp   |
  |  (clap)  |      |  (Axum)   |      |(rquickjs) |
  +----+-----+      +-----+-----+      +-----+-----+
       |    spawn_blocking |   call_sdk       |
       +-------------------+------------------+
                           |
                           v
                   +---------------+
                   |   Overseer    |
                   |   <DbStore>   |
                   +--+----+------++
                      |           |
              +-------+           +-------+
              v                           v
        +---------+                 +---------+
        |  os-db  |                 | os-vcs  |
        | (Store) |                 |(Backend)|
        +---------+                 +---------+
```

---

## Interface Contracts

Crate boundary documentation. Each entry specifies data flow direction, injection pattern, and error mapping.

### os-vcs (provides) -> os-core (consumes)

- `Box<dyn VcsBackend>` injected as `Option` into `Overseer` constructor
- `VcsApi` delegates to `VcsBackend` methods during start/complete workflows
- os-vcs knows nothing about tasks — pure VCS operations
- Missing VCS -> graceful `OverseerError::NoVcs`, not panic

### os-core (defines) <- os-db (implements)

- os-core defines repository traits + `Store` super-trait
- os-db implements `DbStore: Store` with SQLite
- Dependency flows: os-db depends on os-core (not reverse)
- Consumer (os-cli, os-serve, os-mcp) constructs `DbStore`, passes to `Overseer<DbStore>`

### os-core (provides) -> os-serve (consumes)

- `AppState` holds `Arc<Mutex<Overseer<DbStore>>>` (concrete, not generic). `Mutex` required because `rusqlite::Connection` is `!Sync` — `Arc` alone won't work.
- Axum handlers call Overseer methods inside `spawn_blocking`, acquiring lock with tight scope: `let result = { let overseer = state.lock().map_err(|_| OverseerError::Internal("mutex poisoned".into()))?; overseer.tasks().get(&id) };` — never `.unwrap()` a Mutex lock in non-test code.
- Error mapping: `OverseerError` -> HTTP status (`NotFound`->404, `InvalidInput`->422, etc.)
- No real-time streaming; UI uses polling or full-page refresh on navigation.

### os-core (provides) -> os-mcp (consumes)

- `Overseer<DbStore>` created per MCP request (concrete, not generic)
- JS `__os_call_raw(method, json_args)` -> Rust `call_sdk()` match dispatch -> Overseer method
- Results JSON-serialized back to JS
- Errors -> JS exceptions with `_tag` discriminator

### os-cli (wires everything)

- Creates: `DbStore`, detects `VcsBackend`
- Constructs: `Overseer<DbStore>`
- Routes: CLI subcommands | `os serve` (passes to os-serve) | `os mcp` (passes to os-mcp)

---

## Sequence Diagrams

Key operation flows showing how requests traverse crate boundaries.

### Task Create

Entry point calls `Overseer.tasks().create()`. Validation and ID generation happen in os-core. Store write is transactional.

```
 Caller         TasksApi         Store
   |               |               |
   | create(input) |               |
   |-------------->|               |
   |               |               |
   |               | validate input|
   |               | (description, |
   |               |  repo_id)     |
   |               |               |
   |               | generate      |
   |               | AnyTaskId     |
   |               | (ms_/task_/   |
   |               |  sub_ prefix) |
   |               |               |
   |               | with_tx {     |
   |               |   tasks()     |
   |               |   .create()   |
   |               |-------------->|
   |               |         Ok(())|
   |               |<--------------|
   |               | } commit      |
   |               |               |
   |    Ok(task)   |               |
   |<--------------|               |
```

### Task Start (VCS Workflow)

`VcsApi::start()` orchestrates Store reads, VCS operations, and Store writes. VCS bookmark is created *before* the transactional status update — if VCS fails, no state change occurs.

```
 Caller          VcsApi          Store        VcsBackend
   |               |               |               |
   | start(id)     |               |               |
   |-------------->|               |               |
   |               |               |               |
   |               | tasks().get() |               |
   |               |-------------->|               |
   |               |  task(Pending)|               |
   |               |<--------------|               |
   |               |               |               |
   |               | assert status |               |
   |               | == Pending    |               |
   |               |               |               |
   |               | current_commit_id()           |
   |               |------------------------------>|
   |               |                    commit_sha |
   |               |<------------------------------|
   |               |               |               |
   |               | create_bookmark("os/{id}")    |
   |               |------------------------------>|
   |               |                        Ok(()) |
   |               |<------------------------------|
   |               |               |               |
   |               | with_tx {     |               |
   |               |  status :=    |               |
   |               |   InProgress  |               |
   |               |  save TaskVcs |               |
   |               |-------------->|               |
   |               |         Ok(())|               |
   |               |<--------------|               |
   |               | } commit      |               |
   |               |               |               |
   |    Ok(task)   |               |               |
   |<--------------|               |               |
```

### Task Complete (VCS + Learning Bubbling)

`VcsApi::complete()` commits working copy changes, checks out the start commit (returning to pre-task state), deletes the bookmark, then transactionally updates status, saves learnings, and bubbles learnings to parent.

```
 Caller          VcsApi          Store        VcsBackend
   |               |               |               |
   | complete(id,  |               |               |
   |   input)      |               |               |
   |-------------->|               |               |
   |               |               |               |
   |               | tasks().get() |               |
   |               |-------------->|               |
   |               | task(InProg.) |               |
   |               |<--------------|               |
   |               |               |               |
   |               | assert status |               |
   |               | == InProgress |               |
   |               |               |               |
   |               | commit(message)               |
   |               |------------------------------>|
   |               |               CommitResult    |
   |               |<------------------------------|
   |               |               |               |
   |               | task_vcs()    |               |
   |               |   .get(id)    |               |
   |               |-------------->|               |
   |               |      TaskVcs  |               |
   |               |<--------------|               |
   |               |               |               |
   |               | checkout(start_commit)        |
   |               |------------------------------>|
   |               |                        Ok(()) |
   |               |<------------------------------|
   |               |               |               |
   |               | delete_bookmark("os/{id}")    |
   |               |------------------------------>|
   |               |                        Ok(()) |
   |               |<------------------------------|
   |               |               |               |
   |               | with_tx {     |               |
   |               |  status :=    |               |
   |               |   Completed   |               |
   |               |  create       |               |
   |               |   learnings   |               |
   |               |  bubble to    |               |
   |               |   parent      |               |
   |               |-------------->|               |
   |               |         Ok(())|               |
   |               |<--------------|               |
   |               | } commit      |               |
   |               |               |               |
   |    Ok(task)   |               |               |
   |<--------------|               |               |
```

### MCP JS Execution

Agent-authored JS executes in rquickjs sandbox. `tasks.create()` in JS calls `JSON.stringify` then `__os_call_raw`, which crosses into Rust via `call_sdk` dispatch, invokes `Overseer`, and returns JSON back to JS.

> **No real-time streaming.** The UI uses polling or full-page refresh on navigation. No SSE, WebSocket, or event broadcast infrastructure. If live updates become a hard requirement, introduce a minimal in-process bus in os-serve only (not in os-core).

```
 Agent JS       rquickjs      call_sdk       Overseer
   |               |              |              |
   | tasks.create  |              |              |
   | ({desc:"x"})  |              |              |
   |-------------->|              |              |
   |               |              |              |
   |               | __os_call_raw|              |
   |               | ("tasks.     |              |
   |               |  create",    |              |
   |               |  args_json)  |              |
   |               |------------->|              |
   |               |              |              |
   |               |              | deser input  |
   |               |              | match method |
   |               |              |              |
   |               |              | tasks()      |
   |               |              |   .create()  |
   |               |              |------------->|
   |               |              |    Ok(task)  |
   |               |              |<-------------|
   |               |              |              |
   |               |              | serialize    |
   |               |              | to JSON      |
   |               |              |              |
   |               |  json_string |              |
   |               |<-------------|              |
   |               |              |              |
   |               | JSON.parse() |              |
   |               |              |              |
   | {task object} |              |              |
   |<--------------|              |              |
```

---

## Simplified Store Trait

Stripping v2's 11-member Store to 4:

```rust
pub trait Store {
    type Tasks<'a>: TaskRepository where Self: 'a;
    type Learnings<'a>: LearningRepository where Self: 'a;
    type Repos<'a>: RepoRepository where Self: 'a;
    type TaskVcs<'a>: TaskVcsRepository where Self: 'a;

    fn tasks(&self) -> Self::Tasks<'_>;
    fn learnings(&self) -> Self::Learnings<'_>;
    fn repos(&self) -> Self::Repos<'_>;
    fn task_vcs(&self) -> Self::TaskVcs<'_>;

    fn with_tx<F, T>(&self, f: F) -> Result<T, OverseerError>
    where
        F: FnOnce(&Self) -> Result<T, OverseerError>;
}
```

**`with_tx` semantics:** `DbStore` implements via `conn.execute_batch("BEGIN IMMEDIATE")` + `COMMIT` on `Ok` / `ROLLBACK` on `Err`. Not reentrant — nested `with_tx` calls will fail (`SQLITE_ERROR: cannot start a transaction within a transaction`). Panic inside closure: use `std::panic::catch_unwind` around the closure, `ROLLBACK` on panic, then return `Internal` error. Do NOT resume the panic — map it to an error. Do NOT let `Drop` be the sole guard — `catch_unwind` makes the rollback deterministic.

### Simplified Overseer Facade

```rust
pub struct Overseer<S: Store> {
    store: S,
    vcs: Option<Box<dyn VcsBackend>>,
}

impl<S: Store> Overseer<S> {
    pub fn new(store: S, vcs: Option<Box<dyn VcsBackend>>) -> Self;
    pub fn tasks(&self) -> TasksApi<'_, S>;
    pub fn learnings(&self) -> LearningsApi<'_, S>;
    pub fn repos(&self) -> ReposApi<'_, S>;
    pub fn vcs(&self) -> VcsApi<'_, S>;
}
```

Four sub-APIs. No gates, reviews, sessions, help, git-ai, events.

**VCS access in sub-APIs:** `TasksApi` receives `Option<&dyn VcsBackend>` for best-effort bookmark cleanup during cancel. `VcsApi` receives `Option<Box<dyn VcsBackend>>` (owned ref via `&self`) for start/complete workflows. Both access it through `&self.vcs` on the parent `Overseer`.

---

## Domain Types

### IDs

```rust
pub struct MilestoneId(String);   // "ms_" + ULID
pub struct TaskId(String);        // "task_" + ULID
pub struct SubtaskId(String);     // "sub_" + ULID
pub struct LearningId(String);    // "lrn_" + ULID
pub struct RepoId(String);        // "repo_" + ULID

pub enum AnyTaskId {
    Milestone(MilestoneId),
    Task(TaskId),
    Subtask(SubtaskId),
}
```

#### ID Prefix Rules

| Prefix | Type | Depth | Parent Rule |
|--------|------|-------|-------------|
| `ms_` | `MilestoneId` | 0 | Must have no parent |
| `task_` | `TaskId` | 1 | Parent must be `ms_` |
| `sub_` | `SubtaskId` | 2 | Parent must be `task_` |
| `lrn_` | `LearningId` | n/a | Attached to any `AnyTaskId` |
| `repo_` | `RepoId` | n/a | Standalone |

`AnyTaskId` implements `FromStr` (parses prefix to determine variant), `Display` (emits full prefixed string), `serde::Serialize`/`Deserialize` (as string), and `Ord`/`PartialOrd` (lexicographic on the full string representation — used as tiebreaker in `next_ready` when priority and `created_at` are equal).

Each ID type has `fn generate() -> Self` using the `ulid` crate. Example: `MilestoneId::generate()` → `MilestoneId("ms_".to_owned() + &Ulid::new().to_string())`.

**ID-kind consistency invariant:** `TasksApi::create()` must validate that the generated ID prefix matches the `kind` field. `AnyTaskId::kind() -> TaskKind` derives kind from prefix. `Task.kind` is **stored in the DB** (enables efficient `WHERE kind = ?` queries without prefix parsing) AND **validated at creation** to equal `task.id.kind()`. On read, the stored value is trusted (schema CHECK constraint enforces consistency). Both the `kind` column in SQLite and `AnyTaskId::kind()` are authoritative — they must agree, enforced by creation-time validation + schema constraint.

### Enums

```rust
pub enum Priority { Low, Normal, High, Critical }
pub enum TaskKind { Milestone, Task, Subtask }
pub enum TaskStatus { Pending, InProgress, Completed, Cancelled, Archived }
pub enum VcsType { Jj, Git }   // No `None` variant — VCS is required
```

**VCS requirement:** Repo registration requires VCS presence — `detect()` must return `Some`. Directories without `.jj/` or `.git/` cannot be registered; return `InvalidInput { field: "path", message: "no VCS detected" }`.

`TaskStatus` merges main's `LifecycleState` (which already has these 5 states) with v2's enum approach. Drops `InReview`/`AwaitingHuman` (review-specific states).

**Status is stored directly as a TEXT column — it IS the source of truth.** Timestamp fields (`started_at`, `completed_at`, `cancelled_at`, `archived_at`) are audit trail set alongside transitions, not the source of truth.

**State transition matrix:**
| From | To | Action | Side effects |
|------|----|--------|-------------|
| Pending | InProgress | `start` | set `started_at`, create VCS bookmark |
| Pending | Cancelled | `cancel` | set `cancelled_at` |
| InProgress | Completed | `complete` | set `completed_at`, VCS commit + cleanup |
| InProgress | Cancelled | `cancel` | set `cancelled_at`, VCS cleanup |
| Completed | Archived | `archive` | set `archived_at` |
| Completed | Pending | `reopen` | clear `completed_at`, `started_at` |
| Cancelled | Archived | `archive` | set `archived_at` |
| Cancelled | Pending | `reopen` | clear `cancelled_at`, `started_at` |
| Archived | *(terminal)* | — | — |

Any transition not in this matrix returns `InvalidTransition { from, to }`.

### Task

```rust
pub struct Task {
    pub id: AnyTaskId,
    pub repo_id: RepoId,
    pub parent_id: Option<AnyTaskId>,
    pub kind: TaskKind,
    pub description: String,
    pub context: Option<String>,
    pub priority: Priority,
    pub status: TaskStatus,
    pub blocked_by: Vec<AnyTaskId>,       // populated from task_blockers JOIN on read
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub archived_at: Option<DateTime<Utc>>,
    pub result: Option<String>,
}
```

Changes from main's Task:
- `id`: `AnyTaskId` (was `TaskId`)
- `repo_id`: new (multi-repo)
- `kind`: new (stored in DB + validated against ID prefix at creation — see ID-kind consistency invariant)
- `priority`: `Priority` enum (was `i32`)
- `status`: `TaskStatus` enum (was computed from flags)
- Removed: `completed: bool`, `cancelled: bool`, `archived: bool` (redundant with status)
- Removed: `bookmark`, `start_commit`, `commit_sha` (moved to `TaskVcs`)
- Removed: `blocks: Vec<TaskId>` (computed via query, not stored)
- Removed: `depth: Option<i32>` (encoded in `AnyTaskId::kind()`)
- Removed: `effectively_blocked: bool` (computed, not stored — returned in list enrichment)

**Blocker storage:** `blocked_by` is NOT stored as a column on `tasks`. It uses a `task_blockers(task_id TEXT NOT NULL, blocker_id TEXT NOT NULL, UNIQUE(task_id, blocker_id), FOREIGN KEY ... ON DELETE CASCADE)` junction table. `Task.blocked_by` is populated from a JOIN on read. `TaskRepository::blockers(id)` returns forward join (what blocks me), `blocked_by_me(id)` returns reverse join (what I block).

> **Divergence from v2:** v2 stored `blocked_by` as a JSON column on the tasks table. We use a junction table instead for FK enforcement + CASCADE cleanup.

### Learning

```rust
pub struct Learning {
    pub id: LearningId,
    pub task_id: AnyTaskId,
    pub content: String,
    pub source_task_id: Option<AnyTaskId>,  // set when bubbled from child
    pub created_at: DateTime<Utc>,
}
```

### TaskVcs (separate entity, v2 pattern)

```rust
pub struct TaskVcs {
    pub task_id: AnyTaskId,
    pub repo_id: RepoId,
    pub bookmark: String,
    pub start_commit: String,
    pub commit_sha: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
}
```

### TaskContext

```rust
pub struct TaskContext {
    pub own: Option<String>,
    pub parent: Option<String>,
    pub milestone: Option<String>,
}
```

### InheritedLearnings

```rust
pub struct InheritedLearnings {
    pub own: Vec<Learning>,
    pub parent: Vec<Learning>,
    pub milestone: Vec<Learning>,
}
```

### TaskWithContext (enriched response)

```rust
pub struct TaskWithContext {
    pub task: Task,
    pub context: TaskContext,
    pub learnings: InheritedLearnings,
    pub vcs: Option<TaskVcs>,
    pub effectively_blocked: bool,   // computed: task or ancestor has incomplete blockers
}
```

Dropped from v2: `gates`, `review`, `help_request`.
Added from main: `effectively_blocked` (computed, not stored).

### TaskProgress

```rust
pub struct TaskProgress {
    pub total: u32,
    pub completed: u32,
    pub in_progress: u32,
    pub ready: u32,     // status in {Pending, InProgress} && !effectively_blocked
    //                     ^ "ready" means "actionable" — includes InProgress because
    //                       in-progress tasks are actively workable, not stuck.
    //                       Pending-and-unblocked tasks are also ready to pick up.
    pub blocked: u32,   // !completed && effectively_blocked
}
```

Returned by `TasksApi::progress(root_id)`. Aggregates counts for a milestone's descendants, or all tasks if no root.

### TaskTree

```rust
pub struct TaskTree {
    pub task: Task,
    pub children: Vec<TaskTree>,
}
```

Assembled in `TasksApi::tree(root_id)` using recursive `TaskRepository::children()` calls, NOT in the repository layer. Repository returns flat lists; business logic builds the tree.

### Repo

```rust
pub struct Repo {
    pub id: RepoId,
    pub path: PathBuf,
    pub name: String,
    pub vcs_type: VcsType,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

### Input DTOs

```rust
pub struct CreateTaskInput {
    pub description: String,
    pub context: Option<String>,
    pub parent_id: Option<AnyTaskId>,
    pub priority: Option<Priority>,       // defaults to Normal
    pub blocked_by: Option<Vec<AnyTaskId>>,
    pub repo_id: RepoId,                  // REQUIRED — entry points resolve default before calling core
}
```

**Repo resolution boundary:** os-core does NOT resolve default repos. `CreateTaskInput.repo_id` is **required** — `TasksApi::create()` validates that `repo_id` references an existing repo (after 2.4; before that, trusted). Entry points (os-cli, os-serve, os-mcp) are responsible for resolving the default repo and injecting it into `CreateTaskInput.repo_id`.

**Entry-point request DTOs vs domain DTOs:** HTTP and MCP accept requests where `repoId` is optional (e.g., `POST /api/tasks` body may omit it). Each entry point defines its own request type (e.g., `CreateTaskRequest { description, context?, parent_id?, priority?, blocked_by?, repo_id? }`) and maps it to `CreateTaskInput` by injecting the default `repo_id` when omitted. `CreateTaskInput` is the domain DTO — always has `repo_id`. The mapping happens at the entry-point layer, not in os-core.

**Default repo bootstrapping (entry point responsibility):** Each entry point performs this sequence on startup:
1. Open/create SQLite DB → construct `DbStore`
2. Detect VCS via `os_vcs::detect_type(cwd)`
3. Check if default repo exists: `store.repos().get_by_path(cwd)`
4. If `None` and VCS detected: `store.repos().register(Repo { name: basename(cwd), path: cwd, vcs_type, ... })`
5. Store resolved `default_repo_id: Option<RepoId>` for injection into API calls
6. Construct `Overseer` with store + vcs

If no repo is registered (e.g., VCS detection failed) and caller omits `repo_id`, the **entry point** returns an error before reaching os-core.

**Default repo policy per entry point:**
- **os-cli:** Bootstraps default repo on startup. `--repo` flag / `OVERSEER_REPO` env / cwd detection resolves `repo_id`. Passes resolved ID into `CreateTaskInput.repo_id`.
- **os-serve:** Bootstraps default repo on server startup. HTTP requests without `repoId` in body use the server's default. Injects resolved ID into `CreateTaskInput.repo_id`.
- **os-mcp:** Bootstraps default repo on executor init. MCP calls without `repoId` use the executor's default. Injects resolved ID into `CreateTaskInput.repo_id`.

```rust

pub struct RegisterRepoInput {
    pub path: PathBuf,
    pub name: Option<String>,             // defaults to basename(path)
}

pub struct CompleteTaskInput {
    pub result: Option<String>,
    pub learnings: Option<Vec<String>>,   // each string becomes a Learning record
}

pub struct UpdateTaskInput {
    pub description: Option<String>,
    pub context: Option<String>,
    pub priority: Option<Priority>,
    pub parent_id: Option<AnyTaskId>,  // see reparenting rules below
}
```

**Reparenting rule:** `parent_id` changes must not change the task's depth/kind. IDs encode depth (prefix is immutable at creation). Reparenting a `task_` under another `task_` is invalid — returns `InvalidParent`. A `task_` can only be moved to a different `ms_` parent. A `sub_` can only be moved to a different `task_` parent.

```rust

pub struct ListTasksFilter {
    pub parent_id: Option<AnyTaskId>,
    pub status: Option<TaskStatus>,
    pub kind: Option<TaskKind>,
    pub repo_id: Option<RepoId>,
    pub ready: Option<bool>,              // !completed && !effectively_blocked
    pub completed: Option<bool>,
}
```

**Filter precedence:** If `status` is set, `completed` and `ready` are ignored (status is the most specific filter). `ready` means status in `{Pending, InProgress}` AND `!effectively_blocked`. Contradictory combos (e.g., `ready=true` + `completed=true`) return empty results — no error.

---

## Algorithms

### `effectively_blocked(task_id) -> bool`

**Blocker satisfaction rule:** A blocker is **satisfied** if its status is `Completed` or `Archived` (regardless of whether it was archived from Completed or Cancelled). `Cancelled` alone does NOT satisfy — a cancelled blocker still blocks. Rationale: Cancelled means "abandoned, not done." Archived means "done and hidden from active views."

| Blocker Status | Satisfies? | Reason |
|---------------|-----------|--------|
| Pending | No | Not started |
| InProgress | No | Not finished |
| Completed | Yes | Done |
| Cancelled | No | Abandoned, not done |
| Archived | Yes | Terminal; was previously Completed or Cancelled but treated as resolved |

A task is effectively blocked if:
1. Any of its direct `blocked_by` tasks are **not satisfied** (see table above), OR
2. Any ancestor (walking `parent_id` chain up) has at least one direct blocker that is not satisfied.

Compute iteratively: walk parent chain upward, at each level check direct blockers against the satisfaction rule. Short-circuit on first true. Reference: `overseer/src/core/task_service.rs` (main).

### `next_ready(scope) -> Option<TaskWithContext>`

Find the highest-priority deepest incomplete leaf that is not effectively blocked.

1. If `scope` is `Some(root_id)`, start DFS from that milestone's children. If `None`, iterate all milestones.
2. **Children are visited in priority order** (`Critical` first, then `High`, `Normal`, `Low`; ties broken by `created_at` ascending, then `id` ascending). This pre-sorting is baked into the traversal, not applied as a post-filter.
3. DFS traversal: for each node, recurse into children first (depth-first).
4. At leaf level (no children, or all children completed): if task is not completed/cancelled/archived and not effectively_blocked, return it immediately (short-circuit).
5. The first leaf found IS the highest-priority deepest candidate, because children are visited in priority order at every level.

Reference: main's `get_children_ordered` in `overseer/src/core/task_service.rs`.

### `search(query, repo_id) -> Vec<Task>`

Search `description`, `context`, and `result` fields using case-insensitive SQL `LIKE '%query%'`. No FTS. Scoped to `repo_id` if provided. Order by `priority` descending, `created_at` descending.

---

## Serde Conventions

All domain types in os-core:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task { ... }
```

- **Structs:** `rename_all = "camelCase"` — Rust `snake_case` fields serialize to `camelCase` JSON.
- **Enums (data-carrying):** `#[serde(tag = "type", rename_all = "camelCase")]`. **Note:** `rename_all = "camelCase"` applies to variant names used as the `"type"` discriminator, so `SomeVariant` serializes as `{ "type": "someVariant", ... }`, not `"SomeVariant"`.
- **Enums (unit):** serialize as PascalCase strings by default (e.g., `Priority::High` → `"High"`). Unit enums do NOT use `rename_all`.
- **`AnyTaskId`:** uses `#[serde(try_from = "String", into = "String")]`. Requires `impl TryFrom<String> for AnyTaskId` (delegates to `FromStr`) and `impl From<AnyTaskId> for String` (delegates to `Display`). Note: serde `into` uses `Into<String>`, NOT `Display` directly — you must implement `From<AnyTaskId> for String`. NOT `#[serde(untagged)]` — untagged has poor error messages and is fragile.
- **DateTime fields:** `chrono::DateTime<Utc>` with default serde (RFC 3339 strings).
- **Optional fields:** `#[serde(skip_serializing_if = "Option::is_none")]` on all `Option<T>` fields.

---

## Rust Coding Rules

Enforced across all crates. Agents implementing tasks MUST follow these.

| Rule | Detail |
|------|--------|
| **No unwrap/panic in non-test code** | Use `?`, `.map_err()`, or `match`. `.unwrap()`, `.expect()`, `panic!()`, `unreachable!()` are forbidden outside `#[cfg(test)]`. |
| **`crate::` over `super::`** | Non-test code uses `crate::` paths. `super::` is allowed only inside `#[cfg(test)] mod tests { ... }`. |
| **No `pub use` re-exports** | Unless re-exposing a dependency so downstream crates don't need to depend on it directly (e.g., `pub use os_core::OverseerError;` in os-cli). |
| **No global state** | No `lazy_static!`, `Once`, `OnceLock`, `static mut`, or similar. Pass explicit context structs (`Overseer<S>`, `AppState`, etc.). |
| **Strong types over strings** | Use enums and newtypes when the domain is closed or needs validation. `AnyTaskId`, `Priority`, `TaskStatus` — not raw strings. |
| **`cargo fmt` + `cargo clippy`** | Run before every commit. See Justfile `check` recipe. Clippy warnings are errors (`-D warnings`). |
| **Test module naming** | Tests in same file: `#[cfg(test)] mod tests { ... }` at file bottom. No invented names (`mod my_feature_tests`). Integration tests: `crates/<crate>/tests/test_<feature>.rs`. |

---

## Test Doubles

### MockStore (os-core, `#[cfg(test)]`)

```rust
pub struct MockStore {
    tasks: RefCell<HashMap<String, Task>>,
    learnings: RefCell<HashMap<String, Learning>>,
    repos: RefCell<HashMap<String, Repo>>,
    task_vcs: RefCell<HashMap<String, TaskVcs>>,
    blockers: RefCell<HashMap<String, Vec<String>>>,  // task_id -> [blocker_ids]
}
```

Uses `RefCell<HashMap>` — compatible with GAT pattern (`Store::Tasks<'a>` borrows `&'a self`). NOT `Arc<Mutex>` (single-threaded tests). `with_tx` is a no-op passthrough (no actual transaction semantics in mock).

**Note:** MockStore evolves as Store trait widens. Start minimal (Tasks GAT only in T1.5), add members as traits are defined. `todo!()` cannot be used as an associated type — you need concrete stub types. Pattern:

```rust
// In T1.5, define empty stub traits for traits not yet fleshed out:
pub trait LearningRepository {}
// RepoRepository is NOT a stub — minimal (register + get_by_path) from T1.5
pub trait TaskVcsRepository {}

// Stub repo structs that todo!() in methods (added as traits gain methods):
pub struct MockTaskRepo<'a> {
    store: &'a MockStore,
}
impl<'a> TaskRepository for MockTaskRepo<'a> {
    fn create(&self, task: &Task) -> Result<(), OverseerError> {
        self.store.tasks.borrow_mut().insert(task.id.to_string(), task.clone());
        Ok(())
    }
    fn get(&self, id: &AnyTaskId) -> Result<Task, OverseerError> {
        self.store.tasks.borrow().get(&id.to_string())
            .cloned()
            .ok_or_else(|| OverseerError::NotFound { entity: "task".into(), id: id.to_string() })
    }
    // ... other methods todo!() until needed
}

// MockRepoRepo — minimal, implements register + get_by_path from T1.5:
pub struct MockRepoRepo<'a> { store: &'a MockStore }
impl<'a> RepoRepository for MockRepoRepo<'a> {
    fn register(&self, repo: &Repo) -> Result<(), OverseerError> {
        self.store.repos.borrow_mut().insert(repo.id.to_string(), repo.clone());
        Ok(())
    }
    fn get_by_path(&self, path: &Path) -> Result<Option<Repo>, OverseerError> {
        Ok(self.store.repos.borrow().values().find(|r| r.path == path).cloned())
    }
    // get, list, unregister: todo!() until 2.4
}

// Stub types for unimplemented GATs:
pub struct TodoLearningRepo<'a>(&'a MockStore);
impl<'a> LearningRepository for TodoLearningRepo<'a> {}

// Wire into Store:
impl Store for MockStore {
    type Tasks<'a> = MockTaskRepo<'a>;
    type Repos<'a> = MockRepoRepo<'a>;
    type Learnings<'a> = TodoLearningRepo<'a>;
    // ...
    fn tasks(&self) -> MockTaskRepo<'_> { MockTaskRepo { store: self } }
    fn repos(&self) -> MockRepoRepo<'_> { MockRepoRepo { store: self } }
    fn learnings(&self) -> TodoLearningRepo<'_> { TodoLearningRepo(self) }
    // ...
}
```

**GAT fallback trigger:** If ANY of these occur during T1.5: (1) Internal Compiler Error (ICE), (2) lifetime errors in MockStore that require >30 min to resolve, (3) `where Self: 'a` bounds propagating to >2 call sites — fall back to Level 1 (concrete return types) or Level 2 (trait objects). See Risks section. Document which level was chosen as a CRITICAL learning on T1.5.

### VCS Test Strategy (os-vcs + os-core VCS tests)

**No FakeBackend.** VCS tests use real temporary repositories.

```rust
// tests/common/mod.rs — shared helper
use std::path::PathBuf;
use tempfile::TempDir;

pub struct TestRepo {
    pub dir: TempDir,
    pub path: PathBuf,
}

impl TestRepo {
    /// Creates a temp dir with `git init` + initial commit.
    pub fn git() -> Result<Self, Box<dyn std::error::Error>> {
        let dir = TempDir::new()?;
        let path = dir.path().to_path_buf();
        std::process::Command::new("git").args(["init"]).current_dir(&path).output()?;
        std::process::Command::new("git").args(["commit", "--allow-empty", "-m", "init"]).current_dir(&path).output()?;
        Ok(Self { dir, path })
    }

    /// Creates a temp dir with `jj git init`.
    pub fn jj() -> Result<Self, Box<dyn std::error::Error>> {
        let dir = TempDir::new()?;
        let path = dir.path().to_path_buf();
        std::process::Command::new("jj").args(["git", "init"]).current_dir(&path).output()?;
        Ok(Self { dir, path })
    }
}
```

Tests assert against real repo state (bookmarks exist, commits present, working copy clean) — not recorded method calls. This catches real VCS bugs that a fake backend would miss.

**Object-safety check:** `let _: Box<dyn VcsBackend> = Box::new(GitBackend::open(&temp_path)?);` — compiles = trait is object-safe.

---

## Repository Traits

```rust
pub trait TaskRepository {
    fn create(&self, task: &Task) -> Result<(), OverseerError>;
    fn get(&self, id: &AnyTaskId) -> Result<Task, OverseerError>;
    fn list(&self, filter: &ListTasksFilter) -> Result<Vec<Task>, OverseerError>;
    fn update(&self, task: &Task) -> Result<(), OverseerError>;
    fn delete(&self, id: &AnyTaskId) -> Result<(), OverseerError>;  // CASCADE children + learnings
    fn children(&self, id: &AnyTaskId) -> Result<Vec<Task>, OverseerError>;
    fn ancestors(&self, id: &AnyTaskId) -> Result<Vec<Task>, OverseerError>;
    fn blockers(&self, id: &AnyTaskId) -> Result<Vec<Task>, OverseerError>;
    fn blocked_by_me(&self, id: &AnyTaskId) -> Result<Vec<Task>, OverseerError>;
    fn add_blocker(&self, task_id: &AnyTaskId, blocker_id: &AnyTaskId) -> Result<(), OverseerError>;
    fn remove_blocker(&self, task_id: &AnyTaskId, blocker_id: &AnyTaskId) -> Result<(), OverseerError>;
    fn search(&self, query: &str, repo_id: Option<&RepoId>) -> Result<Vec<Task>, OverseerError>;
}

pub trait LearningRepository {
    fn create(&self, learning: &Learning) -> Result<(), OverseerError>;
    fn list_for_task(&self, task_id: &AnyTaskId) -> Result<Vec<Learning>, OverseerError>;
    fn inherited(&self, task_id: &AnyTaskId) -> Result<InheritedLearnings, OverseerError>;
    fn delete_for_task(&self, task_id: &AnyTaskId) -> Result<(), OverseerError>;
}

pub trait RepoRepository {
    fn register(&self, repo: &Repo) -> Result<(), OverseerError>;
    fn get(&self, id: &RepoId) -> Result<Repo, OverseerError>;
    fn get_by_path(&self, path: &Path) -> Result<Option<Repo>, OverseerError>;
    fn list(&self) -> Result<Vec<Repo>, OverseerError>;
    fn unregister(&self, id: &RepoId) -> Result<(), OverseerError>;
}

pub trait TaskVcsRepository {
    fn save(&self, vcs: &TaskVcs) -> Result<(), OverseerError>;
    fn get(&self, task_id: &AnyTaskId) -> Result<Option<TaskVcs>, OverseerError>;
    fn delete(&self, task_id: &AnyTaskId) -> Result<(), OverseerError>;
    fn list_for_descendants(&self, root_id: &AnyTaskId) -> Result<Vec<TaskVcs>, OverseerError>;
}
```

---

## SQLite Schema

Complete DDL for os-db. Clean slate — no migrations, no version checks. Applied on every `DbStore::new()`.

```sql
-- Connection pragmas (set on every open, before any queries)
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS repos (
    id          TEXT PRIMARY KEY CHECK (id LIKE 'repo_%'),
    path        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    vcs_type    TEXT NOT NULL CHECK (vcs_type IN ('Jj', 'Git')),
    created_at  TEXT NOT NULL,  -- ISO 8601
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    repo_id       TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
    parent_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE
                    CHECK (parent_id LIKE 'ms_%' OR parent_id LIKE 'task_%' OR parent_id IS NULL),
    kind          TEXT NOT NULL,
    -- Cross-column CHECK: id prefix must match kind
    CHECK (
        (id LIKE 'ms_%'   AND kind = 'Milestone') OR
        (id LIKE 'task_%' AND kind = 'Task')       OR
        (id LIKE 'sub_%'  AND kind = 'Subtask')
    ),
    description   TEXT NOT NULL,
    context       TEXT,
    priority      TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
    status        TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'InProgress', 'Completed', 'Cancelled', 'Archived')),
    result        TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    started_at    TEXT,
    completed_at  TEXT,
    cancelled_at  TEXT,
    archived_at   TEXT
);

CREATE TABLE IF NOT EXISTS task_blockers (
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocker_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, blocker_id)
);

CREATE TABLE IF NOT EXISTS task_vcs (
    task_id       TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    repo_id       TEXT NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
    bookmark      TEXT NOT NULL,
    start_commit  TEXT NOT NULL,
    commit_sha    TEXT,
    archived_at   TEXT
);

CREATE TABLE IF NOT EXISTS learnings (
    id              TEXT PRIMARY KEY CHECK (id LIKE 'lrn_%'),
    task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    source_task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_repo      ON tasks(repo_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent    ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_blockers_blocker ON task_blockers(blocker_id);
CREATE INDEX IF NOT EXISTS idx_learnings_task  ON learnings(task_id);
```

**Notes:**
- Enums stored as TEXT (not integers) for readability in `sqlite3` CLI and debuggability.
- `task_blockers` has CASCADE on both FKs — deleting either side cleans the edge.
- `learnings.source_task_id` uses `ON DELETE SET NULL` — if the originating child is deleted, the bubbled learning preserves but loses provenance.
- `tasks.repo_id` and `task_vcs.repo_id` use `ON DELETE RESTRICT` — unregistering a repo fails if any tasks or VCS records reference it. `ReposApi::unregister()` must return an error if tasks exist for that repo; the caller must delete tasks first.
- No `task_metadata` table (v1 artifact, unused in new schema).

---

## Error Types

```rust
pub enum OverseerError {
    // Input validation
    InvalidInput { field: String, message: String },
    InvalidId(String),

    // Not found
    NotFound { entity: String, id: String },

    // Hierarchy
    InvalidParent { child: AnyTaskId, parent: AnyTaskId, reason: String },
    MaxDepthExceeded { id: AnyTaskId },

    // Blockers
    CycleDetected { path: Vec<AnyTaskId> },
    SelfBlock { id: AnyTaskId },

    // State transitions
    InvalidTransition { from: TaskStatus, to: TaskStatus },
    TaskBlocked { id: AnyTaskId, blockers: Vec<AnyTaskId> },

    // VCS
    NoVcs,
    DirtyWorkingCopy,
    VcsError(String),

    // Repo
    RepoNotFound { path: PathBuf },
    RepoAlreadyRegistered { path: PathBuf },

    // Storage
    DbError(String),

    // Runtime
    Timeout,
    Internal(String),
}

impl From<VcsError> for OverseerError {
    fn from(e: VcsError) -> Self {
        match e {
            VcsError::NotARepository => OverseerError::NoVcs,
            VcsError::DirtyWorkingCopy => OverseerError::DirtyWorkingCopy,
            other => OverseerError::VcsError(other.to_string()),
        }
    }
}
```

---

## HTTP Route Table (os-serve)

> **Note:** `GET /api/tasks/:id` returns `Task` (not `TaskWithContext`) until 2.16 wires context assembly. `POST /api/tasks` accepts `CreateTaskRequest` (entry-point DTO with optional `repoId`), NOT `CreateTaskInput` directly — entry point injects default `repo_id`.

| Method | Path | Request Body | Response | Status |
|--------|------|-------------|----------|--------|
| `POST` | `/api/repos` | `{ path, name? }` | `Repo` | 201 |
| `GET` | `/api/repos` | — | `Vec<Repo>` | 200 |
| `GET` | `/api/repos/:id` | — | `Repo` | 200 |
| `DELETE` | `/api/repos/:id` | — | — | 204 |
| `POST` | `/api/tasks` | `CreateTaskInput` | `Task` | 201 |
| `GET` | `/api/tasks` | query: `?status=&kind=&parentId=&repoId=&ready=&completed=` | `Vec<Task>` | 200 |
| `GET` | `/api/tasks/:id` | — | `TaskWithContext` | 200 |
| `PUT` | `/api/tasks/:id` | `UpdateTaskInput` | `Task` | 200 |
| `DELETE` | `/api/tasks/:id` | — | — | 204 |
| `POST` | `/api/tasks/:id/start` | — | `Task` | 200 |
| `POST` | `/api/tasks/:id/complete` | `{ result?, learnings? }` | `Task` | 200 |
| `POST` | `/api/tasks/:id/cancel` | — | `Task` | 200 |
| `POST` | `/api/tasks/:id/archive` | — | `Task` | 200 |
| `POST` | `/api/tasks/:id/reopen` | — | `Task` | 200 |
| `POST` | `/api/tasks/:id/block` | `{ blockerId }` | — | 204 |
| `POST` | `/api/tasks/:id/unblock` | `{ blockerId }` | — | 204 |
| `GET` | `/api/tasks/:id/tree` | — | `TaskTree` | 200 |
| `GET` | `/api/tasks/:id/progress` | — | `TaskProgress` | 200 |
| `GET` | `/api/tasks/next-ready` | query: `?milestoneId=` | `TaskWithContext?` | 200 |
| `GET` | `/api/tasks/search` | query: `?q=&repoId=` | `Vec<Task>` | 200 |
| `GET` | `/api/tasks/:id/learnings` | — | `Vec<Learning>` | 200 |
| `GET` | `/api/tasks/:id/learnings/inherited` | — | `InheritedLearnings` | 200 |
| `GET` | `/` | — | Static HTML (React SPA) | 200 |

**Error responses:** All errors return `{ "error": { "type": "...", "message": "..." } }` with appropriate HTTP status (404, 409, 422, 500).

---

## VcsBackend Trait

Main's richer trait (status, log, bookmarks, is_clean) rather than v2's minimal version. Dispatched via `Box<dyn VcsBackend>` (trait objects, not static dispatch). Instance-based — construct with repo path, call without repeating it.

```rust
pub trait VcsBackend: Send + Sync {
    fn vcs_type(&self) -> VcsType;
    fn root(&self) -> &str;
    fn status(&self) -> VcsResult<VcsStatus>;
    fn log(&self, limit: usize) -> VcsResult<Vec<LogEntry>>;
    fn diff(&self, base: Option<&str>) -> VcsResult<Vec<DiffEntry>>;
    fn commit(&self, message: &str) -> VcsResult<CommitResult>;
    fn current_commit_id(&self) -> VcsResult<String>;
    fn create_bookmark(&self, name: &str, target: Option<&str>) -> VcsResult<()>;
    fn delete_bookmark(&self, name: &str) -> VcsResult<()>;
    fn list_bookmarks(&self, prefix: Option<&str>) -> VcsResult<Vec<String>>;
    fn checkout(&self, target: &str) -> VcsResult<()>;
    fn is_clean(&self) -> VcsResult<bool>;
}
```

### VCS Support Types

```rust
pub type VcsResult<T> = Result<T, VcsError>;

pub enum VcsError {
    NotARepository,
    BookmarkNotFound(String),
    CommitNotFound(String),
    DirtyWorkingCopy,
    Conflict(String),
    Backend(String),  // catch-all for jj-lib/gix errors
}

pub struct VcsStatus {
    pub is_clean: bool,
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

pub struct LogEntry {
    pub commit_id: String,
    pub description: String,
    pub author: String,
    pub timestamp: DateTime<Utc>,
}

pub struct DiffEntry {
    pub path: String,
    pub kind: DiffKind,
}

pub enum DiffKind { Added, Modified, Removed }

pub struct CommitResult {
    pub commit_id: String,
}
```

### Bookmark Naming Convention

Format: `os/{id}` — e.g., `os/task_01JMABCDEF1234567890ABCDEF`.

Prefix `os/` ensures overseer bookmarks don't collide with user bookmarks. `list_bookmarks(prefix: Some("os/"))` finds all overseer-managed bookmarks.

### VCS Detection

Two functions — type detection (cheap, no backend construction) and backend construction (full):

```rust
/// Detects VCS type for a directory. jj-first: if `.jj/` present, returns Jj.
/// Cheap — only checks for `.jj/` and `.git/` directories. Implemented in T3.3.
pub fn detect_type(path: &Path) -> Option<VcsType>;

/// Detects VCS and constructs the appropriate backend. jj-first.
/// Requires JjBackend + GitBackend to be implemented. Implemented in T3.4 (Phase 3).
pub fn detect_backend(path: &Path) -> Option<Box<dyn VcsBackend>>;
```

---

## MCP API Surface

```javascript
globalThis.tasks = {
    create, get, list, update, delete,
    start, complete, cancel, archive, reopen,
    block, unblock, tree, progress, nextReady, search
};
globalThis.learnings = { list, inherited };
globalThis.repos = { register, get, getByPath, list, unregister };
```

Dropped: `reviews`, `gates`, `help`, `gitAi`, `sessions`.

### rquickjs Bridge Pattern

Minimal example of the Rust<->JS bridge (reference: `jj file show -r v2-greenfield -- crates/os-mcp/src/executor.rs`):

```rust
use rquickjs::{Runtime, Context, Function, Object};

// 1. Create runtime + context (no unwrap — map to OverseerError)
let rt = Runtime::new().map_err(|e| OverseerError::Internal(format!("rquickjs runtime: {e}")))?;
let ctx = Context::full(&rt).map_err(|e| OverseerError::Internal(format!("rquickjs context: {e}")))?;

// 2. Register Rust function callable from JS
ctx.with(|ctx| {
    let globals = ctx.globals();
    
    // __os_call_raw(method: string, args_json: string) -> string (JSON)
    let call_raw = Function::new(ctx.clone(), |method: String, args_json: String| -> rquickjs::Result<String> {
        // Dispatch to Overseer methods via call_sdk()
        let result = call_sdk(&overseer, &method, &args_json)
            .map_err(|e| rquickjs::Error::Exception)?;
        Ok(result)  // JSON string
    })?;
    globals.set("__os_call_raw", call_raw)?;
    
    // 3. Load bootstrap JS that wraps __os_call_raw into typed API
    ctx.eval::<(), _>(r#"
        globalThis.tasks = {
            create: (input) => JSON.parse(__os_call_raw("tasks.create", JSON.stringify(input))),
            get: (id) => JSON.parse(__os_call_raw("tasks.get", JSON.stringify({ id }))),
            // ... etc
        };
    "#)?;
    
    Ok::<_, rquickjs::Error>(())
});

// 4. call_sdk dispatches method string to Overseer
fn call_sdk(overseer: &Overseer<DbStore>, method: &str, args_json: &str) -> Result<String, OverseerError> {
    match method {
        "tasks.create" => {
            let input: CreateTaskInput = serde_json::from_str(args_json)?;
            let task = overseer.tasks().create(input)?;
            Ok(serde_json::to_string(&task)?)
        }
        "tasks.get" => { /* ... */ }
        _ => Err(OverseerError::InvalidInput { field: "method".into(), message: format!("unknown: {method}") })
    }
}
```

**Error propagation:** `OverseerError` -> JS exception with `{ _tag: "NotFound", message: "..." }`. Use `ctx.throw()` or return `Err(rquickjs::Error::Exception)` after setting exception value on context.

### `call_sdk` Dispatch Table

| JS Method | Rust Target | Notes |
|-----------|-------------|-------|
| `tasks.create` | `overseer.tasks().create(input)` | |
| `tasks.get` | `overseer.tasks().get(id)` | Returns `TaskWithContext` |
| `tasks.list` | `overseer.tasks().list(filter)` | |
| `tasks.update` | `overseer.tasks().update(id, input)` | |
| `tasks.delete` | `overseer.tasks().delete(id)` | |
| `tasks.start` | `overseer.vcs().start(id)` | |
| `tasks.complete` | `overseer.vcs().complete(id, input)` | `CompleteTaskInput` |
| `tasks.cancel` | `overseer.tasks().cancel(id)` | |
| `tasks.archive` | `overseer.tasks().archive(id)` | |
| `tasks.reopen` | `overseer.tasks().reopen(id)` | |
| `tasks.block` | `overseer.tasks().add_blocker(id, blocker)` | |
| `tasks.unblock` | `overseer.tasks().remove_blocker(id, blocker)` | |
| `tasks.tree` | `overseer.tasks().tree(id)` | |
| `tasks.progress` | `overseer.tasks().progress(id)` | |
| `tasks.nextReady` | `overseer.tasks().next_ready(scope)` | |
| `tasks.search` | `overseer.tasks().search(query, repo_id)` | |
| `learnings.list` | `overseer.learnings().list_for_task(id)` | |
| `learnings.inherited` | `overseer.learnings().inherited(id)` | |
| `repos.register` | `overseer.repos().register(input)` | `RegisterRepoInput` |
| `repos.get` | `overseer.repos().get(id)` | |
| `repos.getByPath` | `overseer.repos().get_by_path(path)` | |
| `repos.list` | `overseer.repos().list()` | |
| `repos.unregister` | `overseer.repos().unregister(id)` | |

---

## Build Orchestration (Justfile)

```just
# Format all Rust code
fmt:
    cargo fmt --all

# Lint all Rust code (deny warnings)
clippy:
    cargo clippy --all --benches --tests --examples --all-features -- -D warnings

# Full check: format + lint + test
check: fmt clippy test

# Build everything (UI -> Rust)
build: build-ui
    cargo build --release

# Build React UI to static assets
build-ui:
    cd ui && npm run build
    # Output: ui/dist/ -> embedded by os-serve via rust-embed

# Dev mode (parallel: Vite HMR + cargo watch)
dev:
    just dev-ui & just dev-rust

dev-ui:
    cd ui && npm run dev

dev-rust:
    cargo watch -x 'run -- serve'

# Test all crates
test:
    cargo test --workspace

# Test single crate
test-crate crate:
    cargo test -p {{crate}}
```

**Workflow rule:** Run `just check` (or at minimum `just fmt` + `just clippy`) before committing. CI should gate on `just check` passing.

## Workspace Cargo.toml Skeleton

```toml
[workspace]
resolver = "2"
members = [
    "crates/os-cli",
    "crates/os-core",
    "crates/os-db",
    "crates/os-vcs",
    "crates/os-serve",
    "crates/os-mcp",
]

[workspace.package]
edition = "2024"

[workspace.dependencies]
# Internal crates
os-core = { path = "crates/os-core" }
os-db = { path = "crates/os-db" }
os-vcs = { path = "crates/os-vcs" }
os-serve = { path = "crates/os-serve" }
os-mcp = { path = "crates/os-mcp" }

# External - see version table below
tokio = { version = "1", features = ["rt-multi-thread", "sync"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
ulid = "1"
thiserror = "2"
clap = { version = "4.5", features = ["derive"] }
rusqlite = { version = "0.32", features = ["bundled"] }
axum = "0.8"
rquickjs = { version = "0.9", features = ["bindgen", "classes", "properties"] }
# jj-lib = "=0.37"  # Uncomment when available; see note below
gix = "0.68"

# Test dependencies
tempfile = "3"
```

**Per-crate Cargo.toml pattern:** Each crate inherits `edition.workspace = true` and references workspace deps:
```toml
[package]
name = "os-core"
version = "0.1.0"
edition.workspace = true

[dependencies]
os-vcs.workspace = true
serde.workspace = true
# ...
```

## Dependency Versions

Pinned in workspace `Cargo.toml` `[workspace.dependencies]`:

| Crate | Version | Features | Used By |
|-------|---------|----------|---------|
| `tokio` | `1` | `rt-multi-thread` | os-serve, os-cli |
| `jj-lib` | `=0.37` | — | os-vcs |
| `gix` | `0.x` | — | os-vcs |
| `rusqlite` | `0.x` | `bundled` | os-db |
| `axum` | `0.8` | — | os-serve |
| `rquickjs` | `0.x` | `bindgen`, `classes`, `properties` | os-mcp |
| `clap` | `4.5` | `derive` | os-cli |
| `serde` | `1` | `derive` | os-core |
| `serde_json` | `1` | — | os-core |
| `chrono` | `0.4` | `serde` | os-core |
| `ulid` | `1` | — | os-core |
| `thiserror` | `2` | — | os-core, os-vcs |
| `tempfile` | `3` | — | os-vcs (dev), os-db (dev), os-serve (dev) |

**Note:** `jj-lib` uses exact pin (`=0.37`) because jj doesn't follow semver — minor bumps can break.

## Test Strategy (TDD)

Each crate gets tests **before** implementation:

| Crate | Test Type | What to Test |
|-------|-----------|-------------|
| os-vcs | Integration | Backend detection, bookmark CRUD, commit, diff (requires temp git/jj repos) |
| os-core | Unit | Task validation, cycle detection, hierarchy rules, blocker resolution, ID parsing, priority ordering |
| os-db | Integration | CRUD through Store trait, transaction rollback, FK cascades |
| os-serve | Integration | Route responses, static file serving |
| os-mcp | Integration | JS execution, timeout enforcement, SDK bridge correctness, API surface parity with main |

**Test locations:**
- **Unit tests:** `#[cfg(test)] mod tests { ... }` at bottom of the source file being tested.
- **Integration tests:** `crates/<crate>/tests/` directory. One file per feature area, named `test_<feature>.rs` (e.g., `test_task_crud.rs`, `test_blocker_cycle.rs`).
- **Helpers/fixtures:** `crates/<crate>/tests/common/mod.rs` for shared setup (e.g., `create_test_db()`, `temp_git_repo()`).

---

## Task Execution Protocol

Rules for the implementing agent to follow during each task.

### Pre-Self-Hosting Protocol (Phases 0-6)

The Overseer MCP system IS the thing being built. Until T6.2 (rquickjs MCP executor) completes and tasks are loaded, agents cannot use `tasks.complete()` to record learnings. During this bootstrap period:

1. **Use the existing monolith Overseer** (`os` CLI on `main`) to create and track extraction tasks. The monolith works today. Create a milestone for the extraction, load tasks from this spec.
2. **Record learnings on completion** via the existing `os` CLI: `os task complete <id> --result "..." --learning "..."`.
3. **Cutover point:** After T7.2 (E2E test passes), switch to the new `os` binary for task tracking. Learnings from the monolith DB do NOT need migration — they're preserved in the monolith's SQLite.
4. **Fallback** (if monolith unavailable): Append learnings to `> **Learning (Txx):** ...` blockquotes directly in this spec file, immediately after the completed task's line.

### Before Starting a Task

1. **Read the task description** in the Implementation Plan below.
2. **Check for impact annotations:** Scan for `> **Impact from Txx:**` blockquotes on or after your task's line. These indicate upstream tasks changed something your task depends on.
3. **Read learnings from dependencies:** For each task listed in your `(depends: ...)` annotation, call `os task get <dep_id>` (or read the spec's inline learnings) to see what was actually built vs. what the spec predicted.
4. **Consult the Reverse Dependency Index** (below) to understand what depends on YOUR task — you'll need to check these for impact when you're done.

### On Completion

- Record learnings via `tasks.complete(id, { result: "...", learnings: ["..."] })`.
- `result`: 1-2 sentence summary of what was done and how (files changed, approach taken).
- `learnings`: list of strings capturing actionable knowledge for future tasks. Good learnings: type shape surprises, API deviations from spec, dependency quirks, perf characteristics, compiler/tooling gotchas. Bad learnings: "it worked" (obvious), "I used X" (redundant with result).
- If a task changes the shape of a type or API that downstream tasks depend on, annotate those tasks (see below).

**Required learning fields for dependency-source tasks** (tasks that appear in another task's `(depends: ...)`):

```
result: "Implemented TaskRepository::{add,remove}_blocker in os-db. Used INSERT OR IGNORE for idempotent add."
learnings:
  - "api_surface: TaskRepository in os-core/src/tasks.rs with create(), get(). MockTaskRepo in os-core/src/test_support.rs"
  - "deviations: MockStore uses Vec<Task> not HashMap — simpler for tests"
  - "file_paths: os-core/src/store.rs, os-core/src/tasks.rs, os-core/src/test_support.rs"
  - "rusqlite params! macro doesn't support &AnyTaskId directly — must call .to_string() first"
```

The first 3 learnings (`api_surface`, `deviations`, `file_paths`) are **required** for any task that other tasks depend on. Additional learnings are encouraged.

### On Spec Divergence

- If reality forces a deviation from this spec, update the spec to match reality.
- Add a `> **Deviation (Txx):** description` blockquote inline at the relevant spec section.
- Never silently diverge — the spec must always reflect the actual implementation.
- If a deviation invalidates a downstream task, add `> **Impact from Txx:** what changed -> what the dependent must do differently` to that task's line.

### On Discovering Downstream Impact

1. **Consult the Reverse Dependency Index** below for all tasks that depend on your task.
2. For each dependent, evaluate whether your implementation matches the spec's assumptions.
3. If divergent, add an impact annotation IMMEDIATELY AFTER the dependent task's line:
   `> **Impact from Txx:** <what changed> -> <what the dependent task must do differently>`
4. If the deviation is large enough to invalidate the dependent's approach, update the dependent task's description line directly.

### Roadmap Mutation Protocol

The implementation plan is a living document. Tasks can be added, removed, reordered, or re-scoped:

- **Adding tasks:** Create via Overseer with appropriate parent + blockers. Add a corresponding line to the Implementation Plan with `(added during Txx)` annotation. Update the Reverse Dependency Index.
- **Removing tasks:** Cancel in Overseer. Strike through in spec: `~~**Txx** description~~ (cancelled during Tyy: reason)`.
- **Reordering:** Update blocker relationships in Overseer. Blocker edges are the source of truth for ordering, not line position in the spec.
- **Scope changes:** If a task's scope grows beyond completable in one session, split it into subtasks. Create them in Overseer, add to spec.

---

## Reverse Dependency Index

When completing a task, consult this table to find all tasks that depend on it. Check each dependent for impact.

> **Note:** 5.1 depends on T6.1 + all facade-widening tasks (2.7–2.14). Completing any of 2.7–2.14 should trigger impact check on 5.1. These are omitted from individual rows below to avoid noise.

| Task | Depended on by |
|------|---------------|
| T1.1 | T1.5 |
| T1.2 | T1.5 |
| T1.3 | T1.5 |
| T1.4 | T1.5 |
| T1.5 | T1.6, T1.7, T4.1, 2.1, 2.6 |
| T1.6 | T1.7, T4.2, T5.1, T6.1, T7.1, 2.7 |
| T1.7 | T4.1, T5.1, T6.1, T7.1, 2.1, 2.6 |
| T3.1 | T3.2, T3.3, T4.2, T7.1, 3.2a, 3.4 |
| T3.2 | T4.2, 3.1 |
| T3.3 | 3.4 |
| T4.1 | T4.2 |
| T4.2 | T4.3, 3.3 |
| T4.3 | 3.3 |
| T5.1 | T7.2 |
| T6.1 | T6.2, 5.1 |
| T6.2 | T7.2 |
| T7.1 | T7.2 |
| 2.1 | 2.2, 2.7 |
| 2.2 | 2.10a, 2.16 |
| 2.3 | 2.13, 2.16 |
| 2.4 | 2.14 |
| 2.9a | 2.9c |
| 2.11 | 2.16 |
| 2.14 | 6.4 |
| 3.1 | 3.3, 3.4 |
| 3.2a | 3.2b, 3.2c, 3.4 |
| 3.4 | 6.4 |

---

## Implementation Plan

Tracer-bullet: thin end-to-end vertical slices proving crate boundaries first, then widen.

### Phase 0: Clean Slate + Workspace Scaffold

- [ ] **0.1** From `main` bookmark, create `v3-extraction` bookmark. Copy `specs/crate-extraction.md` to a temp location, delete everything else in the repo (all source, config, lockfiles — everything except `.jj/`), restore only the spec. Result: bare repo with just `specs/crate-extraction.md`. -- done when: `jj log` shows new bookmark, repo contains only `specs/crate-extraction.md`
- [ ] **0.2** Create workspace `Cargo.toml` (edition 2024) with 6 member crates, each with empty `lib.rs`/`main.rs` -- done when: `cargo check --workspace` exits 0
- [ ] **0.3** Wire inter-crate deps in each `Cargo.toml` matching dependency graph + add external dep stubs (tokio, jj-lib, gix, rusqlite, axum, rquickjs, clap) -- done when: `cargo check --workspace` exits 0 with all deps resolving
- [ ] **0.4** Update `AGENTS.md` STRUCTURE, COMMANDS, FEEDBACK LOOPS for workspace layout -- done when: all paths/commands reference `crates/` structure
- [ ] **0.5** Create `Justfile` with `build`, `build-ui`, `dev`, `test`, `test-crate` recipes (see Build Orchestration section) -- done when: `just test` runs `cargo test --workspace`
- [ ] **0.6** Validate rquickjs builds and executes minimal JS. In os-mcp `lib.rs`: create `rquickjs::Runtime`, `Context`, eval `"1+1"`, assert result == 2. -- done when: `cargo test -p os-mcp` passes. **If this fails** (libclang missing, bindgen errors, platform issues): document in learning, consider Node MCP fallback path. Learning validates toolchain before T6.x depends on it.

### Tracer 1: "Create task, get it back" (os-core -> os-db)

Proves: type system + Store trait + SQLite impl + Overseer facade round-trip.

- [ ] **T1.1** Define ID newtypes + `AnyTaskId` enum in os-core with `FromStr`/`Display`/serde -- test: `"task_01ABC...".parse::<AnyTaskId>()` ok, `"bad_01ABC".parse()` err, round-trip through serde_json
- [ ] **T1.2** Define enums (`Priority`, `TaskStatus`, `TaskKind`) + `Task` struct in os-core with serde -- test: serialize Task to JSON, deserialize back, all fields equal
- [ ] **T1.3** Define `OverseerError` in os-core -- test: error is `Send + Sync + 'static`, displays human-readable message
- [ ] **T1.4** Define `CreateTaskInput`, `ListTasksFilter` DTOs in os-core -- test: deserialize from JSON with optional fields omitted
- [ ] **T1.5** (depends: T1.1, T1.2, T1.3, T1.4) Define `TaskRepository` trait (create + get + update — update needed by T4.2/T4.3 for status transitions), `RepoRepository` trait (register + get_by_path — minimal, needed by entry-point tracers T5.1/T6.1/T7.1 for default repo bootstrap), `Store` trait (Tasks + Repos GATs fully implemented, other 2 GATs as empty stub traits + dummy repo structs — see MockStore pattern above), write `MockStore`. File: `os-core/src/store.rs`, `os-core/src/tasks.rs`, `os-core/src/repos.rs`. -- test: `mock_store.tasks().create(task)` then `.get(&id)` round-trips; `.update(task)` then `.get(&id)` reflects changes; `mock_store.repos().register(repo)` then `.get_by_path(path)` returns it
- [ ] **T1.6** (depends: T1.5) Define `Overseer<S: Store>` with constructor `Overseer::new(store, vcs)` + `TasksApi` with `create()` (validates input, generates ID, delegates to store) and `get()` (returns `Task`, not `TaskWithContext` — see Tracer 5 note). `create()` requires `repo_id` via `CreateTaskInput.repo_id` (not Optional — entry points resolve defaults). Repo existence validation deferred to Phase 2 (task 2.4). File: `os-core/src/overseer.rs`, `os-core/src/tasks.rs`. MockStore tests: seed a `Repo` in `MockStore.repos` and pass its ID in `CreateTaskInput.repo_id`. -- test: `Overseer<MockStore>.tasks().create(input)` returns task with `ms_`-prefixed ID; create with empty description returns `InvalidInput`
- [ ] **T1.7** (depends: T1.5, T1.6) Implement `DbStore` in os-db with SQLite schema, implement `TaskRepository::create` + `get` + `update` AND `RepoRepository::register` + `get_by_path`. Test setup: register a repo via `store.repos().register(repo)` (no raw SQL seeding), pass its ID in `CreateTaskInput.repo_id`. File: `os-db/src/store.rs`, `os-db/src/task_repo.rs`, `os-db/src/repo_repo.rs`. -- test: `Overseer<DbStore>` with `:memory:`, register repo, create task with repo_id, get by ID, assert description matches; update status, get again, assert status changed

### Tracer 3: "Git backend manages bookmarks" (os-vcs)

Proves: VcsBackend trait is implementable, GitBackend works with gix.

- [ ] **T3.0** Validate jj-lib compiles and basic API works. In os-vcs, add `jj-lib` dep (exact pin), write a test that opens a temp jj repo via `jj-lib` API. -- done when: `cargo test -p os-vcs` passes. **If this fails** (pin incompatible with toolchain, API changed): delay JjBackend, ship git-only first via gix. Learning validates jj-lib pin before 3.2x depends on it.
- [ ] **T3.1** Define `VcsBackend` trait + `VcsError` + supporting types in os-vcs -- test: confirm trait is object-safe (`let _: Box<dyn VcsBackend> = Box::new(GitBackend::open(&temp)?);` compiles + runs against temp git repo)
- [ ] **T3.2** Implement `GitBackend` for `vcs_type()`, `is_clean()`, `current_commit_id()`, `create_bookmark()`, `delete_bookmark()`, `list_bookmarks()` -- test: temp git repo, create bookmark, assert `list_bookmarks` includes it, delete, assert gone
- [ ] **T3.3** Implement `detect_type(path) -> Option<VcsType>` (detection-only, returns enum not backend) -- test: temp dir with `.git/` -> returns `Some(Git)`; dir with `.jj/` + `.git/` -> returns `Some(Jj)` (jj-first); empty dir -> `None`. `detect_backend(path) -> Option<Box<dyn VcsBackend>>` deferred to T3.4 (Phase 3) after JjBackend exists.

### Tracer 4: "Task start creates bookmark" (os-core <-> os-vcs <-> os-db)

Proves: Overseer orchestrates Store + VcsBackend together.

- [ ] **T4.1** (depends: T1.5, T1.7) Add `TaskVcsRepository` trait + `TaskVcs` type, add to Store -- test: MockStore records TaskVcs, round-trips
- [ ] **T4.2** (depends: T1.6, T3.1, T3.2, T4.1) Wire `Option<Box<dyn VcsBackend>>` into Overseer, implement `VcsApi::start()` -- validates Pending status, calls `create_bookmark`, records TaskVcs, sets InProgress -- test (with real temp git repo + GitBackend from T3.2): start task, assert status == InProgress, assert bookmark exists in repo (`list_bookmarks`), assert TaskVcs record exists
- [ ] **T4.3** (depends: T4.2) Implement `VcsApi::complete()` -- commits, checkouts start_commit, deletes bookmark, sets Completed -- test (with real temp git repo): start -> complete, assert status Completed, assert bookmark deleted, assert commit exists in log

### Tracer 5: "HTTP endpoint creates and lists tasks" (os-serve <-> os-core)

Proves: Axum -> spawn_blocking -> Overseer<DbStore> -> JSON response.

> **Note:** Early tracers (T5.1, T6.1, T6.2, T7.1) return `Task`, not `TaskWithContext`. `TaskWithContext` assembly requires 2.2 (ancestors), 2.3 (learnings), 2.11 (effectively_blocked), wired in 2.16. Update tests to accept `Task` until then.

- [ ] **T5.1** (depends: T1.6, T1.7) Define `AppState` with `Arc<Mutex<Overseer<DbStore>>>`, implement `POST /api/tasks` + `GET /api/tasks/:id` (returns `Task`, not `TaskWithContext` — see note above) -- test: POST body `{"description":"test","repoId":"repo_..."}` -> 201 + JSON with ID; GET that ID -> 200 + matching description; GET nonexistent -> 404. Entry point seeds default repo on startup, injects `repo_id` when missing from request body.

### Tracer 6: "MCP JS creates a task" (os-mcp <-> os-core)

Proves: JS -> rquickjs -> call_sdk -> Overseer<DbStore> -> JSON -> JS.

- [ ] **T6.1** (depends: T1.6, T1.7) Implement `call_sdk` dispatch for `"tasks.create"` + `"tasks.get"` in os-mcp (returns `Task`, not `TaskWithContext` — see Tracer 5 note). Entry point seeds default repo, injects `repo_id`. -- test: `call_sdk("tasks.create", json)` with `:memory:` DbStore, parse result, assert description matches
- [ ] **T6.2** (depends: T6.1) Set up rquickjs runtime, inject `__os_call_raw`, load bootstrap JS defining `tasks.create` + `tasks.get` -- test: evaluate `tasks.create({description: "from_js", repoId: "repo_..."})` (**sync, not await** — calls are synchronous), assert returned object has matching description

### Tracer 7: "CLI binary wires everything" (os-cli)

Proves: Single binary constructs all deps, routes to subsystems.

- [ ] **T7.1** (depends: T1.6, T1.7, T3.1) Implement `main()` with clap, `task create` + `task get` subcommands -- test: use `assert_cmd` crate (add to dev-dependencies) or `cargo run -p os-cli --` to invoke binary. `os task create --description "test"`, parse stdout JSON, assert description matches
- [ ] **T7.2** (depends: T5.1, T6.2, T7.1) Add `os serve` + `os mcp` subcommands routing to os-serve/os-mcp -- test: spawn `os serve --port 0`, POST task to bound port, assert 201

### Phase 2: Widen Core

Full CRUD + business logic + all repository traits.

**Dependencies:** Tasks 2.1-2.14 are listed in recommended order (2.5 and 2.15 removed with event system). Each task depends on prior tasks in the same group unless otherwise noted. Groups: Store widening (2.1-2.6), Facade widening (2.7-2.16). Facade tasks depend on the corresponding Store trait methods from 2.1-2.6.

**Store trait widening:**

- [ ] **2.1** (depends: T1.5, T1.7) Add `TaskRepository::list(filter)`, `update`, `delete` (CASCADE children+learnings) to trait + DbStore. File: `os-core/src/tasks.rs`, `os-db/src/task_repo.rs`. -- test: create 3 tasks, list with status filter returns subset; delete parent cascades children
- [ ] **2.2** Add hierarchy queries to TaskRepository: `children(id)`, `ancestors(id)`. File: `os-core/src/tasks.rs`, `os-db/src/task_repo.rs`. -- test: create ms -> task -> sub, ancestors(sub) returns [task, ms]
- [ ] **2.3** Add `LearningRepository` trait + impl (create, list_for_task, inherited, delete_for_task). File: `os-core/src/learnings.rs`, `os-db/src/learning_repo.rs`. -- test: create learning, inherited() returns `{ own: [learning], parent: [], milestone: [] }`
- [ ] **2.4** Widen `RepoRepository` trait with `get`, `list`, `unregister` (register + get_by_path already exist from T1.5/T1.7). File: `os-core/src/repos.rs`, `os-db/src/repo_repo.rs`. -- test: register repo, get by ID returns it, list returns all, unregister removes it. **Note:** After this task, add repo existence validation to `TasksApi::create()` (check `store.repos().get(&repo_id)` before creating task).
- [ ] **2.6** (depends: T1.5, T1.7) Implement `Store::with_tx` in DbStore (see `with_tx` semantics in Simplified Store Trait section). Use `Cell<bool>` to track transaction state for the Drop guard. `rusqlite::Connection` methods take `&self` (interior mutability), so `&mut` is not needed. File: `os-db/src/store.rs`. -- test: create in tx + return Err -> task doesn't exist; create in tx + return Ok -> task exists

**Overseer facade widening:**

- [ ] **2.7** (depends: T1.6, 2.1) `TasksApi`: list, update, delete with validation -- test: update with empty description -> InvalidInput; delete cascades
- [ ] **2.8** `TasksApi`: cancel, archive, reopen with status transition validation. `TasksApi` receives `Option<&dyn VcsBackend>` from `Overseer` (injected alongside Store reference). Cancel from InProgress does best-effort VCS bookmark deletion via `TaskVcsRepository::get()` + `VcsBackend::delete_bookmark()` — log warning on failure, don't propagate error. -- test: cancel Pending ok, cancel Completed err; archive InProgress err; reopen Completed -> Pending; cancel InProgress deletes bookmark (with real temp git repo)
- [ ] **2.9a** `TasksApi::add_blocker` — validate both IDs exist, same-repo, not self-block, no cross-depth restriction. File: `os-core/src/tasks.rs`. Test: add_blocker(A, B) succeeds; add_blocker(A, A) returns `SelfBlock`
- [ ] **2.9b** `TasksApi::remove_blocker` — remove edge from junction table. File: `os-core/src/tasks.rs`. Test: add then remove, `blockers(A)` returns empty
- [ ] **2.9c** (depends: 2.9a) DFS cycle detection in `add_blocker` — walk `blocked_by` graph from proposed blocker to see if it transitively reaches the task being blocked. File: `os-core/src/tasks.rs`. Ref: `overseer/src/core/task_service.rs` (main). Note: main's DFS uses a visited set and returns bool; to populate `CycleDetected.path`, use a stack-based DFS that records the traversal path. Test: A blocks B (`add_blocker(B, A)`), B blocks C (`add_blocker(C, B)`), attempt `add_blocker(A, C)` returns `CycleDetected` — assert the path contains {A, B, C} (exact order depends on DFS traversal; don't assert exact vector equality)
- [ ] **2.10a** `TasksApi::tree(root_id)` — recursive `children()` calls building `TaskTree`. File: `os-core/src/tasks.rs`. Test: ms -> 2 tasks -> 1 sub each, tree has correct nesting
- [ ] **2.10b** `TasksApi::progress(root_id)` — aggregate `TaskProgress` counts over descendants. File: `os-core/src/tasks.rs`. Test: 5 tasks (2 completed, 1 in_progress, 1 ready, 1 blocked), counts match
- [ ] **2.10c** `TasksApi::next_ready(scope)` — DFS deepest unblocked leaf, ordered by priority then created_at. File: `os-core/src/tasks.rs`. Test: hierarchy with mixed statuses/priorities, returns highest-priority deepest unblocked leaf
- [ ] **2.10d** `TasksApi::search(query, repo_id)` — delegates to `TaskRepository::search`. File: `os-core/src/tasks.rs`. Test: create tasks with "auth" in description, search("auth") returns them
- [ ] **2.11** `TasksApi`: `effectively_blocked` computation on get/list -- test: A blocks B, B blocks C, effectively_blocked(C) == true; complete A, effectively_blocked(B) == false, effectively_blocked(C) == true (B still incomplete)
- [ ] **2.12** Learning bubbling on task completion -- test: add learning to task, complete task, parent's inherited learnings include it with correct source_task_id
- [ ] **2.13** `LearningsApi`: list, inherited -- test: correct own/parent/milestone bucketing
- [ ] **2.14** `ReposApi`: register, get, get_by_path, list, unregister -- test: full CRUD lifecycle
- [ ] **2.16** (depends: 2.2, 2.3, 2.11) Wire `TaskWithContext` assembly into `TasksApi::get()` — join task + context (own/parent/milestone from `ancestors`) + learnings (`inherited()`) + vcs (`TaskVcsRepository::get`) + `effectively_blocked`. File: `os-core/src/tasks.rs`. -- test: create ms -> task with context + learning + vcs, `get()` returns `TaskWithContext` with all fields populated

### Phase 3: Widen VCS Backends

- [ ] **3.1** Complete `GitBackend`: remaining methods (commit, status, log, diff, checkout, list_bookmarks) -- test: full bookmark lifecycle in temp git repo
- [ ] **3.2a** (depends: T3.1) `JjBackend`: basic methods — `vcs_type()`, `is_clean()`, `current_commit_id()`. File: `os-vcs/src/jj.rs`. Ref: `overseer/src/vcs/jj.rs` (main), `crates/os-vcs/src/jj.rs` (v2). Test: temp jj repo, `is_clean()` true on fresh, `current_commit_id()` returns valid string
- [ ] **3.2b** (depends: 3.2a) `JjBackend`: bookmark ops — `create_bookmark()`, `delete_bookmark()`, `list_bookmarks()`. Test: create bookmark, list includes it, delete, list excludes it
- [ ] **3.2c** (depends: 3.2a) `JjBackend`: remaining — `commit()`, `diff()`, `log()`, `status()`, `checkout()`. Test: modify file, `is_clean()` false, `commit()`, `is_clean()` true, `log(1)` shows commit
- [ ] **3.3** (depends: T4.2, T4.3, 3.1) Milestone completion VCS cleanup: delete descendant bookmarks -- test: start ms + 2 children (3 bookmarks), complete all, assert all bookmarks deleted
- [ ] **3.4** (depends: 3.2a, 3.1, T3.3) Implement `detect_backend(path) -> Option<Box<dyn VcsBackend>>` — calls `detect_type`, then constructs `JjBackend` or `GitBackend`. File: `os-vcs/src/detect.rs`. -- test: temp jj repo -> returns `Some(Box<JjBackend>)`; temp git repo -> returns `Some(Box<GitBackend>)`; empty dir -> `None`

### Phase 4: Widen HTTP API (os-serve)

- [ ] **4.1** Task CRUD routes: `GET /api/tasks`, `PUT /api/tasks/:id`, `DELETE /api/tasks/:id` -- test: create -> list (length 1) -> update -> get (updated) -> delete -> get (404)
- [ ] **4.2** Workflow routes: `POST .../start`, `.../complete`, `.../cancel`, `.../archive`, `.../reopen` -- test: create -> start (InProgress) -> complete (Completed)
- [ ] **4.3** Blocker routes + query routes: block, unblock, tree, progress, next-ready, search -- test: create hierarchy, GET tree returns nested JSON
- [ ] **4.4** Learning + repo routes -- test: complete with learnings, GET inherited returns bucketed
- [ ] **4.5** Error mapping middleware: `OverseerError` -> HTTP status codes -- test: each error variant maps to expected status
- [ ] **4.6** Static file serving for React UI -- test: `GET /` returns HTML

### Phase 5: Widen MCP (os-mcp)

- [ ] **5.1** (depends: T6.1, 2.7, 2.8, 2.9a, 2.9b, 2.9c, 2.10a, 2.10b, 2.10c, 2.10d, 2.11, 2.12, 2.13, 2.14) All `tasks.*` methods in call_sdk dispatch -- test: each method callable from JS with correct return shape
- [ ] **5.2** `learnings.*` + `repos.*` methods -- test: JS round-trip for each
- [ ] **5.3** MCP JSON-RPC stdio transport -- test: write request to stdin pipe, read valid JSON-RPC response
- [ ] **5.4** Error propagation: OverseerError -> JS exception with `_tag` -- test: `tasks.get("nonexistent")` throws with `_tag === "NotFound"`

### Phase 6: Widen CLI (os-cli)

- [ ] **6.1a** CRUD subcommands: `task list`, `task update`, `task delete` -- test: `os task list --status pending` returns correct subset; `os task delete <id>` -> 0 exit + gone
- [ ] **6.1b** Workflow subcommands: `task start`, `task complete`, `task cancel`, `task reopen`, `task archive` -- test: `os task start <id>` -> status InProgress in JSON output
- [ ] **6.1c** Blocker subcommands: `task block`, `task unblock` -- test: `os task block <id> <blocker_id>` -> 0 exit; `os task get <id>` shows blocker in `blockedBy`
- [ ] **6.1d** Query subcommands: `task tree`, `task progress`, `task next-ready`, `task search` -- test: `os task tree <ms_id>` returns nested JSON; `os task search "auth"` returns matches
- [ ] **6.2** Learning + repo subcommands -- test: `os learning inherited <id>` returns JSON with own/parent/milestone
- [ ] **6.3** `--json` flag (default for piped output) + human-readable table default -- test: `os task list` without --json produces table; with --json produces JSON array
- [ ] **6.4** (depends: 2.14, 3.4) Repo context: `--repo` flag / `OVERSEER_REPO` env / cwd detection -- test: register repo, set env, create task, assert task associated

### Phase 7: Integration + Cleanup

- [ ] **7.1** E2E test via CLI: repo register -> task create (milestone) -> task create (child) -> start -> complete with learning -> tree -> progress -- test: single test exercising full chain
- [ ] **7.2** E2E test via HTTP: same lifecycle via HTTP requests -- test: spawn server, full lifecycle via reqwest
- [ ] **7.3** E2E test via MCP: same lifecycle via JS -- test: JS script through rquickjs executor
- [ ] **7.4** Remove old `overseer/` monolith crate from workspace -- done when: `cargo check --workspace` passes
- [ ] **7.5** Update `npm/` distribution for single binary -- done when: build produces working binary
- [ ] **7.6** Update skills for new API -- done when: skill SKILL.md commands match new CLI
- [ ] **7.7** Update `AGENTS.md` for new crate structure -- done when: all paths/commands accurate

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| Backwards compatibility | **None.** Clean-slate DB schema. No migrations. No deprecation. |
| VcsBackend dispatch | `Box<dyn VcsBackend>` trait objects. |
| VcsBackend style | `&self` instance methods. Construct with repo path, call without repeating it. |
| Event system | **Removed.** Feature-scope creep — no current consumer needs event persistence or real-time streaming. UI uses polling. Reintroduce only if concrete trigger appears (webhooks, external integrations, audit mandate). |
| Concrete at boundaries | os-serve and os-mcp use `Overseer<DbStore>` directly. Only os-core is generic over `S: Store`. |
| Binary crate name | `os-cli` crate with `[[bin]] name = "os"`. |
| `blocks` reverse relation | **Dropped.** `blocked_by` is the single source of truth. Compute `blocks` via query when needed. |
| `effectively_blocked` | **Computed on read.** Added to enriched responses (list/get), not stored. |
| Test strategy | **TDD the extraction.** Write tests first for each crate, then implement to make them pass. |
| UI build pipeline | **Justfile.** `just build` orchestrates `vite build` then `cargo build`. Explicit, not hidden in build.rs. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| rquickjs behavioral differences from Node VM | Low | Medium | Port existing MCP test suite. Compare outputs. |
| React UI build embedding bloats binary | Low | Low | Measure. UI assets are typically <5MB gzipped. |
| Multi-repo adds complexity to every query | Medium | Medium | Default repo auto-registered. Single-repo usage path stays simple. |
| GAT + edition 2024 compiler bugs | Low | High | GATs are stable since 1.65 but edge cases exist. If Store GATs cause ICEs: **Level 1** — fall back to `&self` returning concrete types with lifetime elision (e.g., `fn tasks(&self) -> DbTaskRepo<'_>`). **Level 2** — if lifetime elision insufficient, use trait-object repos: `fn tasks(&self) -> Box<dyn TaskRepository + '_>`. |

## Non-Goals

- Performance optimization (not the point of this refactor)
- New features beyond what main already has + multi-repo
- OpenAPI generation (can add later with utoipa)
- Web UI redesign (port existing UI, don't redesign)
- Backwards compatibility with v0.11 data

---

## Reference Files

The `v2-greenfield` bookmark remains as a read-only reference. Use `jj file show -r v2-greenfield -- <path>` to inspect.

### From `main` (reference for implementation)

| File | What | Why |
|------|------|-----|
| `overseer/src/core/task_service.rs` | Task validation, cycle detection (DFS), hierarchy enforcement, blocker resolution | ~1400 lines of battle-tested business logic |
| `overseer/src/core/workflow_service.rs` | VCS-integrated start/complete/milestone flows | ~800 lines; task<->VCS lifecycle orchestration |
| `overseer/src/core/context.rs` | TaskWithContext, InheritedLearnings (runtime enrichment) | Context chain + learning inheritance algorithms |
| `overseer/src/vcs/backend.rs` | Current VcsBackend trait (richer than v2: status, log, bookmarks) | Trait shape to keep in os-vcs |
| `overseer/src/vcs/jj.rs` | jj-lib backend implementation | Reference for os-vcs JjBackend |
| `overseer/src/vcs/git.rs` | gix backend implementation | Reference for os-vcs GitBackend |
| `overseer/src/db/schema.rs` | Current SQLite schema | Reference for os-db schema design |
| `overseer/src/db/task_repo.rs` | Task CRUD SQL | SQL patterns to reuse in os-db |
| `overseer/src/db/learning_repo.rs` | Learning CRUD SQL | SQL patterns to reuse in os-db |
| `overseer/src/types.rs` | Current domain types (Task, Learning, IDs) | Reference for os-core types |
| `overseer/src/error.rs` | OsError enum (25+ variants) | Error variants to preserve in os-core |
| `ui/src/api/routes/` | Hono API route handlers | Reference for os-serve route structure |
| `ui/src/client/` | React SPA components | Keep as-is, just change API layer |
| `mcp/src/api/tasks.ts` | Current MCP task API surface | Defines the contract agents depend on |
| `mcp/src/executor.ts` | Current Node VM executor | Reference for os-mcp parity |

### From `v2-greenfield` (patterns to adopt)

| File | What | Why |
|------|------|-----|
| `crates/os-core/src/store.rs` | Store super-trait with GATs | Pattern to adopt (strip to 4 associated types) |
| `crates/os-core/src/overseer.rs` | `Overseer<S: Store>` facade + sub-API structs | SDK pattern |
| `crates/os-core/src/types/ids.rs` | `AnyTaskId` enum, `ms_`/`task_`/`sub_` prefixed newtypes | ID system to adopt |
| `crates/os-core/src/types/task.rs` | Task struct with `AnyTaskId`, `RepoId`, `TaskStatus` enum | Target task shape |
| `crates/os-core/src/types/io.rs` | CreateTaskInput, UpdateTaskInput, TaskFilter | Input/filter DTOs |
| `crates/os-core/src/vcs.rs` | Domain-level VCS traits (TaskVcsRepository) | Storage trait for VCS metadata |
| `crates/os-vcs/src/backend.rs` | VcsBackend trait + VcsError + Diff | Trait shape (merge with main's richer version) |
| `crates/os-vcs/src/jj.rs` | jj-lib backend (native, no CLI spawn) | ~392 lines; improved jj implementation |
| `crates/os-vcs/src/git.rs` | gix backend (pure Rust) | ~405 lines; improved git implementation |
| `crates/os-db/src/store.rs` | `DbStore` implementing Store for SQLite | Implementation pattern for os-db |
| `crates/os-db/src/task_repo.rs` | TaskRepo with GAT lifetime | Per-entity repo pattern |
| `crates/os-mcp/src/executor.rs` | rquickjs runtime, bootstrap JS, `call_sdk` bridge | ~621 lines; reference for os-mcp |
| `crates/os-serve/src/routes/` | Axum route handlers | Reference for os-serve route structure |
