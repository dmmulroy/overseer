# Enforcing the `apps/*` / `packages/*` monorepo boundary with Oxlint

**Research status:** complete, against the repository as inspected and the pinned Oxlint 1.76.0 source/API. No implementation, planning, or standards files were changed.

## Recommendation

Use **two checks with one shared boundary model**:

1. Add an `overseer/enforce-monorepo-boundaries` JavaScript-plugin rule for source-level module references.
2. Add a repository-level Vitest test for workspace `package.json` dependency edges.

Do not use `no-restricted-imports` as the primary enforcement mechanism. It is useful only as optional defense in depth for known app package names. Oxlint 1.76.0 does not contain `import/no-restricted-paths`, and `no-restricted-imports` compares the written specifier rather than the resolved target, so it cannot reliably catch relative traversal or TypeScript/package aliases.

The invariant should be represented as this decision table:

| Importer workspace | Target workspace | Result |
| ------------------ | ---------------- | ------ |
| `apps/A`           | `apps/A`         | allow  |
| `apps/A`           | `apps/B`         | reject |
| `apps/A`           | `packages/P`     | allow  |
| `packages/P`       | any `apps/A`     | reject |
| `packages/P`       | `packages/Q`     | allow  |
| app/package        | external         | allow  |

Apply the same table to source references and manifest edges. Type-only references are dependencies for architecture purposes and should not be exempt.

## Repository facts

- The root declares only `apps/*` and `packages/*` as workspaces in both [`package.json`](../../package.json) and [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml). At present there is one app, `@overseer/api`, and no package workspace beyond [`packages/.gitkeep`](../../packages/.gitkeep).
- Oxlint and `@oxlint/plugins` are pinned to **1.76.0** in the root [`package.json`](../../package.json), and the installed CLI reports 1.76.0.
- Vite+ 0.2.7 owns lint configuration through the root [`vite.config.ts`](../../vite.config.ts). It loads local TypeScript JS plugins under the `anti-slop` and `overseer` aliases. Vite+ documents that `vp lint` and `vp check` read this `lint` block and that root `lint.overrides` globs are workspace-root-relative ([Lint config](https://viteplus.dev/config/lint), [monorepo config](https://viteplus.dev/guide/monorepo#root-config-with-overrides)).
- The existing plugins and extracted rule modules use `definePlugin`, `defineRule`, `context.filename`, AST visitors, and `createOnce` under [`tools/oxlint`](../../tools/oxlint). Their colocated tests use Oxlint's native `RuleTester` from `oxlint/plugins-dev`.
- The root TypeScript setup uses `module: "Preserve"` and `moduleResolution: "Bundler"`, with no current `paths` aliases ([root `tsconfig.json`](../../tsconfig.json), [API `tsconfig.json`](../../apps/api/tsconfig.json)). The design still needs to handle future `paths` and package `imports` aliases.

## Built-in-rule comparison

### `no-restricted-imports`

Oxlint 1.76.0 includes native `eslint/no-restricted-imports`. The exact tagged source supports exact `paths`, gitignore-like `group` patterns, Rust regular expressions, custom messages, import-name restrictions, and optional type-import allowances. It examines normal imports, re-exports, TypeScript `import = require(...)`, and dynamic `import()` **only when the dynamic source is a string literal**; computed dynamic sources are deliberately ignored ([1.76.0 rule source](https://github.com/oxc-project/oxc/blob/oxlint_v1.76.0/crates/oxc_linter/src/rules/eslint/no_restricted_imports.rs), [rule reference](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports.html)). A local CLI probe against 1.76.0 confirmed that one regex catches static imports, re-exports, and `import("literal")`, but not `import(variable)`.

It can cheaply reject known app package names. For example, a package-only override could reject `^@overseer/(api|web)(/|$)`. That is not sufficient as the authoritative boundary because:

- it matches the **spelling** of a module specifier, not the destination file;
- relative paths can have arbitrary depth and spelling;
- a TS `paths`, `baseUrl`, or package `imports` alias can resolve into an app without containing `apps/` or an app package name;
- app-to-app policy depends on which app contains the importer, requiring generated per-app overrides and app-name lists;
- computed dynamic imports remain unchecked;
- it does not inspect `package.json` dependency fields.

TypeScript explicitly documents that `moduleResolution` maps string module specifiers to files, that `paths` changes resolution of bare specifiers, and that package `imports`/workspace package lookup participate in resolution. Therefore a destination-based architectural rule must resolve the specifier rather than pattern-match its text ([TypeScript module resolution](https://www.typescriptlang.org/docs/handbook/modules/reference.html#the-moduleresolution-compiler-option), [`paths`](https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths), [package lookup and exports](https://www.typescriptlang.org/docs/handbook/modules/reference.html#node_modules-package-lookups)).

### `import/no-restricted-paths`

It is **not implemented in Oxlint 1.76.0**. The complete tagged directory for native import rules includes such rules as `no-absolute-path`, `no-cycle`, and `no-relative-parent-imports`, but no `no_restricted_paths.rs` ([1.76.0 import-rule directory](https://github.com/oxc-project/oxc/tree/oxlint_v1.76.0/crates/oxc_linter/src/rules/import)). The installed 1.76.0 configuration schema likewise has `no-restricted-imports` but no `no-restricted-paths` ([installed schema](../../node_modules/oxlint/configuration_schema.json)).

Even the conceptual `no-restricted-paths` zone model would address source destinations only; it would not validate workspace manifest edges. Depending on a JS version of `eslint-plugin-import(-x)` would also add a resolver/plugin stack when this repository already has a local plugin and a much smaller invariant.

### Other import built-ins

`import/no-relative-parent-imports` is too broad: legitimate imports within one app/package may traverse to a parent directory. `import/no-cycle` detects cycles rather than forbidden acyclic edges. Neither encodes app identity or package-to-app direction ([1.76.0 import-rule directory](https://github.com/oxc-project/oxc/tree/oxlint_v1.76.0/crates/oxc_linter/src/rules/import)).

## Custom source rule design

### Configuration

Keep the existing plugin registration and add one rule at root scope:

```ts
lint: {
  jsPlugins: [
    { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
    { name: "overseer", specifier: "./tools/oxlint/overseer-option-plugin.ts" },
  ],
  rules: {
    "overseer/enforce-monorepo-boundaries": "error",
    // existing rules unchanged
  },
  options: { typeAware: true, typeCheck: true },
}
```

No app/package overrides are needed: the rule should derive the importer workspace from `context.filename` and return without work for root/tooling files. Oxlint exposes absolute `context.filename`, `context.physicalFilename`, `context.cwd`, source text, settings, and AST visitors, including `ImportDeclaration`, `ExportNamedDeclaration`, `ExportAllDeclaration`, `ImportExpression`, `TSImportType`, `TSImportEqualsDeclaration`, and `CallExpression` ([installed 1.76.0 plugin types](../../node_modules/@oxlint/plugins/index.d.ts)). Oxlint's JS-plugin API is alpha but supports ESLint-compatible traversal, reporting, options, selectors, scope analysis, and `SourceCode`; type-aware JS-plugin rules are not supported, so filesystem/module resolution must be done by the plugin itself rather than through parser services ([JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins), [writing JS plugins](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html)).

### Shared workspace model

Build and cache a model keyed by repository root:

```ts
type WorkspaceKind = "app" | "package";
type Workspace = {
  kind: WorkspaceKind;
  directory: string; // normalized absolute real path
  name: string; // package.json name
};
```

Discover the repository root from `context.cwd`/ancestors containing the root workspace manifest, expand the repo's declared `apps/*` and `packages/*` members, and require every member to have a unique package name. Normalize separators and compare paths with a containment helper based on `path.relative`, not string prefixes (`apps/api2` must not count as inside `apps/api`). Resolve real paths where files exist to prevent symlink escapes, while retaining lexical normalized paths for missing relative targets so a forbidden traversal is still diagnosed before resolution succeeds.

Keep pure, exported helpers for `workspaceContainingPath`, `packageNameFromSpecifier`, `isAllowedBoundaryEdge`, and manifest validation. Both the Oxlint rule and repository manifest test should call the same policy function, preventing drift.

### Resolve each source reference to a workspace

For every importer inside a workspace:

1. Extract the module source from static import, side-effect import, re-export, `import type`, `TSImportType` (`type X = import("...")`), TS external-module `import = require`, literal `require(...)`, and dynamic `import(...)`.
2. First map a bare package name (including scoped-name parsing and subpaths) against workspace `package.json#name` values. This catches app package imports even if installation/resolution is broken.
3. For relative, absolute, and `file:` references, compute a normalized target from the importing file. Classify the lexical target and, when it exists, its real path.
4. For aliases and unresolved bare spellings, load the nearest applicable `tsconfig.json` with the installed TypeScript API and call `ts.resolveModuleName` using that config's compiler options. This follows the repo's `Bundler` semantics, including `paths`, `baseUrl`, package `imports`, workspace/node_modules lookup, and package exports. Cache parsed configs and `(importer, specifier)` results. TypeScript documents why resolver mode must match the bundler/runtime and how `paths` wildcard and fallback matching works ([module resolution](https://www.typescriptlang.org/docs/handbook/modules/reference.html#the-moduleresolution-compiler-option), [`paths` details](https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths)).
5. Classify the resulting destination workspace and apply the decision table. Externals or destinations outside `apps/*` and `packages/*` are allowed.

Report on the source literal with separate stable message IDs such as `appCannotImportApp`, `packageCannotImportApp`, and `dynamicImportMustBeStatic`. Include importer and target workspace names in diagnostic data.

### Dynamic imports and bypasses

To satisfy “including dynamic imports,” accept string literals and no-substitution template literals and resolve them exactly like static imports. Reject a dynamic import whose source is computed (`import(name)`, interpolated templates, concatenation) because no static rule can prove its destination. Oxlint's built-in consciously ignores these computed forms, so merely enabling `no-restricted-imports` leaves a bypass ([1.76.0 source](https://github.com/oxc-project/oxc/blob/oxlint_v1.76.0/crates/oxc_linter/src/rules/eslint/no_restricted_imports.rs)).

Apply the same static-source requirement to global `require`/`require.resolve` if CommonJS is permitted; use scope analysis so a shadowed local function named `require` is not mistaken for module loading. This is slightly broader than the requested syntax but closes the equivalent dependency path.

Do not silently allow a specifier that syntactically looks like a configured alias but fails resolution. Type checking already catches many such failures, but the boundary rule should emit a dedicated “cannot verify alias destination” diagnostic when a `paths`/package-`imports` pattern matched and resolution failed.

## Workspace manifest-edge enforcement

Oxlint lints JavaScript/TypeScript ASTs, not `package.json` as a dependency graph. Reading every manifest from a `Program` visitor and attaching repository-wide failures to an unrelated source node would be nondeterministic, duplicated across files, and would fail to run for an empty workspace. Use a normal repository test instead.

The test should enumerate all workspace manifests, index them by `name`, and inspect at least:

- `dependencies`
- `devDependencies`
- `peerDependencies`
- `optionalDependencies`

For every key matching another workspace name, apply the same decision table regardless of version syntax (`workspace:`, semver, `file:`, `link:`, etc.). Also check `bundledDependencies`/`bundleDependencies` entries if used. Reject duplicate or missing workspace package names because name-based edge classification otherwise becomes ambiguous.

This check is necessary independently of source imports: Vite+ explicitly derives workspace ordering from ordinary `package.json` dependency relationships rather than a separate graph ([Vite+ workspace execution](https://viteplus.dev/guide/run#running-in-a-workspace)).

Place the current-repository assertion and pure validator tests under `tools/oxlint`, so the existing root `test` command discovers them. For reliable CI enforcement, invoke that root tooling suite directly in the root `check` script before/alongside recursive package tests (for example, `vp check && vp test run tools/oxlint && vp run -r test`). Vite+ documents `vp test` as a built-in distinct from `vp run test`, and `vp run -r` as workspace-package execution based on manifest relationships ([built-ins versus scripts](https://viteplus.dev/guide/run#built-in-commands-vs-scripts), [recursive workspace execution](https://viteplus.dev/guide/run#running-in-a-workspace)).

## Testing approach

### Rule-level `RuleTester`

Extend the existing [`RuleTester` suite](../../tools/oxlint/overseer-option-plugin.test.ts). Oxlint's 1.76.0 tester supports per-case `filename`, `cwd`, options, settings, and expected message IDs ([installed tester types](../../node_modules/oxlint/dist/plugins-dev.d.ts)). Cover:

**Valid**

- app importing its own files through relative paths and its own alias;
- app importing a package by workspace name, relative path, TS alias, and package `imports` alias;
- package importing another package;
- app/package importing external packages and platform modules;
- app self-name import, if self-imports are intentionally supported.

**Invalid**

- app A to app B via `../../`, an absolute/file URL, app package name and subpath, TS `paths` alias, and package `imports` alias;
- package to app through each of those forms;
- each syntax: default/named/namespace/side-effect import, re-export, `import type`, `import("...")` type, TS `import = require`, literal `require`, and dynamic `import()`;
- computed and interpolated dynamic imports;
- Windows separators, `..` normalization, similarly prefixed workspace names/directories, symlinks, unresolved matching aliases, and shadowed `require`.

Use a committed small fixture monorepo under `tools/oxlint/fixtures` (or temporary directories with deterministic cleanup) for resolver tests. Real files and tsconfigs are required to prove TS alias/package-`imports` resolution; in-memory source alone is insufficient for `ts.resolveModuleName`.

### Manifest validator

Unit-test the pure graph validator with object fixtures for every allowed and forbidden cell, every dependency field, scoped/unscoped names, subpaths, and all version protocols. Add one test that loads the real repository and expects zero violations. The latter is the actual manifest gate; the object cases document policy and produce focused failures.

### Integration confidence

Finally run:

```bash
vp test run tools/oxlint
vp lint
vp check
```

`RuleTester` proves visitor and resolution behavior; the repository assertion proves current manifests; `vp lint` proves the plugin registration/rule name/config path used by developers; and `vp check` proves the CI entry point.

## Bottom line

A custom source rule is justified because the boundary is **destination-aware and importer-dependent**, while Oxlint 1.76.0's available restriction built-in is **specifier-text-aware** and `import/no-restricted-paths` is absent. Keep manifest checking outside the AST rule, but share one pure workspace classifier and edge policy. This combination covers relative traversal, TS and package aliases, workspace package imports, all static module-reference forms, dynamic imports (by rejecting unverifiable computed forms), and declared workspace dependency edges without banning legitimate app-to-package or package-to-package dependencies.
