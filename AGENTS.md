## Core principles

### Simple composable primitives

Favor a small set of simple, generic primitives that compose cleanly over opinionated, workflow-specific features. Build the building blocks first (issues, labels, parent/child, blocking, assignee, timeline, structured filters); let higher-level workflows (Wayfinder maps, triage, agent harnesses) emerge as conventions and compositions on top. Grow opinionation only when real use proves a primitive is missing — not by baking one workflow into the product model.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `dmmulroy/overseer` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
