# Event System

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 01-core-domain (IDs, Task, Review), 02-vcs (VCS events)  
**Blocks:** 05-relay

## Overview

This spec defines the event envelope, persistence model, and subscription contracts for SSE/WS consumers.

---

## Event Envelope

```rust
pub struct Event {
    pub id: EventId,
    pub seq: i64,
    pub at: DateTime<Utc>,
    pub correlation_id: Option<String>,
    pub source: EventSource,
    pub body: EventBody,
}

pub enum EventSource { Cli, Mcp, Ui, Relay }
```

Ordering:
- `seq` is strictly monotonic.
- Events are stored append-only.

---

## Persistence

- Stored in SQLite, append-only table.
- `seq` assigned at commit time.
- Replay by `seq > cursor` with limit.

Retention:
- Default: keep forever (subject to future policy).
- TTL policy is TBD and should be explicit if enabled.

---

## Subscription Protocols

### SSE

- Endpoint: `GET /api/events/subscribe?after=<seq>`
- Server sends `event: message` with JSON payload.
- Reconnect uses `Last-Event-ID` or `after` query.

### WS

- Endpoint: `GET /api/events/stream` (WS upgrade)
- Client sends `{ "type": "subscribe", "after": <seq> }`.
- Server streams `{ "type": "event", "event": Event }`.

Backpressure:
- Server may drop connection if client is too slow.
- Client should resume with last seen seq.

---

## Event Types (canonical)

Canonical list (also mirrored in `docs/ARCHITECTURE-V2.md`):

```rust
pub enum EventBody {
    TaskCreated { task: Task },
    TaskUpdated { task: Task },
    TaskStarted { task: Task },
    TaskSubmitted { task: Task, review_id: ReviewId },
    TaskCompleted { task: Task },
    TaskCancelled { task: Task },
    TaskDeleted { task_id: AnyTaskId },
    TaskStatusChanged { task: Task, from: TaskStatus, to: TaskStatus },

    ReviewCreated { review: Review },
    CommentAdded { comment: ReviewComment },
    CommentResolved { comment: ReviewComment },
    ChangesRequested { review: Review, comments: Vec<ReviewComment> },
    ReviewApproved { review: Review },

    GateAdded { gate: Gate },
    GateUpdated { gate: Gate },
    GateRemoved { gate_id: GateId },
    GateStarted { gate_id: GateId, task_id: AnyTaskId, review_id: ReviewId },
    GatePassed { gate_id: GateId, result: GateResult },
    GateFailed { gate_id: GateId, result: GateResult },
    GateEscalated { gate_id: GateId, result: GateResult },

    HelpRequested { help_request: HelpRequest },
    HelpResponded { help_request: HelpRequest },
    HelpResumed { task: Task, help_request: HelpRequest },

    RefCreated { task_id: AnyTaskId, ref_name: String },
    Committed { task_id: AnyTaskId, rev: String },
    TaskArchived { task_id: AnyTaskId },

    HarnessConnected { harness_id: String },
    HarnessDisconnected { harness_id: String },
    SessionStarted { session_id: String, task_id: AnyTaskId, harness_id: String },
    SessionCompleted { session_id: String },
    SessionFailed { session_id: String, error: String },

    BlockerAdded { task_id: AnyTaskId, blocker_id: AnyTaskId },
    BlockerRemoved { task_id: AnyTaskId, blocker_id: AnyTaskId },

    LearningAdded { learning: Learning },
    LearningBubbled { from: AnyTaskId, to: AnyTaskId },

    RepoRegistered { repo: Repo },
    RepoUnregistered { repo_id: RepoId },

    GitAiStarted { task_id: AnyTaskId, review_id: ReviewId },
    GitAiCompleted { task_id: AnyTaskId, review_id: ReviewId },
    GitAiFailed { task_id: AnyTaskId, review_id: ReviewId, error: String },
}
```

---

## REST/OpenAPI Endpoints (Full Catalog)

All endpoints are under `/api`.

### Events
- `GET /events`
- `GET /events/replay`
- `GET /events/subscribe` (SSE)
- `GET /events/stream` (WS)

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

### VCS
- `GET /vcs/task/{id}`
- `GET /vcs/task`
- `POST /vcs/task/{id}/archive`
- `GET /vcs/diff/{id}`

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

- `seq` strictly increases.
- Events are append-only.
- Replay returns events in order.

---

**Phase: DRAFT v1 | Status: Ready for review**
