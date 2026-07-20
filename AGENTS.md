## Core principles

### Simple composable primitives

Favor a small set of simple, generic primitives that compose cleanly over opinionated, workflow-specific features. Build the building blocks first (issues, labels, parent/child, blocking, assignee, timeline, structured filters); let higher-level workflows, abstractions, and patterns emerge as conventions and compositions on top. Grow opinionation only when real use proves a primitive is missing — not by baking one workflow into the product model.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `dmmulroy/overseer` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Code completion

Before declaring code changes complete:

1. Run `npm run check`.
2. All added or changed code must follow the `coding-standards` skill and, where applicable, the `effect` skill and its matching references. Effect code must follow the project's established service/tag/layer and `Effect.fn` patterns rather than inventing nearby variants.
3. This is an Effect-native project built with Alchemy v2. Use idiomatic Effect and Alchemy APIs. Do not drop to `async`/`await` or raw Promise workflows unless an external boundary makes it unavoidable; isolate such code in the owning Adapter. Before deviating from native patterns, check the source and examples in `repos/effect` and `repos/alchemy`, listed in `.agent-repos`.
4. Audit each new module, service, abstraction, helper, function, and combinator. Confirm that an existing module cannot own the behavior, that the behavior is not already implemented elsewhere, and that the new interface hides enough complexity to earn its place.
5. Parse untrusted input at the outer boundary and pass parsed domain values inward.
6. Prefer Effect `Option` for optional results instead of returning `null` or `undefined`.
7. Keep interfaces small. Each parameter, option, function, and combinator must earn its place.
8. Prefer the simplest correct design and the least code. Remove pass-through layers, speculative seams, and duplication.
9. Fix or report any exception. Passing automated checks alone does not prove compliance.

## Writing

Follow George Orwell's six rules for writing:

1. Never use a metaphor, simile, or other figure of speech which you are used to seeing in print.
2. Never use a long word where a short one will do.
3. If it is possible to cut a word out, always cut it out.
4. Never use the passive where you can use the active.
5. Never use a foreign phrase, a scientific word, or a jargon word if you can think of an everyday English equivalent.
6. Break any of these rules sooner than say anything outright barbarous.

<!-- agent-repos:start -->
## Vendored Repositories

This project vendors external repositories under @repos/ for coding-agent reference.

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from vendored source code over generated guesses or web search results.
- Do not edit files under @repos/ unless explicitly asked.
- Do not import from @repos/; application code should continue importing from normal package dependencies.

Vendored repositories currently available:
- @repos/effect/ — https://github.com/Effect-TS/effect (main)
- @repos/alchemy/ — git@github.com:alchemy-run/alchemy.git (main)

When working with a related library, inspect its vendored repository for idiomatic usage, tests, module structure, API design, examples, and docs. If the vendored repository contains agent-oriented guidance such as LLMS.md, AGENTS.md, or AGENT.md, read that guidance before making changes.

When repeatedly working with a vendored library, consider creating a project-local pattern file under agent-patterns/ (for example, agent-patterns/<library>-<topic>.md) that summarizes the implementation, tests, docs, common constructors/combinators, examples, error-handling patterns, and what to avoid.
<!-- agent-repos:end -->
