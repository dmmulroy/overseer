# Alchemy local runtime dependency updates

Date: 2026-07-29

## Findings

### Vite Plus and the installed workerd

Vite Plus's dependency-maintenance command is `vp update [packages...]` (alias `vp up`). Add `--latest` (`-L`) only when intentionally ignoring the declared semver range. `vp outdated` is the matching read-only check. Vite Plus delegates these operations to the package manager selected from `package.json`/the lockfile; this repository selects npm 12 through `devEngines.packageManager` ([Vite Plus install guide](https://viteplus.dev/guide/install), [`package.json`](../../package.json)).

For this repository, updating the package named `workerd` alone is not sufficient. Alchemy 2 beta.64 depends on `@distilled.cloud/cloudflare-runtime@0.13.8`, and that package pins `workerd` exactly to `1.20260704.1` ([Alchemy metadata](../../node_modules/alchemy/package.json), [runtime metadata](../../node_modules/@distilled.cloud/cloudflare-runtime/package.json), [lockfile](../../package-lock.json#L1180-L1188)). `vp why workerd` confirms that this exact runtime dependency owns the root `node_modules/workerd`; Miniflare separately owns its nested `workerd@1.20260722.1`. Alchemy's local runtime imports `workerd` from `@distilled.cloud/cloudflare-runtime`, so normal Node resolution selects the root copy, not Miniflare's nested copy ([runtime adapter](../../node_modules/@distilled.cloud/cloudflare-runtime/src/workerd/internal/workerd.ts), [root workerd loader](../../node_modules/workerd/lib/main.js)). On this machine, that loader selects the optional platform package `@cloudflare/workerd-darwin-arm64@1.20260704.1`, which contains the native executable ([workerd metadata](../../node_modules/workerd/package.json), [platform metadata](../../node_modules/@cloudflare/workerd-darwin-arm64/package.json)).

Registry checks on 2026-07-29 found `workerd@1.20260729.1`, but the latest Alchemy v2 release is `2.0.0-beta.65` and its upgraded `@distilled.cloud/cloudflare-runtime@0.13.10` still pins `workerd@1.20260704.1`. Reproduce with:

```sh
vp outdated workerd alchemy --long --format json
vp info alchemy@next version --json
vp info alchemy@next dependencies --json
vp info @distilled.cloud/cloudflare-runtime@0.13.10 dependencies --json
vp info workerd version --json
vp why workerd
```

Therefore:

- Use `vp update <direct-dependency>` for ordinary in-range updates and `vp update <direct-dependency> --latest` for an intentional range change ([Vite Plus command help](https://viteplus.dev/guide/install#update-dedupe-and-outdated)).
- Do **not** expect `vp update workerd --latest` to replace Alchemy's runtime while its owner requires an exact older version; npm update respects dependency constraints ([npm update](https://docs.npmjs.com/cli/v11/commands/npm-update#description)).
- A project-side runtime bump currently requires an explicit npm `overrides.workerd` pin followed by `vp install`, or an upstream `@distilled.cloud/cloudflare-runtime`/Alchemy release that raises its exact pin. Vite Plus should still perform the install; no update/install was run during this research.
- Do not use `vp update alchemy --latest` blindly: npm's `latest` tag is the older `0.93.12`; v2 is on the `next` tag. A deliberate v2 move should name it, for example `vp add -D alchemy@next`, after reviewing beta.65's unrelated changes.

### Self-referential Durable Object bindings

No available fix was found. Installed beta.64, published beta.65, the vendored newer source, and current upstream `main` all retain the precreate interpolation:

```ts
`${binding.scriptName!}-${binding.className}`;
```

That coercion is still present in beta.64 ([installed source](../../node_modules/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts#L658-L668)), beta.65's registry tarball, vendored source ([vendored source](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts#L658-L668)), and [current upstream main](https://github.com/alchemy-run/alchemy/blob/main/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts). For `Object.from(Self)`, `scriptName` is the host Worker's unresolved `workerName` Output, so precreate attempts forbidden JavaScript string coercion before reconciliation. The newer source refactors local Worker startup but does not resolve this precreate value.

Alchemy's own API guidance says the application usage is valid:

- Bare `yield* Object` and `yield* Object.from(Self)` resolve to the same local namespace inside the host.
- `.from(Self)` is preferred, especially for code that may move into a reusable Layer, because it makes the host explicit and preserves the same shape for local and cross-Worker consumers ([DurableObject API documentation](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts#L538-L574), [cross-Worker guide](../../repos/alchemy/website/src/content/docs/cloudflare/compute/cross-worker-durable-object.mdx#L271-L307)).
- Alchemy's tagged Durable Object and RPC fixtures deliberately use the self-reference form and call it recommended ([tagged fixture](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/tagged-do/workerC.ts), [RPC fixture](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/tagged-rpc-do/workerC.ts)).

Conclusion: bare `yield* Object` is a valid temporary way around the local-provider defect, but it is not the documented preferred replacement for `Object.from(Self)`. The failure belongs in Alchemy's `LocalWorkerProvider.precreate`; Overseer's self-reference is supported API usage. Updating from beta.64 to beta.65 does not fix it.
