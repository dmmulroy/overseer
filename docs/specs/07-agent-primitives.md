# Agent Primitives

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 01-core-domain (Task, Review), 05-relay (WS), 06-git-ai (agent review)  
**Blocks:** None

## Overview

This spec defines agent capability negotiation, session lifecycle, and the MCP JS API surface (rquickjs-backed). It is the contract for harness providers and codemode execution.

---

## Capabilities

```json
{
  "harness_id": "h_123",
  "capabilities": [
    "tasks.execute",
    "reviews.agent",
    "gates.read",
    "help.request"
  ]
}
```

Rules:
- Capabilities are declarative and immutable for a session.
- Server may reject unsupported capability sets.

---

## Session Lifecycle

States: `Pending -> Active -> Completed | Failed | Cancelled`.

Events:
- `SessionStarted`, `SessionCompleted`, `SessionFailed` (04-events).

---

## MCP JS API (rquickjs)

JS API mirrors SDK modules:

```js
await tasks.create(input)
await tasks.start(id)
await tasks.submit(id)
await reviews.comment(input)
await gates.results(reviewId)
await help.request(input)
```

Constraints:
- rquickjs runtime only, no Node.js.
- Only JSON-serializable values cross the boundary.

---

## REST/OpenAPI Endpoints (Full Catalog)

All endpoints are under `/api`.

### Agent Primitives
- `POST /agents/register`
- `GET /agents/capabilities`
- `POST /sessions`
- `POST /sessions/{id}/heartbeat`
- `POST /sessions/{id}/complete`

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

### Git-AI
- `POST /git-ai/review`
- `GET /git-ai/review/{id}`
- `GET /git-ai/review/{id}/result`

---

## Invariants

- Sessions are owned by one harness.
- MCP calls must respect guardrails from 01-core-domain.

---

**Phase: DRAFT v1 | Status: Ready for review**
