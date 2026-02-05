# Core Domain Model

**Status:** Draft v4  
**Date:** 2026-02-05  
**Depends on:** 00-monorepo (crate boundaries)  
**Blocks:** 02-vcs, 03-review, 03a-gates, 04-events, 05-relay

## Overview

This spec defines Overseer's core domain types, trait interfaces, and invariants. All other subsystems depend on these definitions.

**Design principles:**
- Types encode business rules. If a state is invalid, make it unrepresentable.
- Humans can always override workflow states (invariants permitting).
- jj-first: All VCS references use stable identifiers that survive rewrites.
- Simplify aggressively. Add complexity when users hit real walls.

---

## Core Types

### Entity IDs

All entity IDs use ULID with typed prefixes for debuggability. Different entity types use distinct prefixes for **visual clarity in output**.

```rust
/// Branded ID type with prefix validation.
/// Format: `{prefix}_{ulid}` where ulid is 26 chars.
/// 
/// # Prefixes by Entity Type
/// - `ms_` - Milestone (root task container)
/// - `task_` - Task (child of milestone) or Standalone
/// - `sub_` - Subtask (child of task)
/// - `lrn_` - Learning
/// - `rev_` - Review
/// - `cmt_` - Review comment
/// - `repo_` - Repository
/// - `gate_` - Quality gate
/// - `help_` - Help request
/// 
/// # Why Distinct Prefixes?
/// - Instantly identify entity type in logs, CLI output, debugging
/// - Prevent accidental cross-type references at API boundaries
/// - "ms_01HX..." vs "task_01HX..." immediately tells you context
pub struct Id<T> {
    inner: String,
    _marker: PhantomData<T>,
}

pub type MilestoneId = Id<Milestone>;
pub type TaskId = Id<Task>;
pub type SubtaskId = Id<Subtask>;
pub type LearningId = Id<Learning>;
pub type ReviewId = Id<Review>;
pub type CommentId = Id<Comment>;
pub type RepoId = Id<Repo>;
pub type GateId = Id<Gate>;
pub type HelpRequestId = Id<HelpRequest>;

/// Union type for any task-like entity ID.
/// Used in APIs that operate on any level of hierarchy.
pub enum AnyTaskId {
    Milestone(MilestoneId),
    Task(TaskId),
    Subtask(SubtaskId),
}
```

**Invariants:**
- IDs are immutable after creation
- Prefix must match entity type
- ULID portion provides natural time-ordering
- `AnyTaskId` enables polymorphic task operations

---

### Priority

```rust
/// Task priority levels.
/// 
/// # Semantics
/// - `Urgent` (0): Drop everything, do this now
/// - `High` (1): Important, do soon
/// - `Normal` (2): Default priority
/// - `Low` (3): Nice to have, backlog
/// 
/// Lower numeric value = higher priority.
/// Serializes as integer for compact storage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Priority {
    Urgent = 0,
    High = 1,
    Normal = 2,
    Low = 3,
}
```

---

### TaskKind

```rust
/// Distinguishes task types in the hierarchy.
/// 
/// # Hierarchy Rules
/// - Milestone: Top-level container, can have Tasks as children
/// - Task: Child of Milestone OR standalone (no parent), can have Subtasks
/// - Subtask: Child of Task, cannot have children
/// 
/// # Why Explicit Kinds?
/// - Clear semantics in UI/CLI output
/// - Distinct ID prefixes for debugging
/// - Enforcement of hierarchy rules at type level
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskKind {
    /// Root container for related work. Prefix: `ms_`
    /// Always depth 0, always has no parent.
    Milestone,
    
    /// Unit of work. Prefix: `task_`
    /// - Under a Milestone: depth 1
    /// - Standalone (no parent): depth 0, one-off work
    Task,
    
    /// Sub-unit under a task. Prefix: `sub_`
    /// Always depth 2, cannot have children.
    Subtask,
}
```

**Hierarchy matrix:**
| Kind | Parent | Can have children | Depth |
|------|--------|-------------------|-------|
| Milestone | None | Tasks only | 0 |
| Task (under milestone) | Milestone | Subtasks only | 1 |
| Task (standalone) | None | Subtasks only | 0 |
| Subtask | Task | None | 1 or 2 |

**Invariants:**
- Milestone: `parent_id` must be None
- Subtask: Cannot have children
- Max computed depth: 2 (Milestone -> Task -> Subtask)

---

### TaskStatus

```rust
/// Task lifecycle states.
/// 
/// # State Machine
/// ```text
///                     +-------------+
///                     |   Pending   |
///                     +------+------+
///                            | start()
///                            v
///                    +-------------+
///          +---------|  InProgress |<------------+
///          |         +------+------+             |
///          |                | submit()           |
///          |                v                    |
///          |         +-------------+             |
///          |         |  InReview   |-------------+
///          |         +------+------+             |
///          |                | approve()          | reject()
///          |                v                    |
///          |         +-------------+             |
///          |         |  Completed  |             |
///          |         +-------------+             |
///          |                                     |
///          |         +---------------+           |
///          +-------->| AwaitingHuman |<----------+
///          |         +-------+-------+           |
///          |                 | resume()          |
///          |                 +-------------------+
///          |                 (returns to previous)
///          |
///          +-- cancel() -------------------------+
///                    +-------------+             |
///                    |  Cancelled  |<------------+
///                    +-------------+
/// ```
/// 
/// # Human Override
/// Humans can set any status via `set_status()` as long as invariants hold.
/// Agents CANNOT skip review phases; humans CAN via `force_complete()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    /// Task created but not started. No VCS artifacts.
    Pending,
    /// Work in progress. VCS bookmark/branch exists.
    InProgress,
    /// Submitted for review. Review entity tracks phase.
    InReview,
    /// Agent needs human guidance. HelpRequest entity tracks details.
    /// Can transition here from any active state (Pending, InProgress, InReview).
    AwaitingHuman,
    /// Work accepted. Review passed or human force-completed.
    Completed,
    /// Task abandoned. VCS artifacts preserved until archive.
    Cancelled,
}
```

**Transitions:**
| From | To | Trigger | Who | Side Effects |
|------|-----|---------|-----|--------------|
| Pending | InProgress | `start()` | Any | Create VCS ref, record start |
| InProgress | InReview | `submit()` | Any | Commit changes, run gates, create Review |
| InReview | InProgress | `reject()` / `request_changes()` | Any | Update Review status |
| InReview | Completed | `approve()` | Review | Requires gates + agent + human phases |
| InReview | Completed | `force_complete()` | Human only | Skip remaining review |
| Pending/InProgress/InReview | AwaitingHuman | `request_help()` | Agent | Create HelpRequest, preserve from_status |
| AwaitingHuman | (from_status) | `resume()` | Human | Requires HelpRequest.status = Responded |
| Any (except Completed) | Cancelled | `cancel()` | Any | Preserve VCS refs |
| Any | Any | `set_status()` | Human only | Must satisfy invariants |

---

### Task

```rust
/// A unit of work in the hierarchy.
/// 
/// # Polymorphism
/// Tasks are polymorphic across kinds (Milestone, Task, Subtask).
/// The `kind` field determines hierarchy rules; other fields are shared.
/// 
/// # Repo Scope
/// Tasks are scoped to a single repo. No cross-repo operations.
pub struct Task {
    /// Primary key. Prefix indicates kind.
    pub id: AnyTaskId,
    pub repo_id: RepoId,
    pub parent_id: Option<AnyTaskId>,
    pub kind: TaskKind,
    pub description: String,
    /// Free-form context (markdown). Inherited by children.
    pub context: Option<String>,
    pub priority: Priority,
    pub status: TaskStatus,
    /// Tasks that must complete before this can start.
    pub blocked_by: Vec<AnyTaskId>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}
```

**Computed properties:**
- `depth: u8` - computed from parent chain (0, 1, or 2)
- `effectively_blocked: bool` - true if any blocker incomplete OR any ancestor blocked
- `blocks: Vec<AnyTaskId>` - inverse of `blocked_by`, computed from graph

**Invariants:**
- `parent_id` must reference existing task in same repo
- Hierarchy rules per `TaskKind` enforced
- `blocked_by` cannot contain self
- `blocked_by` cannot create cycles (DFS validation)
- `started_at` set when status first reaches InProgress
- `completed_at` set when status reaches Completed

---

### TaskVcs

```rust
/// VCS artifacts associated with a task.
/// 
/// Separated from Task to keep domain model VCS-agnostic and allow
/// VCS-free operation (planning mode).
/// 
/// # jj-first Design
/// Uses ChangeId (stable) for persistent references, not CommitId.
/// ChangeId survives rewrites (amend, rebase, squash).
/// 
/// # Git Compatibility
/// For git, `change_id` stores branch name (stable ref).
/// 
/// # Stack-Preserving Semantics
/// Refs are preserved on complete. Use `archive` command for cleanup.
pub struct TaskVcs {
    pub task_id: AnyTaskId,
    pub repo_id: RepoId,
    pub vcs_type: VcsType,
    /// Bookmark (jj) or branch (git) name.
    pub ref_name: String,
    /// jj: ChangeId (stable across rewrites)
    /// git: Branch name (same as ref_name)
    pub change_id: String,
    /// Diff base. Parent's head_commit or main.
    pub base_commit: String,
    /// Latest committed revision. Set on submit.
    pub head_commit: Option<String>,
    /// CommitId/SHA when task was started.
    pub start_commit: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Set when task archived (refs deleted).
    pub archived_at: Option<DateTime<Utc>>,
}
```

**Archive behavior:**
- `os task archive <id>` - deletes VCS refs, sets `archived_at`
- `os gc --older-than 30d` - archives completed tasks older than threshold
- Archived tasks excluded from default queries
- Task record kept for history; only VCS refs cleaned up

**Invariants:**
- One TaskVcs per started Task (created on start)
- `ref_name` unique within repo
- `archived_at` implies refs deleted from VCS

---

### Learning

```rust
/// Knowledge captured during task execution.
/// 
/// # Bubbling
/// On task completion, learnings bubble to immediate parent.
/// `source_task_id` preserves origin for attribution.
/// 
/// # Deduplication
/// Handled at query time, not write time.
/// Consumer (agent prompt, UI) can filter duplicates if needed.
pub struct Learning {
    pub id: LearningId,
    pub task_id: AnyTaskId,
    pub content: String,
    /// Original task that created this learning (for bubbled learnings).
    /// None for direct learnings, Some for bubbled copies.
    pub source_task_id: Option<AnyTaskId>,
    pub created_at: DateTime<Utc>,
}
```

**Invariants:**
- `task_id` must reference existing task
- `source_task_id` is None for direct, Some for bubbled
- Bubbling creates new Learning with new ID (copy, not move)

---

### Gate

```rust
/// A quality gate that must pass before review phases proceed.
/// 
/// # Execution Model
/// Gates are shell commands that return Unix exit codes:
/// - 0: Pass
/// - 75 (EX_TEMPFAIL): Pending (async, poll again)
/// - Any other: Fail
/// 
/// # Inheritance (Downward)
/// Gates flow DOWN the hierarchy: Repo -> Milestone -> Task -> Subtask.
/// A task inherits all gates from its ancestors. Gates accumulate; 
/// children CANNOT disable inherited gates.
/// 
/// # Trigger Points
/// Gates run before EACH review phase transition:
/// - submit() -> gates -> agent review
/// - agent requests changes -> agent implements -> gates -> agent re-review
/// - human requests changes -> agent implements -> gates -> human re-review
/// 
/// See 03a-gates.md for full workflow specification.
pub struct Gate {
    pub id: GateId,
    /// Scope: Repo-level OR task-level (milestone/task/subtask)
    pub scope: GateScope,
    /// Human-readable name (e.g., "typecheck", "lint", "unit-tests").
    /// Must be unique within scope.
    pub name: String,
    /// Shell command to execute. Runs in repo root.
    pub command: String,
    /// Max execution time before timeout failure.
    /// Default: 300 seconds (5 min)
    pub timeout_secs: u32,
    /// Max retry attempts before escalating to human.
    /// Default: 3
    pub max_retries: u32,
    /// Polling interval for async gates (exit 75).
    /// Default: 30 seconds
    pub poll_interval_secs: u32,
    /// Max total wait time for async gates before timeout.
    /// Default: 86400 seconds (24 hours). Configurable.
    pub max_pending_secs: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Where a gate is attached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateScope {
    /// Applies to all tasks in repository.
    Repo(RepoId),
    /// Applies to specific task and its descendants.
    Task(AnyTaskId),
}

/// Result of a single gate execution attempt.
pub struct GateResult {
    pub gate_id: GateId,
    pub task_id: AnyTaskId,
    pub review_id: ReviewId,
    pub status: GateStatus,
    /// Captured stdout (truncated to 64KB).
    pub stdout: String,
    /// Captured stderr (truncated to 64KB).
    pub stderr: String,
    /// Exit code from command. None if killed/timeout.
    pub exit_code: Option<i32>,
    /// Retry attempt number (1-indexed).
    pub attempt: u32,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateStatus {
    /// Gate execution in progress.
    Running,
    /// Exit code 75 - waiting for external condition.
    Pending,
    /// Exit code 0.
    Passed,
    /// Non-zero exit (except 75).
    Failed,
    /// Exceeded timeout_secs or max_pending_secs.
    Timeout,
    /// Exceeded max_retries, escalated to human.
    Escalated,
}
```

**Gate environment variables:**
```
OVERSEER_TASK_ID      - Current task ID (e.g., "task_01HX...")
OVERSEER_REPO_ID      - Repository ID
OVERSEER_REPO_PATH    - Absolute path to repository root
OVERSEER_REVIEW_ID    - Current review ID
OVERSEER_GATE_NAME    - This gate's name
OVERSEER_ATTEMPT      - Current retry attempt (1-indexed)
```

**Invariants:**
- Gate `name` unique within scope (repo or task)
- `timeout_secs` > 0
- `max_retries` >= 1
- `poll_interval_secs` > 0
- Gates cannot be modified while review is active (only add/remove between reviews)

---

### HelpRequest

```rust
/// A request from agent to human for guidance.
/// 
/// # Lifecycle
/// 1. Agent calls `request_help(reason, options)` -> task becomes AwaitingHuman
/// 2. Human sees request in UI/relay
/// 3. Human provides response via `respond(help_id, response)`
/// 4. Human calls `resume(task_id)` -> task returns to from_status
/// 
/// # History
/// Multiple HelpRequests can exist per task. Old requests preserved.
/// Only one can be active (status=Pending) at a time.
pub struct HelpRequest {
    pub id: HelpRequestId,
    pub task_id: AnyTaskId,
    /// Status task was in when help was requested.
    /// Task returns here on resume.
    pub from_status: TaskStatus,
    /// Category of help needed.
    pub category: HelpCategory,
    /// Free-form explanation of what agent is stuck on.
    pub reason: String,
    /// Suggested options/paths forward (agent's best guesses).
    /// Human can pick one, modify, or provide different answer.
    pub suggested_options: Vec<String>,
    pub status: HelpRequestStatus,
    /// Human's response (set when resolved).
    pub response: Option<String>,
    /// Which suggested option human chose (index), if any.
    pub chosen_option: Option<usize>,
    pub created_at: DateTime<Utc>,
    pub responded_at: Option<DateTime<Utc>>,
    pub resumed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelpCategory {
    /// Need clarification on requirements/scope.
    Clarification,
    /// Need human to make a decision between options.
    Decision,
    /// Technical blocker agent can't resolve.
    TechnicalBlocker,
    /// Something unexpected, not sure how to proceed.
    Unexpected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelpRequestStatus {
    /// Awaiting human response.
    Pending,
    /// Human responded but task not yet resumed.
    Responded,
    /// Task resumed, request closed.
    Resolved,
    /// Request cancelled (task cancelled or superseded).
    Cancelled,
}
```

**Invariants:**
- Only one Pending HelpRequest per task at a time
- `from_status` must be Pending, InProgress, or InReview (active states)
- `from_status` cannot be AwaitingHuman, Completed, or Cancelled
- `chosen_option` must be valid index into `suggested_options` if provided
- `resume()` only valid when HelpRequest status is Responded
- Task status must be AwaitingHuman to call `resume()`

---

### Review

```rust
/// A review session for a task's changes.
/// 
/// # Three-Phase Review Pipeline
/// 1. Gates: Automated quality checks (see 03a-gates.md)
/// 2. Agent review: Automated code review
/// 3. Human review: Manual approval
/// 
/// All phases must pass for task to complete, unless human force-completes.
/// 
/// # History
/// Multiple Reviews possible per task (one per submit cycle).
/// Old reviews preserved for audit trail.
pub struct Review {
    pub id: ReviewId,
    pub task_id: AnyTaskId,
    pub status: ReviewStatus,
    pub submitted_at: DateTime<Utc>,
    pub gates_completed_at: Option<DateTime<Utc>>,
    pub agent_completed_at: Option<DateTime<Utc>>,
    pub human_completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Review progress through phases.
/// 
/// # State Machine
/// ```text
/// GatesPending -> AgentPending -> HumanPending -> Approved -> (task completes)
///      |              |              |
///      +--------------+--------------+---> ChangesRequested -> (task to InProgress)
///      |
///      +---> GatesEscalated (human intervention required)
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewStatus {
    /// Gates running or pending retry.
    GatesPending,
    /// Gates exceeded max_retries, needs human help.
    GatesEscalated,
    /// Gates passed, agent review in progress.
    AgentPending,
    /// Agent approved, awaiting human.
    HumanPending,
    /// All phases passed.
    Approved,
    /// Changes requested (by any phase). Task returns to InProgress.
    ChangesRequested,
}
```

**Transitions:**
| From | To | Trigger |
|------|-----|---------|
| GatesPending | AgentPending | All gates pass |
| GatesPending | GatesPending | Gate fails, retries remaining |
| GatesPending | GatesEscalated | Gate exceeds max_retries |
| GatesPending | ChangesRequested | Agent fixes, resubmits (creates new Review) |
| GatesEscalated | AgentPending | Human resolves gate issue |
| AgentPending | HumanPending | Agent approves |
| AgentPending | ChangesRequested | Agent requests changes |
| HumanPending | Approved | Human approves |
| HumanPending | ChangesRequested | Human requests changes |

**Invariants:**
- One active Review per task in InReview status
- `gates_completed_at` set when gate phase ends (pass or escalate)
- `agent_completed_at` set when agent phase ends
- `human_completed_at` set when human phase ends
- ChangesRequested is terminal for this Review; new Review on resubmit

---

### ReviewComment

```rust
/// A comment on a specific location in the diff.
/// 
/// # PR-style Semantics
/// Comments target file/line ranges in the diff.
/// Batching (add to review vs send now) is a CLIENT concern,
/// not tracked in domain model.
/// 
/// # Agent Feedback
/// Comments can be sent to active agent session via Relay.
/// The Relay/UI layer handles delivery timing.
pub struct ReviewComment {
    pub id: CommentId,
    pub review_id: ReviewId,
    pub task_id: AnyTaskId,
    pub author: CommentAuthor,
    pub file_path: String,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub side: DiffSide,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommentAuthor {
    /// Automated agent review.
    Agent,
    /// Human reviewer.
    Human,
}

/// Which side of the diff this comment targets.
/// Compatible with both git and jj unified diff output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffSide {
    /// Old/left side (removed/modified lines).
    Left,
    /// New/right side (added/modified lines).
    Right,
}
```

**Note:** Batching (draft comments, send now vs submit review) is handled by UI/client layer, not domain.

---

### Repo

```rust
/// A registered repository for task management.
/// 
/// # Multi-Repo Support
/// Overseer can manage tasks across multiple repositories.
/// Each task belongs to exactly one repo.
/// 
/// # No Active State
/// There is no "active repo" in domain model.
/// CLI uses $PWD or --repo flag for context.
/// UI uses route/tab state.
/// Multiple agents can work different repos simultaneously.
pub struct Repo {
    pub id: RepoId,
    pub path: PathBuf,
    /// Derived from path (directory name).
    pub name: String,
    pub vcs_type: VcsType,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VcsType {
    /// Jujutsu - preferred, native via jj-lib.
    Jj,
    /// Git - fallback, native via gix.
    Git,
}
```

**Context resolution (client layer):**
- CLI: `$PWD` -> find repo by path, or `--repo <id>`
- UI: Route param or tab state
- MCP: Explicit `repo_id` in requests

---

## Trait Interfaces

### TaskRepository

```rust
/// Persistence interface for tasks.
pub trait TaskRepository {
    fn create(&self, input: CreateTaskInput) -> Result<Task, TaskError>;
    fn get(&self, id: &AnyTaskId) -> Result<Option<Task>, TaskError>;
    fn get_with_context(&self, id: &AnyTaskId) -> Result<Option<TaskWithContext>, TaskError>;
    fn list(&self, filter: TaskFilter) -> Result<Vec<Task>, TaskError>;
    fn update(&self, id: &AnyTaskId, input: UpdateTaskInput) -> Result<Task, TaskError>;
    fn delete(&self, id: &AnyTaskId) -> Result<(), TaskError>;
    fn tree(&self, root_id: Option<&AnyTaskId>) -> Result<TaskTree, TaskError>;
    fn next_ready(&self, repo_id: &RepoId, scope: Option<&MilestoneId>) -> Result<Option<Task>, TaskError>;
    fn add_blocker(&self, task_id: &AnyTaskId, blocker_id: &AnyTaskId) -> Result<(), TaskError>;
    fn remove_blocker(&self, task_id: &AnyTaskId, blocker_id: &AnyTaskId) -> Result<(), TaskError>;
    fn progress(&self, repo_id: &RepoId, scope: Option<&AnyTaskId>) -> Result<TaskProgress, TaskError>;
}
```

### ReviewRepository

```rust
/// Persistence interface for reviews and comments.
pub trait ReviewRepository {
    fn create(&self, task_id: &AnyTaskId) -> Result<Review, ReviewError>;
    fn get(&self, id: &ReviewId) -> Result<Option<Review>, ReviewError>;
    fn get_active_for_task(&self, task_id: &AnyTaskId) -> Result<Option<Review>, ReviewError>;
    fn list_for_task(&self, task_id: &AnyTaskId) -> Result<Vec<Review>, ReviewError>;
    fn update_status(&self, id: &ReviewId, status: ReviewStatus) -> Result<Review, ReviewError>;
    fn add_comment(&self, input: CreateCommentInput) -> Result<ReviewComment, ReviewError>;
    fn list_comments(&self, review_id: &ReviewId) -> Result<Vec<ReviewComment>, ReviewError>;
    fn resolve_comment(&self, id: &CommentId) -> Result<ReviewComment, ReviewError>;
}
```

### LearningRepository

```rust
/// Persistence interface for learnings.
pub trait LearningRepository {
    fn add(&self, task_id: &AnyTaskId, content: String) -> Result<Learning, LearningError>;
    fn list(&self, task_id: &AnyTaskId) -> Result<Vec<Learning>, LearningError>;
    /// Returns learnings from task + ancestors, ordered by proximity.
    fn get_inherited(&self, task_id: &AnyTaskId) -> Result<InheritedLearnings, LearningError>;
    /// Copy learnings from child to parent (with source_task_id set).
    fn bubble(&self, from: &AnyTaskId, to: &AnyTaskId) -> Result<Vec<Learning>, LearningError>;
}
```

### GateRepository

```rust
/// Persistence interface for gates.
/// See 03a-gates.md for execution logic.
pub trait GateRepository {
    /// Register a gate at repo or task scope.
    fn add(&self, input: CreateGateInput) -> Result<Gate, GateError>;
    
    /// Get all gates applicable to a task (inherited + own).
    /// Returns gates in scope order: repo first, then ancestor tasks, then own.
    fn get_effective(&self, task_id: &AnyTaskId) -> Result<Vec<Gate>, GateError>;
    
    /// List gates at a specific scope only (not inherited).
    fn list(&self, scope: &GateScope) -> Result<Vec<Gate>, GateError>;
    
    /// Remove a gate. Fails if review is active for any task in scope.
    fn remove(&self, id: &GateId) -> Result<(), GateError>;
    
    /// Update gate configuration. Fails if review is active.
    fn update(&self, id: &GateId, input: UpdateGateInput) -> Result<Gate, GateError>;
    
    /// Record gate execution result.
    fn record_result(&self, result: GateResult) -> Result<(), GateError>;
    
    /// Get results for a review's gate run.
    fn get_results(&self, review_id: &ReviewId) -> Result<Vec<GateResult>, GateError>;
}
```

### HelpRepository

```rust
/// Persistence interface for help requests.
pub trait HelpRepository {
    /// Create help request, transition task to AwaitingHuman.
    fn request(&self, input: CreateHelpRequestInput) -> Result<HelpRequest, HelpError>;
    
    /// Get active (Pending) help request for task, if any.
    fn get_active(&self, task_id: &AnyTaskId) -> Result<Option<HelpRequest>, HelpError>;
    
    /// Get help request by ID.
    fn get(&self, id: &HelpRequestId) -> Result<Option<HelpRequest>, HelpError>;
    
    /// List all help requests for a task (history).
    fn list(&self, task_id: &AnyTaskId) -> Result<Vec<HelpRequest>, HelpError>;
    
    /// Human provides response to help request.
    fn respond(&self, id: &HelpRequestId, input: HelpResponseInput) -> Result<HelpRequest, HelpError>;
    
    /// Resume task after help provided. Returns task to from_status.
    fn resume(&self, task_id: &AnyTaskId) -> Result<Task, HelpError>;
}
```

### RepoRepository

```rust
/// Persistence interface for repository registration.
pub trait RepoRepository {
    fn register(&self, path: PathBuf) -> Result<Repo, RepoError>;
    fn get(&self, id: &RepoId) -> Result<Option<Repo>, RepoError>;
    fn get_by_path(&self, path: &Path) -> Result<Option<Repo>, RepoError>;
    fn list(&self) -> Result<Vec<Repo>, RepoError>;
    fn unregister(&self, id: &RepoId) -> Result<(), RepoError>;
}
```

---

## Input/Output Types

### CreateTaskInput

```rust
pub struct CreateTaskInput {
    pub repo_id: RepoId,
    pub parent_id: Option<AnyTaskId>,
    pub kind: TaskKind,
    pub description: String,
    pub context: Option<String>,
    pub priority: Option<Priority>,  // Default: Normal
    pub blocked_by: Vec<AnyTaskId>,
}
```

### UpdateTaskInput

```rust
pub struct UpdateTaskInput {
    pub description: Option<String>,
    pub context: Option<String>,
    pub priority: Option<Priority>,
}
```

### TaskFilter

```rust
pub struct TaskFilter {
    pub repo_id: Option<RepoId>,
    pub parent_id: Option<Option<AnyTaskId>>,  // None=any, Some(None)=roots
    pub kind: Option<Vec<TaskKind>>,
    pub status: Option<Vec<TaskStatus>>,
    pub ready: Option<bool>,
    pub archived: Option<bool>,  // Default: false (exclude archived)
}
```

### TaskWithContext

```rust
pub struct TaskWithContext {
    pub task: Task,
    pub context: TaskContext,
    pub learnings: InheritedLearnings,
    pub gates: Vec<Gate>,               // Effective gates (inherited + own)
    pub vcs: Option<TaskVcs>,
    pub review: Option<Review>,
    pub help_request: Option<HelpRequest>,  // Active help request, if any
}

pub struct TaskContext {
    pub own: Option<String>,
    pub parent: Option<String>,
    pub milestone: Option<String>,
}

pub struct InheritedLearnings {
    pub own: Vec<Learning>,
    pub parent: Vec<Learning>,
    pub milestone: Vec<Learning>,
}
```

### TaskProgress

```rust
pub struct TaskProgress {
    pub total: u32,
    pub completed: u32,
    pub ready: u32,
    pub blocked: u32,
    pub in_progress: u32,
    pub in_review: u32,
    pub awaiting_human: u32,
}
```

### CreateGateInput

```rust
pub struct CreateGateInput {
    pub scope: GateScope,
    pub name: String,
    pub command: String,
    pub timeout_secs: Option<u32>,       // Default: 300
    pub max_retries: Option<u32>,        // Default: 3
    pub poll_interval_secs: Option<u32>, // Default: 30
    pub max_pending_secs: Option<u32>,   // Default: 86400
}
```

### UpdateGateInput

```rust
pub struct UpdateGateInput {
    pub command: Option<String>,
    pub timeout_secs: Option<u32>,
    pub max_retries: Option<u32>,
    pub poll_interval_secs: Option<u32>,
    pub max_pending_secs: Option<u32>,
}
```

### CreateHelpRequestInput

```rust
pub struct CreateHelpRequestInput {
    pub task_id: AnyTaskId,
    pub category: HelpCategory,
    pub reason: String,
    pub suggested_options: Vec<String>,  // Can be empty
}
```

### HelpResponseInput

```rust
pub struct HelpResponseInput {
    pub response: String,
    /// Index into suggested_options, if human chose one.
    pub chosen_option: Option<usize>,
}
```

---

## Algorithms

### Cycle Detection (Blocker Graph)

```
function would_create_cycle(task_id, blocker_id, graph) -> Result<()>:
    if task_id == blocker_id:
        return Err(SelfBlock)
    
    // DFS from blocker_id checking if task_id is reachable
    visited = Set()
    stack = [blocker_id]
    
    while stack not empty:
        current = stack.pop()
        if current in visited: continue
        visited.add(current)
        
        for blocked in graph.tasks_blocked_by(current):
            if blocked == task_id:
                return Err(CycleDetected)
            stack.push(blocked)
    
    return Ok(())
```

### Effective Blocking (Computed)

```
function is_effectively_blocked(task_id, repo) -> bool:
    current = task_id
    while current is not None:
        task = repo.get(current)
        for blocker_id in task.blocked_by:
            if repo.get(blocker_id).status != Completed:
                return true
        current = task.parent_id
    return false
```

### Gate Inheritance (Downward)

```
function get_effective_gates(task_id, repo, gate_repo) -> Vec<Gate>:
    result = []
    
    // 1. Repo-level gates first
    task = repo.get(task_id)
    result.extend(gate_repo.list(GateScope::Repo(task.repo_id)))
    
    // 2. Walk up hierarchy, collect task-level gates
    ancestor_gates = []
    current = task_id
    while current is not None:
        gates = gate_repo.list(GateScope::Task(current))
        ancestor_gates.push((current, gates))
        current = repo.get(current).parent_id
    
    // 3. Add in order: root ancestor first, then down to task
    for (_, gates) in ancestor_gates.reversed():
        result.extend(gates)
    
    return result
```

---

## Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("task not found: {0}")]
    NotFound(String),
    
    #[error("parent not found: {0}")]
    ParentNotFound(String),
    
    #[error("invalid hierarchy: {kind:?} cannot be child of {parent_kind:?}")]
    InvalidHierarchy { kind: TaskKind, parent_kind: TaskKind },
    
    #[error("cycle detected adding {blocker_id} as blocker of {task_id}")]
    CycleDetected { task_id: String, blocker_id: String },
    
    #[error("task cannot block itself")]
    SelfBlock,
    
    #[error("invalid transition: {from:?} -> {to:?}")]
    InvalidTransition { from: TaskStatus, to: TaskStatus },
    
    #[error("task blocked by: {blockers:?}")]
    Blocked { blockers: Vec<String> },
    
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum GateError {
    #[error("gate not found: {0}")]
    NotFound(String),
    
    #[error("duplicate gate name in scope: {name}")]
    DuplicateName { name: String },
    
    #[error("invalid command: {reason}")]
    InvalidCommand { reason: String },
    
    #[error("cannot modify gate while review is active")]
    ReviewActive,
    
    #[error("invalid timeout: must be > 0")]
    InvalidTimeout,
    
    #[error("invalid max_retries: must be >= 1")]
    InvalidMaxRetries,
    
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum HelpError {
    #[error("task not found: {0}")]
    TaskNotFound(String),
    
    #[error("help request not found: {0}")]
    NotFound(String),
    
    #[error("task already has pending help request")]
    AlreadyPending,
    
    #[error("cannot request help from status: {0:?}")]
    InvalidFromStatus(TaskStatus),
    
    #[error("help request not in Pending status")]
    NotPending,
    
    #[error("help request not responded yet")]
    NotResponded,
    
    #[error("chosen_option index {index} out of bounds (max {max})")]
    InvalidOptionIndex { index: usize, max: usize },
    
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
}
```

---

## Agent Guardrails

Agents implementing Overseer tasks **MUST NOT**:

| # | Guardrail | Rationale |
|---|-----------|-----------|
| 1 | **Skip gates** | Never bypass gate checks. If gates fail, fix the code. |
| 2 | **Modify gate definitions** | Gates are set by humans. Agents cannot add/remove/edit gates. |
| 3 | **Retry infinitely** | Respect max_retries. After limit, STOP and escalate. |
| 4 | **Ignore gate output** | stdout/stderr from failed gates is context. Use it to fix issues. |
| 5 | **Proceed on Pending** | Exit 75 means wait. Do not continue to next phase. |
| 6 | **Force-complete** | Only humans can `force_complete()` to skip review phases. |
| 7 | **Commit with failing gates** | Never mark work "done" if gates haven't passed. |
| 8 | **Shell escape** | Do not attempt to manipulate gate commands or environment. |
| 9 | **Abuse help requests** | Use sparingly. Exhaust reasonable options before asking. |
| 10 | **Request help for gate failures** | Gates have their own escalation. Don't double-escalate. |
| 11 | **Continue work while AwaitingHuman** | STOP and wait. Do not proceed until resumed. |
| 12 | **Ignore human response** | When resumed, the response is context. Use it. |
| 13 | **Set arbitrary status** | Use workflow methods (`start`, `submit`, etc). Never `set_status()`. |
| 14 | **Delete tasks** | Only humans delete tasks. Agents complete or request help. |
| 15 | **Modify other agents' work** | Stay in your assigned task scope. |

---

## Configuration

### Gate Configuration File

`.overseer/gates.toml` in repository root:

```toml
# Repo-level gates (apply to all tasks)

[[gate]]
name = "typecheck"
command = "npm run typecheck"
timeout_secs = 300
max_retries = 3

[[gate]]
name = "lint"
command = "npm run lint"
timeout_secs = 120
max_retries = 2

[[gate]]
name = "unit-tests"
command = "npm test"
timeout_secs = 600
max_retries = 1

# Example async gate (deploy approval)
[[gate]]
name = "staging-approval"
command = "./scripts/check-staging-approval.sh"
timeout_secs = 60
max_retries = 1
poll_interval_secs = 300    # Check every 5 min
max_pending_secs = 86400    # Wait up to 24 hours
```

Task-level gates can be defined in task context (YAML):

```yaml
---
gates:
  - name: integration-tests
    command: npm run test:integration
    timeout_secs: 900
---
Task description here...
```

---

## Future Considerations

### git-ai Integration (Separate Spec)

Questions to answer in `06-git-ai.md`:
- How does git-ai map to core domain? (TaskId -> session hash)
- Checkpoint triggers via event system?
- Relay server integration for agent session tracking?
- Line-level attribution in review UI?

### Agent Identity (Defer)

If multiple agents work on tasks, may need:
- `Author = Human | Agent { name, session_id }`
- Mutation attribution
- Coordination/locking

Defer until we hit real multi-agent scenarios.

### Event Log (Defer)

For debugging agent behavior, consider append-only event log.
Could materialize current state from events.
Defer until debugging needs are concrete.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gate command injection | High | Validate commands, run in sandbox, no shell expansion on user input |
| Async gate never completes | Medium | max_pending_secs timeout, human escalation |
| Help request spam | Low | Rate limit per task, require category |
| State machine complexity | Medium | Exhaustive tests for all transitions |

---

## Effort Estimates

| Component | Effort | Notes |
|-----------|--------|-------|
| Gate types + repository | M | New table, straightforward CRUD |
| Gate execution engine | L | Process spawning, polling, retry logic |
| HelpRequest types + repository | M | New table, state machine |
| TaskStatus updates | S | Add AwaitingHuman variant |
| Config file parsing | M | TOML parser, validation |
| CLI commands | M | `os gate add/list/remove`, `os help respond/resume` |

---

**Phase: DRAFT v4 | Status: Ready for 03a-gates.md detailed spec**
