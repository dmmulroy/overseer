# Vite+ 0.2.7 monorepo task configuration for Overseer

## Verdict

Keep `@overseer/api`'s Alchemy commands as package-local scripts and start the server with `vp run @overseer/api#dev` (optionally exposed as the root `dev` script). Do **not** use `vp dev`: that is Vite+'s built-in Vite server, not the package's Alchemy script.

Change the root cache policy from `cache: true` to `{ tasks: true, scripts: false }`. This preserves caching for deterministic configured tasks while preventing Vite Task from caching deployment, destruction, and other package scripts indiscriminately. Also set `sync:yaak` to `cache: false`: it mutates external Yaak state, and its current `output: []` does not prevent Vite Task from skipping the command on a cache hit.

Vite+ 0.2.7 has no `persistent` task property or readiness/dependent-service protocol. A long-running task is simply a foreground command; make it uncached (package scripts are uncached under the recommended policy), and use `--parallel` only when intentionally starting multiple independent servers.

## Scope and source baseline

This analysis targets the versions pinned by this repository: `vite-plus` and the `vite` alias are both `0.2.7` ([root `package.json`, lines 15–22](../../package.json#L15-L22)); the installed CLI also reports `vp v0.2.7`. Official Vite+ tag `v0.2.7` is commit [`c17e1c3`](https://github.com/voidzero-dev/vite-plus/tree/c17e1c3c7cf859a29dd32eb60e82dc8157449ac2).

Only first-party sources were used:

- the complete bundled Vite+ coding-agent instructions ([`packages/cli/AGENTS.md`, lines 1–20](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/packages/cli/AGENTS.md#L1-L20));
- the official [Run guide](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md), [Run config reference](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/config/run.md), [Monorepo guide](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/monorepo.md), [cache guide](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/cache.md), and [automatic tracking guide](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/automatic-data-tracking.md);
- the v0.2.7 [CLI help snapshot](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/crates/vite_cli_snapshots/tests/cli_snapshots/fixtures/command_run_help/snapshots/command_run_help.md#L3-L41), official monorepo template, and pinned Vite Task source where needed.

The official agent instructions are short but decisive: built-ins use `vp <name>`, while scripts/configured tasks use `vp run <name>`; agents should inspect `package.json` and `vite.config.ts` before choosing ([agent instructions, lines 5–18](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/packages/cli/AGENTS.md#L5-L18)).

## Repository assessment

### Workspace shape

The pnpm workspace declaration includes `apps/*` and `packages/*` ([`pnpm-workspace.yaml`, lines 1–3](../../pnpm-workspace.yaml#L1-L3)), matching root `package.json#workspaces` ([lines 5–8](../../package.json#L5-L8)). This is valid and matches the first-party monorepo template's approach, which declares workspace globs in both files for pnpm ([template `package.json`, lines 5–9](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/packages/cli/templates/monorepo/package.json#L5-L9), [template `pnpm-workspace.yaml`, lines 1–4](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/packages/cli/templates/monorepo/pnpm-workspace.yaml#L1-L4)). No workspace declaration change is needed.

There is currently one workspace member, `@overseer/api`. Its app-specific commands correctly live in that package: `dev`, `deploy`, `destroy:production`, `check`, and `test` ([`apps/api/package.json`, lines 1–12](../../apps/api/package.json#L1-L12)). The monorepo guide explicitly recommends package-local scripts where development/build/test behavior differs by app ([monorepo guide, lines 146–174](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/monorepo.md#L146-L174)). Do not move the Alchemy commands to the root task table merely for centralization.

If internal workspace packages are added later, declare actual app-to-package relationships in ordinary `dependencies`, `devDependencies`, or `peerDependencies`. Vite+ derives ordering from that package graph rather than a separate runner graph ([Run guide, lines 156–191](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L156-L191)).

### Built-ins versus package scripts

`vp dev` always invokes the built-in Vite dev server. `vp run dev` invokes the `dev` script/task selected in the current package, and `vp run @overseer/api#dev` explicitly invokes the API package's script ([Run guide, lines 41–54 and 156–169](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L41-L54)). Therefore, from the repository root:

```sh
vp run @overseer/api#dev
```

runs:

```sh
alchemy dev --stage local
```

The latter command is already correctly owned by `apps/api/package.json`. `cd apps/api && vp run dev` is equivalent. A filter is valid but more verbose:

```sh
vp run --filter @overseer/api dev
```

The exact `package#task` selector is preferable when selecting one known package. Package selectors, name/directory/glob filters, dependency/dependent traversal, `-r`, `-t`, and `-w` are all first-class in 0.2.7 ([Run guide, lines 156–227](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L156-L227); [CLI help, lines 8–39](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/crates/vite_cli_snapshots/tests/cli_snapshots/fixtures/command_run_help/snapshots/command_run_help.md#L8-L39)).

### Root scripts

The existing root scripts are structurally sound:

- `check` runs the root built-in check and recursively runs every package's `test` script;
- `ready` composes `check` through nested `vp run`;
- root `test` owns the root-only Oxlint plugin tests.

Vite Task understands nested `vp run`, expands nested tasks rather than spawning opaque nested runners, and supports root aggregate scripts containing recursive runs ([Run guide, lines 229–300](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L229-L300)). `vp run -r test` is therefore appropriate. Recursive selection means all packages in dependency order; it is not required to reach just the API.

Add a root convenience script if `dev` should be the normal repository entrypoint. This follows the official monorepo template, whose root `dev` script delegates to one package's `dev` script ([template `package.json`, lines 11–14](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/packages/cli/templates/monorepo/package.json#L11-L14)):

```json
{
  "scripts": {
    "check": "vp check && vp run -r test",
    "dev": "vp run @overseer/api#dev",
    "ready": "vp run check",
    "test": "vp test run tools/oxlint"
  }
}
```

Then use `vp run dev` from the root. This script is optional; the explicit package selector remains the canonical no-config command.

Do not add a same-named configured task and script to the **same package**. Vite+ rejects that graph ([conflict snapshot, lines 3–10](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/crates/vite_cli_snapshots/tests/cli_snapshots/fixtures/run_task_command_conflict/snapshots/run_task_command_conflict.md#L3-L10); [Run config, lines 85–116](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/config/run.md#L85-L116)). A root `dev` script does not conflict with `@overseer/api#dev`, because they belong to different packages.

### Cache policy

Current `run.cache: true` ([`vite.config.ts`, lines 18–30](../../vite.config.ts#L18-L30)) enables caching for both configured tasks and every `package.json` script. Vite+'s normal defaults are `{ scripts: false, tasks: true }`; `true` broadens caching to scripts ([Run config, lines 39–57](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/config/run.md#L39-L57); [cache guide, lines 23–45](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/cache.md#L23-L45)). The first-party scaffold does use `cache: true` ([template config, lines 1–7](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/packages/cli/templates/monorepo/vite.config.ts#L1-L7)), but that broad starter default is unsafe for this repository's successful side-effect scripts:

- `deploy` changes production infrastructure;
- `destroy:production` destroys production infrastructure;
- `dev` is a long-running service;
- `sync:yaak` changes state outside the repository.

A successful cached invocation may be skipped later if its fingerprint matches. Per-task `cache: false` cannot be overridden, while `--cache` otherwise enables scripts too ([cache guide, lines 27–40](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/cache.md#L27-L40)). Keep side-effecting Alchemy operations as uncached scripts by restoring the category default explicitly:

```ts
run: {
  cache: {
    scripts: false,
    tasks: true,
  },
  // ...
}
```

This also means the Alchemy dev server is uncached without duplicating it as a configured task. `vp run --cache @overseer/api#deploy` could still force caching, so do not use `--cache` for side-effect scripts. If future policy requires making that impossible even under `--cache`, convert each side-effect operation to a configured package task with `cache: false`; that requires a package-local config and removal/renaming of the conflicting script.

### `generate:openapi` and `sync:yaak`

`generate:openapi` is a good configured task: it is deterministic, should cache, and produces a repository file. Its command array is correctly an array of **two sequential shell commands**, not argv tokens ([Run config, lines 85–116](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/config/run.md#L85-L116)). Keep:

```ts
"generate:openapi": {
  command: [
    "node apps/api/scripts/generate-openapi.ts",
    "vp fmt apps/api/openapi.json",
  ],
  output: ["apps/api/openapi.json"],
},
```

The task belongs to the root package, so the current root-relative paths are correct. Omitting `input` is preferable here: Vite Task automatically tracks files read, missing probes, directory listings, and writes, while explicit inputs replace automatic inference unless `{ auto: true }` is retained ([automatic tracking guide, lines 20–50 and 52–88](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/automatic-data-tracking.md#L20-L50)). That matters because the generator imports the API model transitively, not just its entry script.

`sync:yaak` is not cacheable. It invokes Yaak repeatedly and mutates workspaces, requests, and environments outside the repository ([sync script, lines 23–26 and 95–187](../../apps/api/scripts/sync-yaak-openapi.ts#L23-L26)). Its current explicit `input` cannot represent external Yaak state. More importantly, `output: []` does **not** disable caching: it disables output restoration but still lets a cache hit skip the command and replay logs ([Run config, lines 289–345](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/config/run.md#L289-L345)). Replace its cache/input/output fields with:

```ts
"sync:yaak": {
  command: "node apps/api/scripts/sync-yaak-openapi.ts",
  cache: false,
  dependsOn: ["generate:openapi"],
},
```

`dependsOn: ["generate:openapi"]` correctly means the same package's task and should remain ([Run guide, lines 118–154](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L118-L154)). There is no need for object-form package dependency expansion here.

## Exact recommended files

### Root `package.json#scripts`

```json
{
  "check": "vp check && vp run -r test",
  "dev": "vp run @overseer/api#dev",
  "ready": "vp run check",
  "test": "vp test run tools/oxlint"
}
```

Only `dev` is new. Keep `apps/api/package.json#scripts` unchanged.

### Root `vite.config.ts#run`

```ts
run: {
  cache: {
    scripts: false,
    tasks: true,
  },
  tasks: {
    "generate:openapi": {
      command: [
        "node apps/api/scripts/generate-openapi.ts",
        "vp fmt apps/api/openapi.json",
      ],
      output: ["apps/api/openapi.json"],
    },
    "sync:yaak": {
      command: "node apps/api/scripts/sync-yaak-openapi.ts",
      cache: false,
      dependsOn: ["generate:openapi"],
    },
  },
},
```

No `input`/`output` changes are needed for `generate:openapi`; remove them from `sync:yaak` because caching is disabled.

## Recommended commands

```sh
# Start only the API's long-running Alchemy local server
vp run @overseer/api#dev

# Same operation after adding the recommended root convenience script
vp run dev

# Equivalent directory-local form
(cd apps/api && vp run dev)

# Run one API package script explicitly
vp run @overseer/api#test
vp run @overseer/api#check
vp run @overseer/api#deploy
vp run @overseer/api#destroy:production

# Run all packages' same-named scripts/tasks in dependency order
vp run -r test

# Run one package and workspace dependencies that also define the same task
vp run -t @overseer/api#test

# Filter form; fail rather than silently succeeding on a selector typo
vp run --fail-if-no-match --filter @overseer/api test

# Root task definitions
vp run -w generate:openapi
vp run -w sync:yaak

# Whole repository validation
vp run ready
```

`-w` is explicit but optional when already at the root; without selection flags, Vite+ selects the package containing the current directory ([Run guide, lines 156–169 and 221–227](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L156-L169)).

For multiple independent long-running package servers, use a filtered recursive/parallel run, for example `vp run -r --parallel dev`. `--parallel` deliberately removes dependency ordering and is unlimited unless paired with `--concurrency-limit` ([Run guide, lines 337–363](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L337-L363)). It is unnecessary for the single API server and should not be used as a generic speed flag where ordering matters.

## v0.2.7 limitations and traps

1. **No persistent-task schema.** Vite+ v0.2.7 pins Vite Task revision [`5c1d02c`](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/Cargo.toml#L308-L312). Its complete task options are `cwd`, `dependsOn`, and cache options (`cache`, `env`, `untrackedEnv`, `input`, `output`); there is no `persistent` property ([pinned Vite Task schema, lines 189–307](https://github.com/voidzero-dev/vite-task/blob/5c1d02c750ac21c6f4cf0528062590a145e87fd1/crates/vite_task_graph/src/config/user.rs#L189-L307)). Do not copy Turborepo-style `persistent: true` configuration into Vite+ 0.2.7.
2. **No service readiness dependency.** `dependsOn` requires prerequisite tasks to complete successfully before the dependent starts ([Run config, lines 118–155](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/config/run.md#L118-L155)). A dev server does not complete, so never make a finite task depend on `dev` expecting “server is ready.” Start independent servers with `--parallel`, or use a purpose-built process/readiness wrapper outside Vite Task.
3. **Disable cache, do not use `output: []`, for effects.** `output: []` still skips execution on a cache hit ([Run config, lines 334–345](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/config/run.md#L334-L345)).
4. **Put runner flags before the task name.** The 0.2.7 CLI grammar treats everything after the task specifier as additional task arguments ([CLI help, lines 8–29](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/crates/vite_cli_snapshots/tests/cli_snapshots/fixtures/command_run_help/snapshots/command_run_help.md#L8-L29)). The first-party argument-order snapshot confirms `vp run -r hello` is recursive, whereas `vp run hello -r` forwards `-r` rather than selecting recursively ([snapshot, lines 1–28](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/crates/vite_cli_snapshots/tests/cli_snapshots/fixtures/command_run_argument_order/snapshots/command_run_argument_order.md#L1-L28)).
5. **`-t` does not invent setup tasks.** It selects the package and transitive workspace dependencies and runs the requested same-named task where defined. Relationships come from package manifests ([Run guide, lines 171–191](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L171-L191)). Use `dependsOn` when one named task must precede another; use `-t` to expand package selection.
6. **No-match filters succeed by default.** Use `--fail-if-no-match` in CI or safety-sensitive commands ([Run guide, lines 193–220](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/run.md#L193-L220)). Exact `package#task` selection is clearer for the API.
7. **Caching only applies through `vp run`.** Vite Task caches tasks/scripts run through `vp run`; direct built-ins such as `vp build` only participate when they are commands inside a cache-enabled task ([cache guide, lines 1–13](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/cache.md#L1-L13)). This does not alter the recommendation for the uncached Alchemy server.
