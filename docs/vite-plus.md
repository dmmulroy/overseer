# Vite+ monorepo workflow

Vite+ owns repository checks and workspace task execution. The root `vite.config.ts` contains shared formatting, linting, type-checking, and Vite Task defaults; workspace `vite.config.ts` files own package-specific task graphs.

## Workspace boundaries

- `apps/*` contains independently runnable or deployable composition roots.
- `packages/*` contains cohesive capabilities shared by applications.
- Declare every workspace edge in the importing workspace's `package.json`; Vite Task uses this dependency graph for scheduling.
- Applications may depend on packages, but packages must not depend on applications.

## Commands

```sh
vp check
vp run ready
vp run @overseer/api#test:e2e:local
vp run @overseer/api#test:e2e:deployed
vp run @overseer/api#destroy:production
vp run @overseer/shared-infrastructure#plan:production
vp run @overseer/shared-infrastructure#deploy:production
vp run @overseer/test-trace-collector#plan:production
vp run @overseer/test-trace-collector#deploy:production
vp run @overseer/test-trace-collector#destroy:production
vp run @overseer/test-trace-collector#test:e2e:local
vp run @overseer/test-trace-collector#test:e2e:preview
```

`vp test`, `vp build`, and `vp dev` are built-in commands. `vp run <task>` executes a package script or configured Vite Task.

## Vite Task policy

Package scripts are uncached by default. Configured tasks are cached by default, but every task that deploys, destroys, plans, synchronizes external state, or starts a long-running process must set `cache: false`.

Alchemy infrastructure lifecycle commands belong in workspace Vite tasks rather than duplicate package scripts. Root aliases invoke those tasks through exact `package#task` selectors so every entrypoint uses the same dependency graph.

Cross-workspace infrastructure prerequisites belong in `dependsOn`. The API production deployment and production trace collector deployment depend on `@overseer/shared-infrastructure#deploy:production`. Both local and deployed API E2E tasks depend on the production trace collector deployment, transitively ensuring its reusable Cloudflare Access policy and service credentials exist before the harness verifies the collector connection. Shared-infrastructure commands require the non-sensitive `OVERSEER_ACCESS_ALLOWED_EMAIL` deploy-time environment variable. The Cloudflare deployment principal must have Account API Tokens Write permission so Alchemy can create the scoped account-owned token used by R2 Data Catalog maintenance and Pipelines sinks.

Runner flags precede task names. Use exact `package#task` selectors for infrastructure operations and `--fail-if-no-match` with filters in automation.
