## Core principles

### Simple composable primitives

Favor a small set of simple, generic primitives that compose cleanly over opinionated, workflow-specific features. Build the building blocks first (issues, labels, parent/child, blocking, assignee, timeline, structured filters); let higher-level workflows, abstractions, and patterns emerge as conventions and compositions on top. Grow opinionation only when real use proves a primitive is missing — not by baking one workflow into the product model.

Reserve “Project” for Overseer's domain abstraction. Do not use “project” or “projection” to mean mapping data into another type, representation, or view; name the target representation or transformation instead.

### Effect service modules

Where a real service exists, name it after a stable general capability, put specific behavior in operation names, and compose deeper services from simple capability services. Capability names describe what the dependency is and stay stable across callers; consumer-qualified names are prohibited, and architecture words such as `Repository`, `Gateway`, `Provider`, `Port`, or `Manager` are reserved for an actual established meaning rather than used as generic suffixes. Yield service dependencies through Effect context; use plain functions for pure or stateless module operations. Yield a concrete client directly while a separate adapter would only forward calls; extract the adapter when it hides real translation or mechanics, is reused, or supports actual implementation variation.

```ts
export interface Interface {
  /* smallest cohesive application-owned capability */
}
export class Service extends Context.Service<Service, Interface>()("...") {}
export const make = Effect.gen(function* () {
  /* yield service dependencies */
});
export const layer = Layer.effect(Service, make);
```

Add `layerTest` or `layerMemory` only when it is reusable and behaviorally honest.

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
2. All added or changed code must follow the `coding-standards` skill and every applicable generic and Effect reference it points to. For abstractions, adapters, and seams, use Effect services and layers—not function or constructor injection—and yield dependencies so their requirements propagate through Effects. Follow the project's established `Effect.fn` patterns rather than inventing nearby variants.
3. This is an Effect-native project built with Alchemy v2. Use idiomatic Effect and Alchemy APIs. Do not drop to `async`/`await` or raw Promise workflows unless an external boundary makes them unavoidable; isolate such code in the owning Adapter or localized service implementation that directly owns one concrete client. Before deviating from native patterns, check the source and examples in `repos/effect` and `repos/alchemy`, listed in `.agent-repos`.
4. Audit each new module, service, abstraction, helper, function, and combinator. Confirm that an existing module cannot own the behavior, that the behavior is not already implemented elsewhere, and that the new interface hides enough complexity to earn its place.
5. Parse untrusted input at the outer boundary and pass parsed domain values inward.
6. Prefer Effect `Option` for optional results instead of returning `null` or `undefined`.
7. Keep interfaces small. Each parameter, option, function, and combinator must earn its place.
8. Prefer the simplest correct design and the least code. Remove pass-through layers, speculative seams, and duplication.
9. Fix or report any exception. Passing automated checks alone does not prove compliance.

## Writing

Do not use jargon and speak coherently. Write and speak simply and concisely, like one human talking to another.

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
