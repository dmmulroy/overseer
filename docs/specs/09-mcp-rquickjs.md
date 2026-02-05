# MCP Server (rquickjs)

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 01-core-domain (SDK APIs), 04-events (event stream)  
**Blocks:** None

## Overview

The MCP server runs inside the `os` binary and executes agent-provided JS via rquickjs. It exposes the SDK API surface to JS and returns only structured results. No Node.js dependency.

### Dependencies

- Uses `os-core` SDK.
- Persistence via `os-db` (sqlite) through SDK.

---

## Transport

- MCP over stdio (JSON messages).
- Single `execute` tool: JS string in, JSON result out.
- Each request is isolated and time-limited.

### Request

```json
{
  "id": "req_123",
  "method": "execute",
  "params": {
    "code": "// JS code",
    "timeout_ms": 30000,
    "correlation_id": "corr_..."
  }
}
```

### Response

```json
{
  "id": "req_123",
  "result": {
    "ok": true,
    "value": { }
  }
}
```

Errors:

```json
{
  "id": "req_123",
  "error": {
    "code": "js_runtime_error",
    "message": "...",
    "data": { "stack": "..." }
  }
}
```

---

## JS API Surface

Expose SDK modules in JS:

```js
await tasks.create(input)
await tasks.start(id)
await tasks.submit(id)
await reviews.comment(input)
await gates.results(reviewId)
await help.request(input)
```

Rules:
- Only JSON-serializable values cross the boundary.
- All methods return Promises.

---

## Runtime Isolation

- New rquickjs context per request.
- No persistent global state between requests.
- `console.log` captured and returned in response metadata.

### Restrictions

- No filesystem access.
- No network access.
- No dynamic module loading.
- No host process access.

---

## Timeouts and Limits

- Default timeout: 30s.
- Hard memory limit per request (configurable).
- Output size capped (stdout/stderr/logs).

---

## Error Mapping

- JS exceptions -> `js_runtime_error`.
- SDK errors -> `sdk_error` with `{ tag, message }`.
- Timeout -> `timeout`.
- Validation errors -> `invalid_params`.

---

## Tracing + Logging

- `correlation_id` propagated into SDK calls and events.
- Logs include `request_id`, `task_id` when available.

---

## REST/OpenAPI Endpoints (Full Catalog)

MCP runs over stdio and does not expose REST endpoints. SDK APIs below are accessible via JS bindings:

### Tasks
- create/get/list/update/delete/start/submit/cancel/force_complete/set_status/block/unblock/tree/progress/next_ready

### Reviews
- get/get_active/list/comment/list_comments/resolve_comment/approve/request_changes

### Gates
- add/list/get_effective/remove/update/results/rerun

### Help
- request/respond/resume/get_active/list

### Learnings
- add/list/get_inherited

### Repos
- register/get/get_by_path/list/unregister

### Events
- subscribe/list/replay

---

## Invariants

- JS execution is isolated per request.
- SDK guardrails from 01-core-domain apply.
- No side effects outside SDK API.

---

**Phase: DRAFT v1 | Status: Ready for review**
