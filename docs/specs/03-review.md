# Review Workflow and Comments

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 01-core-domain (Review, ReviewComment, TaskStatus), 03a-gates (gate execution)  
**Blocks:** 05-relay

## Overview

This spec defines the three-phase review pipeline, review state machine, comment model, and review-related APIs. It is the contract for agent review and human approval workflows.

---

## Inputs/Outputs

### CreateCommentInput

```rust
pub struct CreateCommentInput {
    pub review_id: ReviewId,
    pub task_id: AnyTaskId,
    pub author: CommentAuthor,
    pub file_path: String,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub side: DiffSide,
    pub body: String,
}
```

### RequestChangesInput

```rust
pub struct RequestChangesInput {
    pub review_id: ReviewId,
    pub comments: Vec<CreateCommentInput>,
    pub summary: Option<String>,
}
```

### Errors

```rust
pub enum ReviewError {
    ReviewNotFound,
    CommentNotFound,
    InvalidTransition { from: ReviewStatus, to: ReviewStatus },
    TaskNotInReview,
    GateNotPassed,
}
```

---

## Review State Machine

```
submit()
  |
  v
GatesPending --[pass]--> AgentPending --[approve]--> HumanPending --[approve]--> Approved
   |                     |                               |
   +--[max retries]--> GatesEscalated                    +--[request changes]--> ChangesRequested
   |                     |
   +--[request changes]--+--[human resolves gate]--> AgentPending
```

Rules:
- `ChangesRequested` is terminal for this Review.
- A new submit creates a new Review.
- Only one active Review per task at a time.

---

## Algorithms

### Submit

```
function submit(task_id):
  ensure task.status == InProgress
  commit changes (see 02-vcs)
  review = review_repo.create(task_id)
  review.status = GatesPending
  run gates (03a-gates)
  if gates pass -> AgentPending
```

### Approve (Agent)

```
function agent_approve(review_id):
  review = review_repo.get(review_id)
  ensure review.status == AgentPending
  review.status = HumanPending
```

### Approve (Human)

```
function human_approve(review_id):
  review = review_repo.get(review_id)
  ensure review.status == HumanPending
  review.status = Approved
  task.status = Completed
```

### Request Changes

```
function request_changes(review_id, comments):
  review = review_repo.get(review_id)
  ensure review.status in [AgentPending, HumanPending]
  add comments
  review.status = ChangesRequested
  task.status = InProgress
```

---

## Comment Model

- Comments target a diff location: file + line range + side.
- If line info is missing, comment applies to file-level change.
- Batching/drafts are client-side only.

Invariants:
- `line_start <= line_end` if both present.
- `file_path` must exist in diff for given review (best-effort validation).

---

## HelpRequest Interaction

- From any active state (Pending, InProgress, InReview), agent can request help.
- Task status becomes AwaitingHuman; Review remains in its current state.
- On resume, task returns to previous status and review continues.

---

## REST/OpenAPI Endpoints (Full Catalog)

All endpoints are under `/api`.

### Reviews
- `GET /reviews/{id}`
- `GET /tasks/{id}/reviews/active`
- `GET /tasks/{id}/reviews`
- `POST /reviews/{id}/comments`
- `GET /reviews/{id}/comments`
- `POST /comments/{id}/resolve`
- `POST /reviews/{id}/approve`
- `POST /reviews/{id}/request-changes`

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

- Only one active Review per task.
- Review status matches TaskStatus InReview.
- Comments immutable after creation except resolved_at.

---

**Phase: DRAFT v1 | Status: Ready for review**
