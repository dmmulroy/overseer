# Vite+ Tasks in an `apps/` + `packages/` monorepo

## Terminology

“VET tasks” is very likely a typo, mishearing, or informal shorthand for **Vite+ Tasks**. The official product names are **Vite Task** (the task engine) and `vp run` / “Vite+ Task Runner”; the official docs do not call it “VET.” ([Getting Started](https://viteplus.dev/guide/), [`vp run`](https://viteplus.dev/guide/run))

## Recommended starting point

Scaffold with:

```sh
vp create vite:monorepo
```

This is the documented built-in monorepo template. The current first-party scaffold registers `apps/*`, `packages/*`, and `tools/*`, creates `apps/website` and `packages/utils`, and puts shared Vite+ configuration at the root. For pnpm it writes those globs to `pnpm-workspace.yaml`; npm and Bun use root `package.json#workspaces`, while Yarn keeps `package.json#workspaces`. ([Create guide](https://viteplus.dev/guide/create#built-in-templates), [template `package.json`](https://github.com/voidzero-dev/vite-plus/blob/main/packages/cli/templates/monorepo/package.json), [template pnpm workspace](https://github.com/voidzero-dev/vite-plus/blob/main/packages/cli/templates/monorepo/pnpm-workspace.yaml), [scaffold implementation](https://github.com/voidzero-dev/vite-plus/blob/main/packages/cli/src/create/templates/monorepo.ts))

## Configuration model

- Keep a root `vite.config.ts` for shared defaults and `run` task definitions. Packages may still have their own `vite.config.ts` for app-, framework-, runtime-, Vite-, or Vitest-specific behavior. ([Monorepo guide](https://viteplus.dev/guide/monorepo))
- Keep each workspace member named in its `package.json`, and declare internal package relationships through ordinary `dependencies`, `devDependencies`, or `peerDependencies`. Vite+ derives its workspace graph from those normal package relationships; there is no second task-runner-only package graph. ([Workspace execution](https://viteplus.dev/guide/run#running-in-a-workspace))
- Supporting packages belong under `packages/*`; runnable entry points belong under `apps/*`. Both must be included in the package manager's workspace declaration. The official scaffold also reserves `tools/*`. ([template `package.json`](https://github.com/voidzero-dev/vite-plus/blob/main/packages/cli/templates/monorepo/package.json))

A suitable root configuration (when members do not also define same-named `build`/`dev` scripts) is:

```ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    cache: true,
    tasks: {
      build: {
        command: "vp build",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
      dev: {
        command: "vp dev",
        cache: false,
      },
    },
  },
});
```

The current official monorepo template sets `run.cache: true`, enabling caching for both configured tasks and `package.json` scripts. ([template config](https://github.com/voidzero-dev/vite-plus/blob/main/packages/cli/templates/monorepo/vite.config.ts), [Run config](https://viteplus.dev/config/run#run-cache))

## Scripts, tasks, and ordering

- `vp run <name>` runs either a same-named `package.json` script or a task from `run.tasks`. A name cannot exist in both places. Use package scripts when the command differs by app/package; use a configured task when caching, `dependsOn`, environment, input, or output controls are needed. Tasks may use a command string, command array, or full object. ([Task definitions](https://viteplus.dev/guide/run#task-definitions), [`run.tasks`](https://viteplus.dev/config/run#run-tasks))
- Built-ins and scripts are distinct: `vp build` invokes Vite+'s built-in build, while `vp run build` invokes the configured task/script. Only work invoked through `vp run` participates in Vite Task caching. ([Built-ins vs scripts](https://viteplus.dev/guide/run#built-in-commands-vs-scripts), [Task cache guide](https://viteplus.dev/guide/cache))
- `dependsOn: ['build']` means the same package's task; `@scope/core#build` names another package explicitly. `{ task: 'build', from: 'dependencies' }` expands to matching tasks in direct workspace dependencies; `from` may also include `devDependencies` and `peerDependencies`. ([Task dependencies](https://viteplus.dev/guide/run#task-dependencies), [`dependsOn` reference](https://viteplus.dev/config/run#dependson))
- `vp run -r build` selects all workspace packages and schedules them in dependency order. `vp run -t @scope/app#build` selects the app plus all transitive workspace dependencies. `--parallel` intentionally ignores dependency ordering. ([Workspace execution](https://viteplus.dev/guide/run#running-in-a-workspace), [Parallel mode](https://viteplus.dev/guide/run#parallel-mode))

## Root tasks

Without selection flags, `vp run` targets the package containing the current directory. Use `-w` / `--workspace-root` to select the root explicitly:

```sh
vp run -w ready
```

A root aggregate script such as `"build": "vp run -r build"` is supported. Although recursive selection includes the root, Vite Task detects and prunes the aggregate script's self-reference. The official scaffold uses the same pattern for its root `ready` script. ([Workspace root and nested runs](https://viteplus.dev/guide/run#workspace-root-w), [compound/nested commands](https://viteplus.dev/guide/run#nested-vp-run), [template `package.json`](https://github.com/voidzero-dev/vite-plus/blob/main/packages/cli/templates/monorepo/package.json))

## Caching

- Defaults are `cache.tasks: true` and `cache.scripts: false`; `run.cache: true` enables both. `--cache` enables both for one invocation, `--no-cache` disables both, and a task's `cache: false` cannot be overridden. Long-running `dev` tasks should set `cache: false`. ([When caching is enabled](https://viteplus.dev/guide/cache#when-is-caching-enabled), [`run.cache`](https://viteplus.dev/config/run#run-cache))
- Successful tasks cache logs and written files. Cache hits replay logs and restore outputs. Arguments, fingerprinted environment variables, and tracked inputs determine validity. Vite Task automatically observes file reads/writes; use `input`, `output`, `env`, and `untrackedEnv` only where automatic tracking is insufficient. Standard `vp build` tasks cooperatively report Vite inputs, outputs, `VITE_*`, and `NODE_ENV`. ([Task caching](https://viteplus.dev/guide/cache), [Automatic data tracking](https://viteplus.dev/guide/automatic-data-tracking))
- The cache lives at root `node_modules/.vite/task-cache`; clear it with `vp cache clean`. ([Cache commands](https://viteplus.dev/guide/cache#cache-commands))

## Useful selection forms

```sh
vp run @scope/web#build                 # exact package and task
vp run -r build                         # every workspace package
vp run -t @scope/web#build              # app plus transitive dependencies
vp run --filter ./apps/web build        # directory
vp run --filter '@scope/*' build        # package-name glob
vp run --filter '@scope/web...' build   # package plus dependencies
vp run --filter '...@scope/core' build  # package plus dependents
vp run --filter '@scope/*' --filter '!@scope/legacy' build
```

Multiple positive filters form a union; exclusions apply afterward. A no-match filter warns but exits successfully unless `--fail-if-no-match` is supplied. ([Filter reference](https://viteplus.dev/guide/run#filter---filter))

## Practical recommendation

Declare `apps/*` and `packages/*` as native package-manager workspaces, model every app-to-package relationship in `package.json`, keep app/package-specific commands with their package, and expose shared cacheable orchestration through root `run.tasks`. Use `vp run -t <app>#build` for a single deployable and its prerequisites, `vp run -r build` for whole-repo CI, and filtered `--parallel dev` only for independent long-running development processes.
