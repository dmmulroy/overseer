# End-to-End Audit (API + Runtime)

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 10-system-integration (schemas), 05-relay, 09-mcp-rquickjs  
**Blocks:** None

## Overview

This audit maps every entrypoint to SDK calls, persistence, events, error classes, and retry semantics. It is the final implementation checklist.

---

## Entry Points

### CLI

- `os task|review|gate|help|repo|event|relay` map 1:1 to SDK calls.
- CLI errors map to JSON error envelope (when `--json`).

### REST

- All endpoints under `/api` map to `os-core` module methods.
- Error envelope + HTTP codes per `10-system-integration.md`.

### MCP

- `execute` -> rquickjs -> SDK modules.
- Errors: `js_runtime_error`, `sdk_error`, `timeout`.

### Relay WS

- `/api/relay/ws` -> session + harness state machine.
- Auth required before any message.

### SSE/WS Events

- `/api/events/subscribe` (SSE) + `/api/events/stream` (WS).
- Reconnect with last seq.

---

## REST Endpoint Audit

Legend: SDK call | DB tables | Events | Retry

### Tasks

- `POST /tasks` -> `tasks.create` | `tasks`, `idempotency_keys` | `TaskCreated` | retry with Idempotency-Key
- `GET /tasks/{id}` -> `tasks.get` | `tasks` | none | retry ok
- `GET /tasks` -> `tasks.list` | `tasks` | none | retry ok
- `PATCH /tasks/{id}` -> `tasks.update` | `tasks`, `idempotency_keys` | `TaskUpdated` (implicit) | retry with Idempotency-Key
- `DELETE /tasks/{id}` -> `tasks.delete` | `tasks`, `idempotency_keys` + cascade | `TaskDeleted` (implicit) | retry with Idempotency-Key
- `POST /tasks/{id}/start` -> `tasks.start` | `tasks`, `task_vcs`, `idempotency_keys` | `TaskStarted`, `RefCreated` | no retry on invalid_state
- `POST /tasks/{id}/submit` -> `tasks.submit` | `tasks`, `reviews`, `gate_results`, `idempotency_keys` | `TaskSubmitted`, `ReviewCreated`, `Gate*`, `Committed` | no retry on invalid_state
- `POST /tasks/{id}/cancel` -> `tasks.cancel` | `tasks`, `idempotency_keys` | `TaskCancelled` | retry with Idempotency-Key
- `POST /tasks/{id}/force-complete` -> `tasks.force_complete` | `tasks`, `idempotency_keys` | `TaskCompleted` | human only
- `POST /tasks/{id}/set-status` -> `tasks.set_status` | `tasks`, `idempotency_keys` | `TaskStatusChanged` | human only
- `POST /tasks/{id}/block` -> `tasks.block` | `tasks`, `idempotency_keys` | `BlockerAdded` | retry with Idempotency-Key
- `POST /tasks/{id}/unblock` -> `tasks.unblock` | `tasks`, `idempotency_keys` | `BlockerRemoved` | retry with Idempotency-Key
- `GET /tasks/tree` -> `tasks.tree` | `tasks` | none | retry ok
- `GET /tasks/progress` -> `tasks.progress` | `tasks` | none | retry ok
- `GET /tasks/next-ready` -> `tasks.next_ready` | `tasks` | none | retry ok

### Reviews + Comments

- `GET /reviews/{id}` -> `reviews.get` | `reviews` | none | retry ok
- `GET /tasks/{id}/reviews/active` -> `reviews.get_active` | `reviews` | none | retry ok
- `GET /tasks/{id}/reviews` -> `reviews.list` | `reviews` | none | retry ok
- `POST /reviews/{id}/comments` -> `reviews.comment` | `review_comments`, `idempotency_keys` | `CommentAdded` | retry with Idempotency-Key
- `GET /reviews/{id}/comments` -> `reviews.list_comments` | `review_comments` | none | retry ok
- `POST /comments/{id}/resolve` -> `reviews.resolve_comment` | `review_comments`, `idempotency_keys` | `CommentResolved` (implicit) | retry with Idempotency-Key
- `POST /reviews/{id}/approve` -> `reviews.approve` | `reviews`, `tasks`, `idempotency_keys` | `ReviewApproved`, `TaskCompleted` | no retry on invalid_state
- `POST /reviews/{id}/request-changes` -> `reviews.request_changes` | `reviews`, `review_comments`, `tasks`, `idempotency_keys` | `ChangesRequested` | no retry on invalid_state

### Gates

- `POST /gates` -> `gates.add` | `gates`, `idempotency_keys` | `GateAdded` (implicit) | retry with Idempotency-Key
- `GET /gates` -> `gates.list` | `gates` | none | retry ok
- `GET /gates/effective/{task_id}` -> `gates.get_effective` | `gates` | none | retry ok
- `PATCH /gates/{id}` -> `gates.update` | `gates`, `idempotency_keys` | `GateUpdated` (implicit) | retry with Idempotency-Key
- `DELETE /gates/{id}` -> `gates.remove` | `gates`, `idempotency_keys` | `GateRemoved` (implicit) | retry with Idempotency-Key
- `GET /gates/results/{review_id}` -> `gates.results` | `gate_results` | none | retry ok
- `POST /gates/rerun/{review_id}` -> `gates.rerun` | `gate_results`, `idempotency_keys` | `GateStarted`, `GateEscalated` | retry with Idempotency-Key

### Help

- `POST /help` -> `help.request` | `help_requests`, `tasks`, `idempotency_keys` | `HelpRequested` | no retry on invalid_state
- `POST /help/{id}/respond` -> `help.respond` | `help_requests`, `idempotency_keys` | `HelpResponded` | retry with Idempotency-Key
- `POST /help/{task_id}/resume` -> `help.resume` | `tasks`, `idempotency_keys` | `HelpResumed` | no retry on invalid_state
- `GET /help/active/{task_id}` -> `help.get_active` | `help_requests` | none | retry ok
- `GET /help/{task_id}` -> `help.list` | `help_requests` | none | retry ok

### Learnings

- `POST /learnings/{task_id}` -> `learnings.add` | `learnings`, `idempotency_keys` | `LearningAdded`, `LearningBubbled` | retry with Idempotency-Key
- `GET /learnings/{task_id}` -> `learnings.list` | `learnings` | none | retry ok
- `GET /learnings/{task_id}/inherited` -> `learnings.get_inherited` | `learnings` | none | retry ok

### Repos

- `POST /repos` -> `repos.register` | `repos`, `idempotency_keys` | `RepoRegistered` (implicit) | retry with Idempotency-Key
- `GET /repos/{id}` -> `repos.get` | `repos` | none | retry ok
- `GET /repos/by-path` -> `repos.get_by_path` | `repos` | none | retry ok
- `GET /repos` -> `repos.list` | `repos` | none | retry ok
- `DELETE /repos/{id}` -> `repos.unregister` | `repos`, `idempotency_keys` | `RepoUnregistered` (implicit) | retry with Idempotency-Key

### VCS

- `GET /vcs/task/{id}` -> `vcs.get_task_vcs` | `task_vcs` | none | retry ok
- `GET /vcs/task` -> `vcs.list_task_vcs` | `task_vcs` | none | retry ok
- `POST /vcs/task/{id}/archive` -> `vcs.archive` | `task_vcs`, `idempotency_keys` | `TaskArchived` | retry with Idempotency-Key
- `GET /vcs/diff/{id}` -> `vcs.diff` | none | none | retry ok

### Events

- `GET /events` -> `events.list` | `events` | none | retry ok
- `GET /events/replay` -> `events.replay` | `events` | none | retry ok
- `GET /events/subscribe` -> `events.subscribe` | `events` | stream | reconnect with last seq
- `GET /events/stream` -> `events.stream` | `events` | stream | reconnect with last seq

### Relay

- `GET /relay/ws` -> relay server | `sessions`, `harnesses` | `SessionStarted/Completed/Failed` | reconnect with backoff

### Git-AI

- `POST /git-ai/review` -> `git_ai.start` | `git_ai_jobs` (if stored), `idempotency_keys` | `GitAiStarted` | retry with Idempotency-Key
- `GET /git-ai/review/{id}/result` -> `git_ai.result` | `git_ai_jobs` | `GitAiCompleted|GitAiFailed` | retry ok
- `GET /git-ai/review/{id}` -> `git_ai.status` | `git_ai_jobs` | none | retry ok
- `GET /git-ai/review/{id}/result` -> `git_ai.result` | `git_ai_jobs` | none | retry ok

### Agents + Sessions

- `POST /agents/register` -> `agents.register` | `harnesses`, `idempotency_keys` | `HarnessConnected` | retry with Idempotency-Key
- `GET /agents/capabilities` -> `agents.list` | `harnesses` | none | retry ok
- `POST /sessions` -> `sessions.create` | `sessions`, `idempotency_keys` | `SessionStarted` | retry with Idempotency-Key
- `POST /sessions/{id}/heartbeat` -> `sessions.heartbeat` | `sessions`, `idempotency_keys` | none | retry ok
- `POST /sessions/{id}/complete` -> `sessions.complete` | `sessions`, `idempotency_keys` | `SessionCompleted/Failed`, `HarnessDisconnected` | retry with Idempotency-Key

---

## Connection Audit

- SSE: ordered events, reconnect by seq, no client ack.
- Relay WS: auth -> register -> session lifecycle; heartbeat required.
- MCP stdio: request/response only, no streaming.

---

## Persistence Audit

- Every write mutates sqlite and appends event in same transaction.
- Read-only endpoints do not mutate state.
- VCS operations only occur during start/submit/archive.

---

**Phase: DRAFT v1 | Status: Ready for review**
