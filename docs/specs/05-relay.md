# Relay (Harness Broker)

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 01-core-domain (Task, Review), 04-events (event stream)  
**Blocks:** 06-git-ai, 07-agent-primitives

## Overview

Relay is a WebSocket broker that connects harness providers (agents) with UI clients for task execution and review feedback. It supports shared-token auth and session routing.

### Actors

- **Harness Provider**: External agent runner (OpenCode, Claude Code, etc).
- **UI Client**: Human interface (web UI/TUI) that assigns tasks and reviews.
- **Relay Server**: Broker in `os serve`.

---

## Session Model (Top-to-Bottom)

### Session Entity (Relay)

```text
Session {
  id: string
  task_id: AnyTaskId
  harness_id: string
  status: Pending | Active | Completed | Failed | Cancelled
  started_at: timestamp
  last_heartbeat_at: timestamp
  completed_at: timestamp?
  error: string?
}
```

### State Machine

```
Pending -> Active -> Completed
               |-> Failed
Pending -> Cancelled
Active  -> Cancelled
```

Rules:
- One active session per task.
- Harness must be registered before session start.
- Session is failed if harness disconnects or heartbeat timeout.

---

## Top-to-Bottom Flow

1. UI connects WS -> auth -> subscribes to relay events.
2. Harness connects WS -> auth -> registers capabilities.
3. UI requests a session for task with preferred harness.
4. Relay creates Session, notifies harness: `session_start`.
5. Harness acknowledges and begins work; sends progress, comments, and final status.
6. Relay emits session events to UI and persists session status.
7. On completion, UI can continue review flow via REST endpoints.

---

## Auth (Shared Token)

- Server configured with `OVERSEER_RELAY_TOKEN`.
- Client must send token in initial auth message.
- Connection is closed on auth failure.

Auth message:

```json
{ "type": "auth", "token": "..." }
```

Server response:

```json
{ "type": "auth_ok" }
```

Errors:

```json
{ "type": "error", "code": "auth_failed", "message": "invalid token" }
```

---

## Message Types

All messages are JSON with `type` field.

### Envelope

```json
{
  "type": "...",
  "message_id": "msg_...",
  "correlation_id": "corr_...",
  "session_id": "s_123",
  "task_id": "task_...",
  "payload": { }
}
```

Rules:
- `correlation_id` is optional but preferred for tracing.
- `session_id` required for session-scoped messages.
- `message_id` required for at-least-once de-dup.

### Harness Registration

```json
{ "type": "register_harness", "harness_id": "h_123", "capabilities": ["tasks.execute", "reviews.agent"] }
```

Server:

```json
{ "type": "harness_registered", "harness_id": "h_123" }
```

### Session Lifecycle

Start session (server -> harness):

```json
{ "type": "session_start", "session_id": "s_123", "task_id": "task_...", "harness_id": "h_123" }
```

Heartbeat (harness -> server):

```json
{ "type": "session_heartbeat", "session_id": "s_123" }
```

Complete (harness -> server):

```json
{ "type": "session_complete", "session_id": "s_123", "status": "ok" }
```

Cancel (ui -> server):

```json
{ "type": "session_cancel", "session_id": "s_123", "reason": "user_cancelled" }
```

Ack (harness -> server):

```json
{ "type": "session_ack", "session_id": "s_123" }
```

### Progress + Output

```json
{ "type": "session_progress", "session_id": "s_123", "percent": 42, "message": "running gates" }
```

```json
{ "type": "session_log", "session_id": "s_123", "level": "info", "message": "..." }
```

### Review Feedback

```json
{ "type": "review_comment", "review_id": "rev_...", "comment": { ... } }
```

### Errors

```json
{ "type": "error", "code": "invalid_message", "message": "..." }
```

---

## Routing Rules

- UI clients can target a harness by `harness_id`.
- Server forwards messages based on `session_id` or `task_id` mapping.
- If harness disconnects, sessions are marked failed and UI notified.

### Session Persistence

- Sessions are persisted in sqlite via os-core.
- Relay emits `SessionStarted`, `SessionCompleted`, `SessionFailed` events.

### Failure Cases

- Unknown harness -> `error` with `code: harness_not_found`.
- Duplicate session -> `error` with `code: session_exists`.
- Heartbeat timeout -> session failed + disconnect.

---

## Heartbeats

- Server sends ping every 30s.
- Client must reply with pong in 10s.
- On timeout, connection closed and sessions failed.

---

## Reconnect + Recovery

### Reconnect Backoff

- Exponential backoff with jitter.
- Base 500ms, max 30s, max attempts: unlimited.

### Session Recovery Window

- 60s grace window after disconnect before marking session failed.
- Harness reconnect with same `harness_id` can reattach to active session.
- Harness must send `session_ack` for each reattached session.

### Message Delivery

- At-least-once delivery.
- All session-scoped messages include `message_id`.
- Receiver must de-dup by `message_id`.

---

## REST/OpenAPI Endpoints (Full Catalog)

All endpoints are under `/api`.

### Relay
- `GET /relay/ws` (WS upgrade)

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

- Auth must succeed before any other message.
- One harness per `harness_id` connection.
- Session IDs are globally unique.

---

**Phase: DRAFT v1 | Status: Ready for review**
