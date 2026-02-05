# Implementation Guide for Codex xhigh

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 00-monorepo, 01-core-domain, 10-system-integration  
**Blocks:** None

## Purpose

Instructions for GPT‑5.2 Codex xhigh to build Overseer v2 from specs. Greenfield only. Ignore v1 code.

---

## Read Order (Spec Precedence)

1. `docs/ARCHITECTURE-V2.md` (vision + spec index)
2. `docs/specs/00-monorepo.md` (crate layout, build)
3. `docs/specs/01-core-domain.md` (types + invariants, **source of truth**)
4. `docs/specs/02-vcs.md`
5. `docs/specs/03-review.md` + `docs/specs/03a-gates.md`
6. `docs/specs/04-events.md` (canonical event list)
7. `docs/specs/05-relay.md`
8. `docs/specs/06-git-ai.md`
9. `docs/specs/07-agent-primitives.md`
10. `docs/specs/08-web-ui.md`
11. `docs/specs/09-mcp-rquickjs.md`
12. `docs/specs/10-system-integration.md` (REST schema + error map)
13. `docs/specs/11-end-to-end-audit.md` (endpoint -> DB/events)
14. `docs/specs/12-feedback-loops.md`

Conflict rule: 01-core-domain > 10-system-integration > others. If conflict, update spec first.

---

## Hard Invariants (Do Not Break)

- IDs are prefixed ULIDs (ms_/task_/sub_/rev_/cmt_/repo_/gate_/help_/lrn_).
- Task hierarchy depth max 2.
- Cycle detection by DFS (no depth limit).
- State transitions must match lifecycle; invalid_state -> 422.
- VCS ops only on clean repo; start/submit/archival only.
- Event append + state change in same sqlite transaction.
- REST error envelope + HTTP mapping in `10-system-integration.md`.
- rquickjs only for MCP (no Node).
- Idempotency-Key policy in `10-system-integration.md`.

---

## Build Order (Recommended)

1. **Workspace scaffold**: crates per `00-monorepo.md`, build scripts, CI skeleton.
2. **os-core types**: implement 01-core-domain structs/enums, validation.
3. **os-db**: sqlite schema from `10-system-integration.md` + migrations.
4. **CRUD**: tasks/reviews/gates/help/learnings/repos/events APIs in os-core.
5. **Events**: event table + bus + SSE/WS stream.
6. **VCS**: jj/gix backends + TaskVcs lifecycle + stacked diff rules.
7. **Review pipeline**: gates + review states + help requests.
8. **os-serve**: REST + utoipa + OpenAPI; align schemas.
9. **os-mcp**: rquickjs executor + JS bindings.
10. **Relay**: WS server + sessions + harness registry.
11. **Web UI**: TanStack DB local-first UI + theme tokens.
12. **Feedback loops**: gates + eval harness hooks.

---

## REST + Transport

- REST endpoints + request/response schemas in `10-system-integration.md`.
- SSE/WS event stream semantics in `04-events.md`.
- Relay WS protocol in `05-relay.md`.
- MCP stdio in `09-mcp-rquickjs.md`.

---

## DB + Idempotency

- Use WAL + busy_timeout.
- Tables + indexes in `10-system-integration.md`.
- Idempotency-Key storage table; replay rules in `10-system-integration.md`.

---

## Events

- Emit event on every state change.
- Canonical list in `04-events.md`. Keep in sync with ARCH.

---

## UI Rules

- Theme from `ui/src/client/styles/global.css` (existing tokens).
- TanStack DB collections + `useLiveQuery`.
- `queryCollectionOptions` + `syncMode: "on-demand"`.
- SSE/WS updates via `writeBatch`.

---

## Quality + Feedback Loops

- Implement gates for L1/L2/L3 checks.
- Record learnings after failures.
- Use eval harness for scenario tests.

---

## Style/Type Safety

- No `any`, no non-null assertions, avoid type casts.
- Errors are typed; illegal states unrepresentable.

---

**Phase: DRAFT v1 | Status: Ready for review**
