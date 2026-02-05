# System Integration and Runtime Contracts

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 00-monorepo, 01-core-domain, 02-vcs, 03-review, 04-events, 05-relay, 08-web-ui, 09-mcp-rquickjs  
**Blocks:** None

## Overview

This spec ties all subsystems together: call paths, error mapping, tracing, logging, and runtime contracts. It is the technical blueprint for building the full system end-to-end.

---

## Component Map

```
CLI (os) -> os-core -> os-db (sqlite)
                 -> os-vcs (jj/gix)
                 -> os-events (event bus + store)

os-serve (axum)
  REST -> os-core
  SSE  -> os-events
  Relay WS -> os-core + os-events

os-mcp (rquickjs)
  stdio -> JS -> os-core

Web UI
  REST + SSE + Relay WS
  TanStack DB + Query
```

---

## Error Model

### Unified Error Envelope

```json
{
  "code": "not_found",
  "message": "task not found",
  "details": { },
  "correlation_id": "corr_..."
}
```

### HTTP Mapping

- 400 `invalid_input`
- 401 `unauthorized` (relay only)
- 404 `not_found`
- 409 `conflict` (e.g., cycle, duplicate ref)
- 412 `precondition_failed` (dirty repo, blocked task)
- 422 `invalid_state` (state machine violations)
- 500 `internal_error`

### MCP Mapping

- `js_runtime_error`
- `sdk_error`
- `timeout`
- `invalid_params`

---

## Canonical JSON Types

### Task

```json
{
  "id": "task_...",
  "repo_id": "repo_...",
  "parent_id": "ms_...|task_...|sub_...|null",
  "kind": "Milestone|Task|Subtask",
  "description": "...",
  "context": "...|null",
  "priority": 0,
  "status": "Pending|InProgress|InReview|AwaitingHuman|Completed|Cancelled",
  "blocked_by": ["task_..."],
  "created_at": "RFC3339",
  "updated_at": "RFC3339",
  "started_at": "RFC3339|null",
  "completed_at": "RFC3339|null"
}
```

### TaskWithContext

```json
{
  "task": { "Task": "..." },
  "context": { "own": "...|null", "parent": "...|null", "milestone": "...|null" },
  "learnings": { "own": [], "parent": [], "milestone": [] },
  "gates": [ { "Gate": "..." } ],
  "vcs": { "TaskVcs": "..." } | null,
  "review": { "Review": "..." } | null,
  "help_request": { "HelpRequest": "..." } | null
}
```

### TaskTree + TaskProgress

```json
{
  "task": { "Task": "..." },
  "children": [ { "TaskTree": "..." } ]
}
```

```json
{
  "total": 10,
  "completed": 2,
  "ready": 3,
  "blocked": 1,
  "in_progress": 2,
  "in_review": 1,
  "awaiting_human": 1
}
```

### InheritedLearnings

```json
{ "own": ["Learning"], "parent": ["Learning"], "milestone": ["Learning"] }
```

### Review

```json
{
  "id": "rev_...",
  "task_id": "task_...",
  "status": "GatesPending|GatesEscalated|AgentPending|HumanPending|Approved|ChangesRequested",
  "submitted_at": "RFC3339",
  "gates_completed_at": "RFC3339|null",
  "agent_completed_at": "RFC3339|null",
  "human_completed_at": "RFC3339|null",
  "created_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

### ReviewComment

```json
{
  "id": "cmt_...",
  "review_id": "rev_...",
  "task_id": "task_...",
  "author": "Agent|Human",
  "file_path": "...",
  "line_start": 12,
  "line_end": 14,
  "side": "Left|Right",
  "body": "...",
  "created_at": "RFC3339",
  "resolved_at": "RFC3339|null"
}
```

### Gate + GateResult

```json
{
  "id": "gate_...",
  "scope": { "type": "Repo|Task", "id": "repo_...|task_..." },
  "name": "typecheck",
  "command": "npm run typecheck",
  "timeout_secs": 300,
  "max_retries": 3,
  "poll_interval_secs": 30,
  "max_pending_secs": 86400,
  "created_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

```json
{
  "gate_id": "gate_...",
  "task_id": "task_...",
  "review_id": "rev_...",
  "status": "Running|Pending|Passed|Failed|Timeout|Escalated",
  "stdout": "...",
  "stderr": "...",
  "exit_code": 1,
  "attempt": 1,
  "started_at": "RFC3339",
  "completed_at": "RFC3339|null"
}
```

### HelpRequest

```json
{
  "id": "help_...",
  "task_id": "task_...",
  "from_status": "Pending|InProgress|InReview",
  "category": "Clarification|Decision|TechnicalBlocker|Unexpected",
  "reason": "...",
  "suggested_options": ["..."],
  "status": "Pending|Responded|Resolved|Cancelled",
  "response": "...|null",
  "chosen_option": 0,
  "created_at": "RFC3339",
  "responded_at": "RFC3339|null",
  "resumed_at": "RFC3339|null"
}
```

### Learning

```json
{
  "id": "lrn_...",
  "task_id": "task_...",
  "content": "...",
  "source_task_id": "task_...|null",
  "created_at": "RFC3339"
}
```

### Repo

```json
{
  "id": "repo_...",
  "path": "/abs/path",
  "name": "repo-name",
  "vcs_type": "Jj|Git",
  "created_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

### TaskVcs

```json
{
  "task_id": "task_...",
  "repo_id": "repo_...",
  "vcs_type": "Jj|Git",
  "ref_name": "task/task_...",
  "change_id": "...",
  "base_commit": "...",
  "head_commit": "...|null",
  "start_commit": "...",
  "archived_at": "RFC3339|null"
}
```

### Diff

```json
{
  "base": "...",
  "head": "...",
  "unified": "...",
  "files": [ { "path": "...", "hunks": [] } ]
}
```

### Event

```json
{
  "id": "evt_...",
  "seq": 123,
  "at": "RFC3339",
  "correlation_id": "corr_...|null",
  "source": "Cli|Mcp|Ui|Relay",
  "body": { "type": "TaskCreated", "payload": { } }
}
```

### Session + Harness

```json
{
  "id": "sess_...",
  "task_id": "task_...",
  "harness_id": "h_...",
  "status": "Pending|Active|Completed|Failed|Cancelled",
  "started_at": "RFC3339",
  "last_heartbeat_at": "RFC3339|null",
  "completed_at": "RFC3339|null",
  "error": "...|null"
}
```

### GitAiReviewOutput

```json
{
  "decision": "Approve|RequestChanges",
  "comments": ["CreateCommentInput"],
  "summary": "...|null"
}
```

```json
{
  "id": "h_...",
  "capabilities": ["tasks.execute", "reviews.agent"],
  "connected": true,
  "last_seen_at": "RFC3339"
}
```

---

## REST API Schemas (Concrete)

All endpoints are under `/api`. Successful responses return JSON without wrappers.

### Common

- Headers: `X-Correlation-Id` (request/response).
- Optional: `Idempotency-Key` for POST/DELETE/PATCH.
- Query params: `limit`, `offset` where applicable.

### Tasks

`POST /tasks`

Request:

```json
{ "repo_id": "repo_...", "parent_id": null, "kind": "Task", "description": "...", "context": null, "priority": 2, "blocked_by": [] }
```

Response: `Task`

`GET /tasks/{id}` -> `TaskWithContext`

`GET /tasks` query:

- `repo_id`, `parent_id`, `kind`, `status`, `ready`, `archived`, `limit`, `offset`

Response: `Task[]`

`PATCH /tasks/{id}`

Request:

```json
{ "description": "...", "context": "...", "priority": 1 }
```

Response: `Task`

`DELETE /tasks/{id}` -> `{ "ok": true }`

`POST /tasks/{id}/start` -> `Task`

`POST /tasks/{id}/submit` -> `Task`

`POST /tasks/{id}/cancel` -> `Task`

`POST /tasks/{id}/force-complete` -> `Task`

`POST /tasks/{id}/set-status`

Request:

```json
{ "status": "Completed" }
```

Response: `Task`

`POST /tasks/{id}/block`

Request:

```json
{ "blocker_id": "task_..." }
```

Response: `{ "ok": true }`

`POST /tasks/{id}/unblock`

Request:

```json
{ "blocker_id": "task_..." }
```

Response: `{ "ok": true }`

`GET /tasks/tree?root_id=...` -> `TaskTree`

`GET /tasks/progress?repo_id=...&root_id=...` -> `TaskProgress`

`GET /tasks/next-ready?repo_id=...&milestone_id=...` -> `TaskWithContext|null`

### Reviews

`GET /reviews/{id}` -> `Review`

`GET /tasks/{id}/reviews/active` -> `Review|null`

`GET /tasks/{id}/reviews` -> `Review[]`

`POST /reviews/{id}/comments`

Request: `CreateCommentInput`

Response: `ReviewComment`

`GET /reviews/{id}/comments` -> `ReviewComment[]`

`POST /comments/{id}/resolve` -> `ReviewComment`

`POST /reviews/{id}/approve` -> `Review`

`POST /reviews/{id}/request-changes`

Request:

```json
{ "comments": ["CreateCommentInput"], "summary": "..." }
```

Response: `Review`

### Gates

`POST /gates` -> `Gate`

Request:

```json
{ "scope": { "type": "Repo", "id": "repo_..." }, "name": "lint", "command": "npm run lint", "timeout_secs": 120, "max_retries": 2, "poll_interval_secs": 30, "max_pending_secs": 86400 }
```

`GET /gates?scope=repo|task&id=...` -> `Gate[]`

`GET /gates/effective/{task_id}` -> `Gate[]`

`PATCH /gates/{id}` -> `Gate`

`DELETE /gates/{id}` -> `{ "ok": true }`

`GET /gates/results/{review_id}` -> `GateResult[]`

`POST /gates/rerun/{review_id}` -> `{ "ok": true }`

### Help

`POST /help` -> `HelpRequest`

Request:

```json
{ "task_id": "task_...", "category": "Clarification", "reason": "...", "suggested_options": ["..."] }
```

`POST /help/{id}/respond`

Request:

```json
{ "response": "...", "chosen_option": 0 }
```

Response: `HelpRequest`

`POST /help/{task_id}/resume` -> `Task`

`GET /help/active/{task_id}` -> `HelpRequest|null`

`GET /help/{task_id}` -> `HelpRequest[]`

### Learnings

`POST /learnings/{task_id}`

Request:

```json
{ "content": "..." }
```

Response: `Learning`

`GET /learnings/{task_id}` -> `Learning[]`

`GET /learnings/{task_id}/inherited` -> `InheritedLearnings`

### Repos

`POST /repos`

Request:

```json
{ "path": "/abs/path" }
```

Response: `Repo`

`GET /repos/{id}` -> `Repo`

`GET /repos/by-path?path=/abs/path` -> `Repo|null`

`GET /repos` -> `Repo[]`

`DELETE /repos/{id}` -> `{ "ok": true }`

### VCS

`GET /vcs/task/{id}` -> `TaskVcs|null`

`GET /vcs/task?repo_id=...` -> `TaskVcs[]`

`POST /vcs/task/{id}/archive` -> `TaskVcs`

`GET /vcs/diff/{id}` -> `Diff`

### Events

`GET /events?after=...&limit=...&type=...&source=...` -> `Event[]`

`GET /events/replay?after=...&limit=...` -> `Event[]`

`GET /events/subscribe?after=...` -> SSE stream

`GET /events/stream` -> WS stream

### Relay

`GET /relay/ws` -> WS upgrade (relay protocol)

### Git-AI

`POST /git-ai/review`

Request:

```json
{ "task_id": "task_...", "review_id": "rev_..." }
```

Response:

```json
{ "id": "gitai_...", "status": "queued" }
```

`GET /git-ai/review/{id}` -> `{ "id": "...", "status": "queued|running|done|failed" }`

`GET /git-ai/review/{id}/result` -> `GitAiReviewOutput`

### Agents + Sessions

`POST /agents/register` -> `Harness`

`GET /agents/capabilities` -> `Harness[]`

`POST /sessions`

Request:

```json
{ "task_id": "task_...", "harness_id": "h_..." }
```

Response: `Session`

`POST /sessions/{id}/heartbeat` -> `Session`

`POST /sessions/{id}/complete`

Request:

```json
{ "status": "Completed|Failed", "error": "...|null" }
```

Response: `Session`

---

## Entry Points and Connections

### CLI

- `os <command>` calls SDK directly (local sqlite).
- Optional routing through `os serve` if configured.

### REST (HTTP)

- Stateless request/response.
- Keep-alive enabled.
- `X-Correlation-Id` propagated.

### SSE

- `/api/events/subscribe` streams ordered events.
- Clients reconnect with `Last-Event-ID` or `after` query.

### Relay WS

- `/api/relay/ws` with shared-token auth.
- Session messages are ordered per session.
- Heartbeat required to keep session alive.
- Reconnect uses exponential backoff + jitter.
- 60s grace window for session reattach.
- Messages are at-least-once; de-dup by `message_id`.

### MCP (stdio)

- Single `execute` method; rquickjs per request.
- 30s timeout default; no network access.

---

## Retry + Idempotency

- GETs are safe to retry.
- POST/PATCH/DELETE are not idempotent by default; use `Idempotency-Key` on retries.
- Do not retry on `invalid_state`, `conflict`, or validation errors.
- SSE/WS reconnect uses last known `seq` to resume.

### Idempotency-Key Policy

- Header: `Idempotency-Key` (ASCII, 1-128 chars).
- Scope: per endpoint + per auth token (or relay token) + per repo_id when provided.
- Required for client retry of write endpoints.

#### Storage

Table: `idempotency_keys`

Columns:
- `key`: string
- `method`: string
- `path`: string
- `scope_hash`: string (auth token hash + repo_id)
- `request_hash`: string (stable hash of body + query)
- `response_status`: int
- `response_body`: json
- `created_at`: timestamp
- `expires_at`: timestamp

TTL:
- Default 24h retention.
- Cleanup on startup and periodically.

#### Replay Rules

- Same key + same request_hash -> return cached response (status + body).
- Same key + different request_hash -> 409 `conflict`.
- In-flight duplicate: second request waits on first (single-flight lock).
- Errors are cached only for 5xx if `Idempotency-Key` present.

#### Non-REST Entry Points

- CLI/MCP: idempotency handled by caller (no storage).
- Relay WS: session messages include `message_id` for at-least-once delivery.

---

## Persistence Mapping (SQLite)

Tables and key columns (not full DDL):

- `tasks`: id, repo_id, parent_id, kind, status, priority, blocked_by, timestamps
- `task_vcs`: task_id, repo_id, ref_name, change_id, base_commit, head_commit, archived_at
- `reviews`: id, task_id, status, submitted_at, phase timestamps
- `review_comments`: id, review_id, task_id, author, file_path, line_start, line_end, side, body, resolved_at
- `gates`: id, scope_type, scope_id, name, command, timeout_secs, max_retries, poll_interval_secs, max_pending_secs
- `gate_results`: gate_id, review_id, task_id, status, stdout, stderr, exit_code, attempt, timestamps
- `help_requests`: id, task_id, from_status, category, reason, options, status, response, chosen_option, timestamps
- `learnings`: id, task_id, content, source_task_id, created_at
- `repos`: id, path, name, vcs_type, timestamps
- `events`: id, seq, at, correlation_id, source, body_json
- `sessions`: id, task_id, harness_id, status, last_heartbeat_at, completed_at, error
- `harnesses`: id, capabilities_json, connected, last_seen_at
- `idempotency_keys`: key, method, path, scope_hash, request_hash, response_status, response_body, created_at, expires_at

Indexes:

- `tasks(repo_id, status)`, `tasks(parent_id)`
- `task_vcs(repo_id)`
- `reviews(task_id, status)`
- `review_comments(review_id)`
- `gates(scope_type, scope_id, name)`
- `gate_results(review_id)`
- `help_requests(task_id, status)`
- `learnings(task_id)`
- `events(seq)`
- `sessions(task_id, status)`
- `harnesses(id)`

---

## Tracing

- `correlation_id` created per request (UI/CLI/MCP).
- Propagated to:
  - REST response headers.
  - Events (Event.correlation_id).
  - Relay messages (envelope field).
  - Logs.

### Header Conventions

- Request: `X-Correlation-Id` (optional).
- Response: `X-Correlation-Id` (always).

---

## Logging

- Use `tracing` with JSON logs in serve mode.
- Include fields: `correlation_id`, `task_id`, `review_id`, `repo_id`, `session_id`.
- Log boundaries:
  - API request start/end
  - State transitions
  - VCS operations
  - Gate execution
  - Relay session events

---

## Database Transactions

- Single write transaction per state change.
- Persist state + event in same transaction.
- WAL mode for concurrency.
- Event bus dispatch occurs after commit.

---

## Core Call Flows

### Task Create

1. API -> os-core.tasks.create
2. Validate hierarchy + blockers
3. Insert into sqlite
4. Append Event.TaskCreated
5. Return Task

### Task Start

1. API -> os-core.tasks.start
2. Validate status + blockers
3. os-vcs ensure clean, create ref
4. Persist TaskVcs + status update
5. Append Event.TaskStarted + Event.RefCreated

### Task Submit

1. API -> os-core.tasks.submit
2. os-vcs commit changes
3. Create Review (GatesPending)
4. Run gates (03a-gates)
5. Update Review status
6. Append events: TaskSubmitted, ReviewCreated, GateStarted/Passed/Failed

### Review Approve

1. Agent approve -> Review AgentPending -> HumanPending
2. Human approve -> Review Approved -> Task Completed
3. Append ReviewApproved + TaskCompleted

### Help Request

1. Agent calls help.request -> Task AwaitingHuman
2. Persist HelpRequest (Pending)
3. UI responds -> HelpRequest Responded
4. Resume -> Task returns to from_status

### Relay Session

1. UI requests session -> Relay creates Session (Pending)
2. Relay sends session_start to harness
3. Harness ack -> Session Active
4. Progress/logs -> Relay -> UI
5. Complete -> Session Completed, emit Event.SessionCompleted

---

## Event Stream

- Events appended in sqlite with monotonic seq.
- SSE clients receive ordered events.
- WS clients receive ordered events; reconnect uses last seq.

---

## UI Data Flow (Local-First)

- REST fetch populates TanStack DB via Query Collections.
- SSE updates apply direct writes (`writeBatch`).
- UI reads via `useLiveQuery`.
- LocalStorage collections persist UI prefs.

---

## Relay + Harness Integration

- Relay auth via shared token.
- Harness registers capabilities; server validates.
- Only one active session per task.
- Disconnect -> session failed + UI notified.

---

## Observability

Metrics (examples):
- `requests_total{route,status}`
- `task_transitions_total{from,to}`
- `gate_runs_total{status}`
- `relay_sessions_total{status}`
- `events_emitted_total{type}`

---

## Invariants

- State changes and event append are atomic.
- Correlation IDs propagate end-to-end.
- VCS operations happen only on clean repo.
- Relay sessions are single-owner per task.

---

**Phase: DRAFT v1 | Status: Ready for review**
