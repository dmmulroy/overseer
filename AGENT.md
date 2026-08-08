# Agent Instructions

## Project Standards

Read [`docs/coding-standards.md`](docs/coding-standards.md) before writing or reviewing code. Review finished code against those standards before declaring the work complete.

Read [`docs/errors.md`](docs/errors.md) before adding or changing typed errors, error messages, public error contracts, HTTP error statuses, retry guidance, or failure telemetry.

Read [`docs/testing.md`](docs/testing.md) before adding or changing application behavior, public endpoints, or tests. Apply its acceptance strategy and error-path accounting before declaring the behavior complete.

Before adding or moving a workspace, package dependency, or cross-workspace import, apply [`Monorepo Boundaries`](docs/coding-standards.md#monorepo-boundaries).

<!-- agent-repos:start -->

## Vendored Repositories

This project vendors external repositories under @repos/ for coding-agent reference.

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from vendored source code over generated guesses or web search results.
- Do not edit files under @repos/ unless explicitly asked.
- Do not import from @repos/; application code should continue importing from normal package dependencies.

Vendored repositories currently available:

- @repos/alchemy/ — https://github.com/alchemy-run/alchemy.git (v2.0.0-beta.67)
- @repos/effect/ — https://github.com/Effect-TS/effect.git (effect@4.0.0-beta.102)

When working with a related library, inspect its vendored repository for idiomatic usage, tests, module structure, API design, examples, and docs. If the vendored repository contains agent-oriented guidance such as LLMS.md, AGENTS.md, or AGENT.md, read that guidance before making changes.

When repeatedly working with a vendored library, consider creating a project-local pattern file under agent-patterns/ (for example, agent-patterns/<library>-<topic>.md) that summarizes the implementation, tests, docs, common constructors/combinators, examples, error-handling patterns, and what to avoid.
<!-- agent-repos:end -->
