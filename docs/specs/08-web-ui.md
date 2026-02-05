# Web UI (Local-First Console)

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 01-core-domain, 04-events, 05-relay, 00-monorepo  
**Blocks:** None

## Overview

The Web UI is a local-first task console embedded in `os serve`. It uses the existing v1 theme tokens (neo-industrial, technical brutalism) and TanStack DB + TanStack Query for aggressive prefetch and caching. It prioritizes fast local interactions, offline read resilience, and low-latency updates via SSE/WS.

---

## Design System (Use Existing Theme)

Theme source: `webapp/src/app.css`.

### Core Tokens (OKLCH)

- `--color-bg-primary` = `oklch(0.13 0 0)`
- `--color-bg-secondary` = `oklch(0.16 0 0)`
- `--color-surface-primary` = `oklch(0.18 0 0)`
- `--color-surface-secondary` = `oklch(0.22 0 0)`
- `--color-text-primary` = `oklch(0.9 0 0)`
- `--color-text-muted` = `oklch(0.55 0 0)`
- `--color-text-dim` = `oklch(0.4 0 0)`
- `--color-accent` = `oklch(0.7 0.18 45)`
- `--color-accent-muted` = `oklch(0.5 0.12 45)`
- `--color-accent-subtle` = `oklch(0.3 0.08 45)`
- `--color-status-active` = `oklch(0.7 0.18 45)`
- `--color-status-blocked` = `oklch(0.65 0.2 25)`
- `--color-status-done` = `oklch(0.65 0.12 145)`
- `--color-border` = `oklch(0.28 0 0)`
- `--color-border-focus` = `oklch(0.7 0.18 45)`

### Typography

- `--font-display`: JetBrains Mono (display), no new fonts.
- `--font-body`: JetBrains Mono (body).
- `--font-mono`: JetBrains Mono (code).

### Aesthetic Rules

- Dark-only UI.
- Hard edges, thick borders, no rounded corners unless already in theme.
- Orange accent for active states, highlights, focus rings.

---

## Architecture

- SPA served by `os serve` (embedded static files).
- REST for CRUD, SSE for events, Relay WS for sessions/comments.
- TanStack DB is the reactive client store, backed by TanStack Query.
- Query cache persistence provides offline read continuity.

### Diff Rendering

- Use `@pierre/diffs` for diff rendering in the review view.
- Enable WorkerPool + Virtualizer for perf (Shiki in workers, virtualized lines).
- Theme: `pierre-dark` (dark-only UI).

### Local DB (Client)

Use TanStack DB as the in-memory reactive DB:

- `@tanstack/react-db` for collections + `useLiveQuery`.
- `@tanstack/query-db-collection` for server-backed collections.
- `localStorageCollectionOptions` for local-only UI preferences.

Persistence:

- Use TanStack Query persistence to IndexedDB (`@tanstack/query-persist-client` + `idb-keyval`).
- Persist QueryCache + MutationCache.
- Versioned storage keys (e.g., `ui.cache.v1`).

Optional: LocalStorage collections for lightweight persistent UI state.

---

## TanStack DB Integration

### Collections

- **Server-backed**: `queryCollectionOptions` with `queryFn`, `getKey`, `queryClient`.
- **Local-only**: `localStorageCollectionOptions` for user prefs, layout, filters.

Example collections:

- `tasksCollection`
- `reviewsCollection`
- `commentsCollection`
- `gatesCollection`
- `helpCollection`
- `reposCollection`
- `eventsCollection` (read-only stream for UI)
- `sessionsCollection` (relay sessions)
- `uiPrefsCollection` (localStorage)

### Live Queries

- Use `useLiveQuery` for UI views (lists, kanban, detail panels).
- Live queries update when collections change via REST or SSE updates.

### Sync Mode (On-Demand)

- Use `syncMode: "on-demand"` for large collections.
- Parse `loadSubsetOptions` via `parseLoadSubsetOptions` to push down filters/sorts/limits.
- Query key builder should include filters and pagination to avoid cache collisions.
 - `queryFn` receives `ctx.meta.loadSubsetOptions` (TanStack DB contract).

### Direct Writes (SSE/WS)

- Apply SSE/WS events with `collection.utils.writeBatch`.
- Avoid refetch on event updates (`return { refetch: false }` in handlers).
- Use `writeUpsert` for partial updates.
 - Direct writes update Query cache immediately.

### Query Collection Invariants

- `queryFn` returns full state for the query key.
- Empty array means delete all items for that key.
- Partial fetch must merge with existing cache before returning.
- Direct writes must be compatible with future query sync.

---

## Data Fetching and Caching

### React Performance Rules

- Prefer parallel data fetching and prefetch on user intent.
- Avoid barrel imports for large modules.
- Memoize expensive derived state; prefer derived booleans over raw state.
- Use `useLiveQuery` to avoid extra effects and reduce waterfalls.

### Query Defaults

```
staleTime: 10m
gcTime: 7d
retry: 2
refetchOnWindowFocus: false
refetchOnReconnect: true
```

### Aggressive Prefetch

- Task list: prefetch details for visible rows and next page.
- Hover/focus on task: prefetch task detail + active review + gates.
- Enter review view: prefetch comments + gate results + diff.
- Use `collection.utils.refetch()` for targeted subsets.
- On SSE event: write to collections, avoid full refetch.

### Offline Read Behavior

- If network unavailable, serve from local cache.
- Mutations are queued and retried when online.
- LocalStorage collections keep UI prefs available offline.

---

## UI Composition

### Layout

- Left rail: repo selector + filters + navigation.
- Center: task list/graph/kanban views.
- Right: detail panel (context, learnings, review, gates, help).

### Views

- Tasks: list + filters + quick actions.
- Task Detail: context, blockers, gates, reviews, help requests.
- Review: diff + comments + approve/request changes.
- Events: stream log (tail with filters).
- Relay: active sessions + harness status.

---

## Route Map

Routes are local-first and read from TanStack DB collections.

- `/` -> Redirect `/tasks`
- `/repos` -> Repo list + register/unregister
- `/tasks` -> Task list + filters
- `/tasks/:id` -> Task detail panel
- `/tasks/:id/review` -> Review diff + comments
- `/tasks/:id/gates` -> Gate results + rerun
- `/events` -> Event stream tail + filters
- `/relay` -> Harness status + sessions
- `/settings` -> UI prefs (localStorage collection)

Prefetch:
- On hover of task row -> prefetch `/tasks/:id` + active review + gates.
- On route enter -> prefetch adjacent panels (detail, review).

---

## Component Tree (Top-Level)

```
AppShell
  LeftRail
    RepoSwitcher
    Nav
    Filters
  CenterPane
    TaskListView | KanbanView | TaskGraphView
  RightPane
    TaskDetailPanel
      ContextPanel
      GatePanel
      ReviewPanel
      HelpPanel
      LearningsPanel
```

Route-scoped panels:

- Review route mounts `DiffViewer` + `CommentsPanel`.
- Relay route mounts `HarnessList` + `SessionTimeline`.
- Events route mounts `EventStream`.

---

## Data Bindings (Collections)

- `tasksCollection` -> Task list, detail
- `reviewsCollection` -> Review panels
- `commentsCollection` -> Review comments
- `gatesCollection` + `gateResultsCollection` -> Gate panel
- `helpCollection` -> Help panel
- `learningsCollection` -> Learnings panel
- `reposCollection` -> Repo switcher
- `eventsCollection` -> Event stream
- `sessionsCollection` -> Relay panel
- `uiPrefsCollection` (localStorage) -> UI prefs, layout

---

## TanStack DB Research Notes

### Packages

- `@tanstack/react-db` for collections + `useLiveQuery`.
- `@tanstack/query-db-collection` for server-synced collections.
- `@tanstack/query-core` or `@tanstack/react-query` for QueryClient.

### Query Collection Contract

- Required: `queryKey`, `queryFn`, `queryClient`, `getKey`.
- Optional: `syncMode: "on-demand"`, `meta`, `onInsert`, `onUpdate`, `onDelete`.
- `queryFn` returns **full state** for that query key.
- Empty array means **delete all** for that query key.

### On-Demand Sync

- `ctx.meta.loadSubsetOptions` contains `where`, `orderBy`, `limit`, `offset`.
- Use `parseLoadSubsetOptions` or `parseWhereExpression` + `parseOrderByExpression` to build API params.

### Optimistic Mutations

- `collection.insert/update/delete` apply locally immediately.
- Handlers (`onInsert`/`onUpdate`/`onDelete`) sync to server.
- On handler failure, optimistic changes roll back.
- Return `{ refetch: false }` when server response is already written via `writeBatch`.

### Direct Writes

- `collection.utils.writeInsert/Update/Delete/Upsert` write to synced store directly.
- `writeBatch` groups writes atomically; ideal for SSE/WS updates.
- Direct writes update Query cache immediately.

### LocalStorage Collections

- `localStorageCollectionOptions` for local-only state (prefs, layout).
- Cross-tab sync via storage events.
- Optional schema validation with Standard Schema compatible types.

---

## Accessibility

- Roving tabindex for lists and grids.
- `prefers-reduced-motion` disables animations.
- Decorative icons are `aria-hidden`.
- Keyboard navigation first-class (j/k, arrows).

---

## REST/OpenAPI Endpoints (Full Catalog)

All endpoints are under `/api`.

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

### Agent Primitives
- `POST /agents/register`
- `GET /agents/capabilities`
- `POST /sessions`
- `POST /sessions/{id}/heartbeat`
- `POST /sessions/{id}/complete`

---

## Invariants

- UI must not diverge from theme tokens.
- Cache persistence must be versioned.
- SSE events are source of truth for invalidation.

---

**Phase: DRAFT v1 | Status: Ready for review**
