# git-ai Integration

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 01-core-domain (Review, Comment), 03-review (review workflow), 05-relay (agent delivery)  
**Blocks:** None

## Overview

git-ai provides automated review feedback for tasks. This spec defines the input payloads, output contracts, and safety constraints for integration.

## External Git AI Standard (v3.0.0)

The Git AI Standard v3.0.0 (authorship logs via git notes) is a separate, external spec:
https://github.com/git-ai-project/git-ai/blob/main/specs/git_ai_standard_v3.0.0.md

This Overseer git-ai integration is about **automated review feedback**, not authorship logs.
If we add authorship log support, it will:
- Write git notes under `refs/notes/ai` with `schema_version = "authorship/3.0.0"`
- Keep the authorship log format and session hash semantics per the external spec
- Be optional/feature-flagged and implemented in the VCS layer (not in review flow)

---

## Inputs/Outputs

### GitAiReviewInput

```rust
pub struct GitAiReviewInput {
    pub task_id: AnyTaskId,
    pub review_id: ReviewId,
    pub diff: Diff,
    pub task_context: TaskContext,
    pub learnings: InheritedLearnings,
    pub gate_results: Vec<GateResult>,
}
```

### GitAiReviewOutput

```rust
pub struct GitAiReviewOutput {
    pub decision: ReviewDecision,
    pub comments: Vec<CreateCommentInput>,
    pub summary: Option<String>,
}

pub enum ReviewDecision { Approve, RequestChanges }
```

### Errors

```rust
pub enum GitAiError {
    ProviderUnavailable,
    InvalidInput,
    Timeout,
    Internal,
}
```

---

## Flow

1. Task submitted -> review created -> gates pass.
2. System calls git-ai with `GitAiReviewInput`.
3. Output is converted into ReviewComments and a decision.
4. Decision updates review status (AgentPending -> HumanPending or ChangesRequested).

---

## Safety Constraints

- No direct code changes; git-ai only produces comments and decision.
- Diff and context are read-only.
- Rate limit per repo to avoid runaway requests.

---

## REST/OpenAPI Endpoints (Full Catalog)

All endpoints are under `/api`.

### Git-AI
- `POST /git-ai/review`
- `GET /git-ai/review/{id}`
- `GET /git-ai/review/{id}/result`

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

### Events
- `GET /events`
- `GET /events/replay`
- `GET /events/subscribe` (SSE)
- `GET /events/stream` (WS)

### Relay
- `GET /relay/ws` (WS upgrade)

### Agent Primitives
- `POST /agents/register`
- `GET /agents/capabilities`
- `POST /sessions`
- `POST /sessions/{id}/heartbeat`
- `POST /sessions/{id}/complete`

---

## Invariants

- git-ai cannot modify tasks directly.
- Only ReviewComments and decision are produced.
- Decision applies only to AgentPending phase.

---

**Phase: DRAFT v1 | Status: Ready for review**
