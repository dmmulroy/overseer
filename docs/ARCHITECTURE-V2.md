# Overseer v2 Architecture

**Status:** Draft v2  
**Date:** 2026-02-05  
**Canonical specs:** `docs/specs/01-core-domain.md` (source of truth for types/invariants)

> **This is a greenfield rebuild.** No code carries over from Overseer v1. Fresh branch, fresh codebase, informed by lessons learned.

## Vision

Overseer v2 is a **local code review and agent orchestration platform**. GitHub PR reviews + Linear task management + agent harness broker, all local-first, single Rust binary.

## Design Principles

1. **Stripe SDK-style API** — `overseer.tasks.create()`, not heavy DDD abstractions
2. **Single Rust binary** — rquickjs for codemode, no Node.js dependency
3. **Multi-repo/multi-project** — Manage tasks across repositories
4. **Stacked diffs** — Each task has persistent VCS artifacts for review
5. **Event-driven** — Internal pub/sub for decoupling + future plugins
6. **Interface-agnostic core** — CLI, MCP, REST, UI all use same SDK
7. **OpenAPI-first** — Generate clients, don't hand-write them
8. **Types encode business rules** — If a state is invalid, make it unrepresentable
9. **jj-first** — All VCS references use stable identifiers that survive rewrites

---

## System Architecture

### Single Binary, Multiple Modes

```
os <command>      # Fast CLI (direct SDK calls, no daemon needed)
os serve          # Axum server (REST, SSE, Relay WS, embedded webapp)
os mcp            # MCP server mode (rquickjs executor, stdio transport)
```

### Architecture Diagram

```
+---------------------------------------------------------------+
|                       os (single binary)                      |
|                                                               |
|  +---------------------------- os-core ---------------------+ |
|  | tasks::* reviews::* gates::* help::* learnings::*        | |
|  | repos::* events::*                                       | |
|  +-------------------------+--------------------------------+ |
|            |               |                |                 |
|        +---+---+       +---+---+        +---+---+             |
|        | os-db |       | os-vcs|        |events|             |
|        |sqlite|       |jj/gix|        |tokio |             |
|        +---+---+       +---+---+        +---+---+             |
|            |               |                |                 |
|   +--------+--------+  +---+-----+   +------+-------+         |
|   | CLI (clap) |     | Serve(axum)|  | MCP (rquickjs)|         |
|   +------------+     +-----+------+  +--------------+         |
|                        |   |   |                         |
|                 +------+ +---+ +-------+                   |
|                 | REST | |SSE| | Relay |                   |
|                 |API   | |WS | |  WS   |                   |
|                 +---+--+ +---+ +---+---+                   |
|                     |         |     |                      |
| Clients: Webapp <---+---------+--> Harnesses               |
|          TUI/Tauri                     (OpenCode, etc)     |
+---------------------------------------------------------------+
```

### Crate Structure

See `docs/specs/00-monorepo.md` for full detail. Summary:

| Crate | Purpose |
|-------|---------|
| `os` | Binary: clap CLI + mode dispatch |
| `os-core` | Domain types, SDK API, business logic |
| `os-db` | SQLite persistence, migrations |
| `os-vcs` | VCS backends (jj-lib + gix) |
| `os-events` | Event types, bus, persistence |
| `os-serve` | Axum server, REST, SSE, Relay, static |
| `os-mcp` | MCP protocol, rquickjs executor |

### Client Connectivity

| Client | Connection |
|--------|------------|
| **Webapp** | HTTP + SSE/WS to `os serve` (embedded via rust-embed) |
| **Tauri desktop** | Sidecar `os serve`, HTTP/WS |
| **TUI** | HTTP/WS to `os serve` (or standalone CLI) |
| **MCP/codemode** | In-process rquickjs inside `os serve` or `os mcp` |

### SQLite Strategy

- **WAL mode** for concurrent reads
- **busy_timeout** for write contention
- CLI works standalone (direct SQLite)
- When `os serve` running, CLI optionally routes through server
- Server as single writer → events always captured in-memory pub/sub

---

## Core Domain Model

> **Canonical reference:** `docs/specs/01-core-domain.md`

### Entity Hierarchy

```
Milestone (ms_...)     ← depth 0, root container
  └── Task (task_...)  ← depth 1, unit of work
       └── Subtask (sub_...) ← depth 2, sub-unit
       
Task (task_...)        ← depth 0, standalone (no parent)
  └── Subtask (sub_...)
```

### Entity IDs

All IDs use ULID with typed prefixes: `ms_`, `task_`, `sub_`, `lrn_`, `rev_`, `cmt_`, `repo_`, `gate_`, `help_`. Union type `AnyTaskId` enables polymorphic task operations.

### Task Lifecycle

```
                    ┌─────────────┐
                    │   Pending   │
                    +------+------+
                           | start()
                           v
                   ┌─────────────┐
         +--------|  InProgress  |<-----------+
         |        +------+------+             |
         |               | submit()           |
         |               v                    |
         |        ┌─────────────┐             |
         |        |  InReview   |-------------+
         |        +------+------+  reject()   |
         |               | approve()          |
         |               v                    |
         |        ┌─────────────┐             |
         |        |  Completed  |             |
         |        └─────────────┘             |
         |                                    |
         |        ┌───────────────┐           |
         +------->| AwaitingHuman |<----------+
         |        +-------+-------+           |
         |                | resume()          |
         |                +-------------------+
         |
         +-- cancel() --> Cancelled
```

**Key additions from v1:** `AwaitingHuman` status (agent requests human help), `InReview` now gates a three-phase pipeline (Gates → Agent Review → Human Review).

### Priority

4 levels: Urgent(0), High(1), Normal(2), Low(3). Lower numeric = higher priority.

### Core Entities

| Entity | ID Prefix | Purpose |
|--------|-----------|---------|
| Task | `ms_`/`task_`/`sub_` | Unit of work (polymorphic via TaskKind) |
| TaskVcs | — | VCS artifacts (ref, change_id, base/head commit) |
| Review | `rev_` | Three-phase review session (Gates→Agent→Human) |
| ReviewComment | `cmt_` | PR-style diff comment (file/line/side) |
| Gate | `gate_` | Quality check (shell command, pass/fail) |
| GateResult | — | Execution result per gate per review |
| HelpRequest | `help_` | Agent→human escalation with structured response |
| Learning | `lrn_` | Knowledge captured during task execution |
| Repo | `repo_` | Registered repository |

---

## Review Pipeline

> **Canonical reference:** `docs/specs/01-core-domain.md` (Review types), `docs/specs/03a-gates.md` (gate execution)

### Three-Phase Pipeline

```
submit()
   |
   v
GatesPending ──[all pass]──> AgentPending ──[approve]──> HumanPending ──[approve]──> Approved
   |                             |                           |
   +──[retries exhausted]──> GatesEscalated                  |
   |                             |                           |
   +─────────────────────────────+───────────────────────────+──> ChangesRequested
                                                                     |
                                                              (task → InProgress)
```

### Gates

Gates are shell commands that return exit codes: 0=pass, 75=pending (async), other=fail. They run before **each** review phase transition. Gates inherit downward: Repo → Milestone → Task → Subtask.

Configuration via `.overseer/gates.toml` or task context YAML front matter.

### HelpRequests

Agents can request human help via `request_help()`. Task transitions to `AwaitingHuman`, preserving `from_status`. Human responds + resumes. Categories: Clarification, Decision, TechnicalBlocker, Unexpected.

---

## Core SDK Design (Stripe-style)

### Module Structure

```rust
// os-core/src/lib.rs
pub mod tasks;      // Task CRUD + lifecycle
pub mod reviews;    // Three-phase review pipeline
pub mod gates;      // Quality gate management
pub mod help;       // Help request workflow
pub mod learnings;  // Learning management
pub mod repos;      // Multi-repo management
pub mod events;     // Event bus + subscriptions
```

### API Surface

```rust
// Tasks
overseer.tasks.create(CreateTaskInput) -> Result<Task>
overseer.tasks.get(AnyTaskId) -> Result<TaskWithContext>
overseer.tasks.list(TaskFilter) -> Result<Vec<Task>>
overseer.tasks.update(AnyTaskId, UpdateTaskInput) -> Result<Task>
overseer.tasks.delete(AnyTaskId) -> Result<()>
overseer.tasks.start(AnyTaskId) -> Result<Task>
overseer.tasks.submit(AnyTaskId) -> Result<Task>
overseer.tasks.cancel(AnyTaskId) -> Result<Task>
overseer.tasks.force_complete(AnyTaskId) -> Result<Task>  // Human only
overseer.tasks.set_status(AnyTaskId, TaskStatus) -> Result<Task>  // Human only
overseer.tasks.block(AnyTaskId, AnyTaskId) -> Result<()>
overseer.tasks.unblock(AnyTaskId, AnyTaskId) -> Result<()>
overseer.tasks.next_ready(RepoId, Option<MilestoneId>) -> Result<Option<TaskWithContext>>
overseer.tasks.tree(Option<AnyTaskId>) -> Result<TaskTree>
overseer.tasks.progress(RepoId, Option<AnyTaskId>) -> Result<TaskProgress>

// Reviews
overseer.reviews.get(ReviewId) -> Result<Review>
overseer.reviews.get_active(AnyTaskId) -> Result<Option<Review>>
overseer.reviews.list(AnyTaskId) -> Result<Vec<Review>>
overseer.reviews.comment(CreateCommentInput) -> Result<ReviewComment>
overseer.reviews.list_comments(ReviewId) -> Result<Vec<ReviewComment>>
overseer.reviews.resolve_comment(CommentId) -> Result<ReviewComment>
overseer.reviews.approve(AnyTaskId) -> Result<Task>
overseer.reviews.request_changes(AnyTaskId, Vec<CreateCommentInput>) -> Result<Review>

// Gates
overseer.gates.add(CreateGateInput) -> Result<Gate>
overseer.gates.list(GateScope) -> Result<Vec<Gate>>
overseer.gates.get_effective(AnyTaskId) -> Result<Vec<Gate>>
overseer.gates.remove(GateId) -> Result<()>
overseer.gates.update(GateId, UpdateGateInput) -> Result<Gate>
overseer.gates.results(ReviewId) -> Result<Vec<GateResult>>
overseer.gates.rerun(ReviewId) -> Result<()>

// Help
overseer.help.request(CreateHelpRequestInput) -> Result<HelpRequest>
overseer.help.respond(HelpRequestId, HelpResponseInput) -> Result<HelpRequest>
overseer.help.resume(AnyTaskId) -> Result<Task>
overseer.help.get_active(AnyTaskId) -> Result<Option<HelpRequest>>
overseer.help.list(AnyTaskId) -> Result<Vec<HelpRequest>>

// Learnings
overseer.learnings.add(AnyTaskId, String) -> Result<Learning>
overseer.learnings.list(AnyTaskId) -> Result<Vec<Learning>>
overseer.learnings.get_inherited(AnyTaskId) -> Result<InheritedLearnings>

// Repos
overseer.repos.register(PathBuf) -> Result<Repo>
overseer.repos.get(RepoId) -> Result<Repo>
overseer.repos.get_by_path(Path) -> Result<Option<Repo>>
overseer.repos.list() -> Result<Vec<Repo>>
overseer.repos.unregister(RepoId) -> Result<()>

// Events
overseer.events.subscribe(EventFilter) -> EventStream
overseer.events.list(EventQuery) -> Result<Vec<Event>>
overseer.events.replay(AfterSeq, Limit) -> Result<Vec<Event>>
```

### Internal Structure

```rust
pub struct Overseer {
    pub tasks: Tasks,
    pub reviews: Reviews,
    pub gates: Gates,
    pub help: Help,
    pub learnings: Learnings,
    pub repos: Repos,
    pub events: Events,
}

impl Overseer {
    pub fn new(config: Config) -> Result<Self> { ... }
}

// Each module holds shared dependencies
pub struct Tasks {
    db: Arc<Database>,
    vcs: Arc<VcsManager>,
    events: Arc<EventBus>,
}
```

---

## VCS Model

### TaskVcs (Separated from Task)

VCS artifacts are stored separately to keep the domain model VCS-agnostic and allow planning-only mode (no VCS required for task creation).

```rust
pub struct TaskVcs {
    pub task_id: AnyTaskId,
    pub repo_id: RepoId,
    pub vcs_type: VcsType,         // Jj | Git
    pub ref_name: String,          // Bookmark (jj) or branch (git)
    pub change_id: String,         // jj: ChangeId (stable), git: branch name
    pub base_commit: String,       // Diff base (parent's head or main)
    pub head_commit: Option<String>, // Set on submit
    pub start_commit: String,      // SHA at task start
    pub archived_at: Option<DateTime<Utc>>,
}
```

**jj-first:** Uses ChangeId (stable across rewrites) for persistent references. Git falls back to branch names.

**Stack-preserving:** Refs preserved on complete. `os task archive` or `os gc` for cleanup.

### Stacked Diffs

```
Milestone (ms_01ABC)
├── base_commit: main@abc123
├── head_commit: abc456
│
├── Task A (task_01DEF)
│   ├── base_commit: abc456 (milestone's head)
│   ├── head_commit: def789
│   │
│   └── Subtask A1 (sub_01GHI)
│       ├── base_commit: def789 (parent's head)
│       └── head_commit: ghi012
│
└── Task B (task_01MNO)
    ├── base_commit: abc456 (milestone's head)
    └── head_commit: mno678
```

Each task's `base_commit` is its parent's `head_commit`. Diff for any task shows only that task's changes.

---

## Event System

### Event Structure

```rust
pub struct Event {
    pub id: EventId,
    pub seq: i64,                    // Monotonic sequence for tailing
    pub at: DateTime<Utc>,
    pub correlation_id: Option<String>,
    pub source: EventSource,         // Cli | Mcp | Ui | Relay
    pub body: EventBody,
}
```

### Event Types

```rust
pub enum EventBody {
    // Task lifecycle
    TaskCreated { task: Task },
    TaskUpdated { task: Task },
    TaskStarted { task: Task },
    TaskSubmitted { task: Task, review_id: ReviewId },
    TaskCompleted { task: Task },
    TaskCancelled { task: Task },
    TaskDeleted { task_id: AnyTaskId },
    TaskStatusChanged { task: Task, from: TaskStatus, to: TaskStatus },
    
    // Reviews
    ReviewCreated { review: Review },
    CommentAdded { comment: ReviewComment },
    CommentResolved { comment: ReviewComment },
    ChangesRequested { review: Review, comments: Vec<ReviewComment> },
    ReviewApproved { review: Review },
    
    // Gates
    GateAdded { gate: Gate },
    GateUpdated { gate: Gate },
    GateRemoved { gate_id: GateId },
    GateStarted { gate_id: GateId, task_id: AnyTaskId, review_id: ReviewId },
    GatePassed { gate_id: GateId, result: GateResult },
    GateFailed { gate_id: GateId, result: GateResult },
    GateEscalated { gate_id: GateId, result: GateResult },
    
    // Help
    HelpRequested { help_request: HelpRequest },
    HelpResponded { help_request: HelpRequest },
    HelpResumed { task: Task, help_request: HelpRequest },
    
    // VCS
    RefCreated { task_id: AnyTaskId, ref_name: String },
    Committed { task_id: AnyTaskId, rev: String },
    TaskArchived { task_id: AnyTaskId },
    
    // Harnesses
    HarnessConnected { harness_id: String },
    HarnessDisconnected { harness_id: String },
    SessionStarted { session_id: String, task_id: AnyTaskId, harness_id: String },
    SessionCompleted { session_id: String },
    SessionFailed { session_id: String, error: String },
    
    // Blockers
    BlockerAdded { task_id: AnyTaskId, blocker_id: AnyTaskId },
    BlockerRemoved { task_id: AnyTaskId, blocker_id: AnyTaskId },
    
    // Learnings
    LearningAdded { learning: Learning },
    LearningBubbled { from: AnyTaskId, to: AnyTaskId },
    RepoRegistered { repo: Repo },
    RepoUnregistered { repo_id: RepoId },
}
```

### Persistence + Subscription

Events persisted to SQLite with monotonic sequence number. In-process pub/sub via tokio channels. External consumers tail via SSE or `os events tail --follow`.

---

## MCP Integration (rquickjs)

### Why rquickjs?

- **Single binary** — No Node.js dependency
- **Direct function calls** — No CLI spawn overhead (v1 bottleneck)
- **ES2023-compatible** — Async/await, modern JS
- **Pure Rust** — Cross-compilation

### Codemode Pattern

Agents write JS → rquickjs executes → SDK calls in-process → only results return.

```rust
// os-mcp/src/executor.rs
pub struct JsExecutor {
    context: Context,
    overseer: Arc<Overseer>,
}

// JS API surface mirrors SDK:
// tasks.create(), tasks.list(), reviews.comment(), gates.results(), etc.
```

---

## Relay Server (Agent Harness Broker)

WebSocket server in `os serve` for brokering between:
- **Harness providers** (OpenCode, Claude Code, etc.) — register capabilities
- **UI clients** — dispatch tasks, view progress
- **Review feedback** — bidirectional comment delivery

Protocol TBD in `docs/specs/05-relay.md`.

---

## OpenAPI Strategy

REST API annotated with `utoipa` → generates OpenAPI 3.1 spec → `openapi-typescript` generates TS client → webapp imports.

```
Rust (utoipa) → openapi/overseer.yaml → openapi-typescript → webapp/src/api/
```

Swagger UI available at `/api/docs` in serve mode.

---

## Build & Distribution

> **Full detail:** `docs/specs/00-monorepo.md`

### Tooling

- **Cargo workspace** — 7 crates
- **Justfile** — Build orchestration
- **pnpm** — Webapp only
- **rust-embed** — Webapp baked into release binary

### Distribution

- **npm** (primary) — Platform-specific binaries, `npx overseer`
- **GitHub Releases** — tar.gz per platform
- **cargo-binstall** compatible

### CI/CD

- GitHub Actions: format, clippy, test, build on PR
- OpenAPI drift detection (CI verifies spec matches code)
- Release on tag: cross-compile → GitHub Release → npm publish

---

## Implementation Phases

> These are greenfield build phases, not migration steps.

### Phase 1: Scaffold (S)
- Workspace setup, Cargo.toml, justfile, CI
- os-core type stubs, os-db schema, os binary shell
- `just build && just test` works

### Phase 2: Core Domain (L)
- Implement types, task CRUD, hierarchy, blockers, cycle detection
- SQLite persistence, ID generation
- CLI: `os task create/list/get/update/delete`

### Phase 3: VCS Integration (L)
- os-vcs crate: jj-lib + gix backends, detection
- TaskVcs lifecycle: start/submit/archive
- Stacked diff computation

### Phase 4: Review Pipeline (L)
- Reviews, ReviewComments, three-phase state machine
- Gates: execution engine, polling, retry, escalation
- HelpRequests: request/respond/resume

### Phase 5: Server + Events (L)
- os-events: bus + SQLite persistence
- os-serve: axum REST API with utoipa, SSE
- OpenAPI spec generation + TS client codegen
- Embedded webapp (rust-embed)

### Phase 6: MCP + rquickjs (M)
- os-mcp: rquickjs executor, JS API bindings
- `os mcp` mode for stdio transport
- Codemode pattern (agents write JS)

### Phase 7: Relay + Harnesses (XL)
- WebSocket harness broker in os-serve
- Harness protocol definition
- Agent session management
- Review → agent feedback loop

### Phase 8: Webapp MVP (L)
- React + TanStack Query + generated OpenAPI client
- Task list/detail, review UI, gate status
- Embedded in binary via rust-embed

---

## Unresolved Questions

1. **Cancelled task refs**: Preserve until `os gc`, or auto-cleanup?
2. **Event retention**: TTL or keep forever?
3. **Harness auth**: How do harnesses authenticate with relay?
4. **Diff storage**: Compute from VCS on demand, or cache?
5. **Serve mode port**: Fixed (e.g., 4820) or dynamic with discovery?
6. **CLI → server routing**: Auto-detect running server, or explicit flag?
7. **Worktree strategy**: Separate worktrees per task, or shared working copy?

---

## Spec Index

| # | Spec | Status | Summary |
|---|------|--------|---------|
| 00 | `00-monorepo.md` | Draft v1 | Repo structure, crates, build, CI/CD, release |
| 01 | `01-core-domain.md` | Draft v4 | **Source of truth** — domain types, traits, invariants |
| 02 | `02-vcs.md` | Draft v1 | VCS backends, jj-lib + gix, stacking semantics |
| 03 | `03-review.md` | Draft v1 | Review workflow, comments, three-phase pipeline |
| 03a | `03a-gates.md` | Draft v1 | Gate execution model, async polling, retry |
| 04 | `04-events.md` | Draft v1 | Event bus, persistence, subscriptions |
| 05 | `05-relay.md` | Draft v1 | Agent harness broker, WebSocket protocol |
| 06 | `06-git-ai.md` | Draft v1 | git-ai integration |
| 07 | `07-agent-primitives.md` | Draft v1 | Skills, commands, subagents for harnesses |
| 08 | `08-web-ui.md` | Draft v1 | Web UI local-first design and data layer |
| 09 | `09-mcp-rquickjs.md` | Draft v1 | MCP server + rquickjs execution |
| 10 | `10-system-integration.md` | Draft v1 | Cross-component integration, errors, tracing |
| 11 | `11-end-to-end-audit.md` | Draft v1 | Endpoint/entrypoint audit map |
| 12 | `12-feedback-loops.md` | Draft v1 | Agent feedback loop design + research |
| 13 | `13-implementation-guide.md` | Draft v1 | Build instructions for coding agents |
    GitAiStarted { task_id: AnyTaskId, review_id: ReviewId },
    GitAiCompleted { task_id: AnyTaskId, review_id: ReviewId },
    GitAiFailed { task_id: AnyTaskId, review_id: ReviewId, error: String },
