# Foldkit, Effect, and Cloudflare compatibility spike

Throwaway fixture for **Validate Foldkit with Overseer's Effect and Cloudflare seams**. It is compatibility evidence, not production UI or product architecture.

## Result

**Pass with constraints.** Foldkit and `@foldkit/ui` run with the same Effect `4.0.0-beta.97` runtime as the browser client, Alchemy declaration, workerd Gateway, and SQLite Durable Object proof.

| Gate | Result | Evidence |
| --- | --- | --- |
| One Effect runtime | Pass | `package-lock.json` contains one `node_modules/effect`, at `4.0.0-beta.97`; `npm run check:runtime` enforces it. |
| Foldkit + UI | Pass | A Foldkit Scene renders `@foldkit/ui`'s headless Button; five happy-dom tests pass. |
| Shared HTTP contract | Pass | `src/shared-api.ts` is imported by both the workerd handler and browser `HttpApiClient`; success and declared-error decoding pass. |
| Project WebSocket seam | Pass for handshake/lifecycle | Gateway rejects an unauthenticated upgrade, forwards an Access-authenticated upgrade to the Project Durable Object, and receives a frame. A same-origin browser adapter is acquired/released by a real Foldkit Managed Resource runtime. |
| No transport types in Model | Pass | `ProjectModel` contains only application state; `npm run check:runtime` rejects `WebSocket`, Fetch, or Effect HTTP types in its module. Browser WebSocket mechanics stay in an adapter and Foldkit holds an application-owned `ProjectSocket`. |
| Effect/SQLite DO proof at beta.97 | Pass | All prior HTTP error, transaction, interruption, eviction, persistence, and aborted-cold-start probes pass unchanged at beta.97. |
| Alchemy beta.62 coexistence | Pass for package/declaration compatibility | `alchemy.run.ts` declares the Worker and DO binding, typechecks, and the `alchemy/Cloudflare` runtime entrypoint loads. No cloud deployment was attempted. |

## Exact package/runtime evidence

Direct pins:

- `effect`, `@effect/platform-browser`, `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/sql-sqlite-do`, and `@effect/vitest`: `4.0.0-beta.97`
- `foldkit` and `@foldkit/ui`: `0.128.1`
- `alchemy`: `2.0.0-beta.62`
- Cloudflare Vitest pool `0.18.5`, Wrangler `4.111.0`, Vitest `4.1.10`, TypeScript `5.9.3`
- workerd used by the tests: `1.20260710.1`

Two package-resolution hazards required explicit handling:

1. Importing Alchemy's Cloudflare entrypoint fails at runtime unless its optional peer `@effect/platform-node` is installed.
2. `@effect/platform-node@4.0.0-beta.97` declares `@effect/platform-node-shared` with a caret range, which initially selected beta.98. The fixture pins the shared package explicitly to keep the complete Effect set aligned.

Alchemy also brings its own older transitive workerd `1.20260704.1`; the Cloudflare test pool and Wrangler use `1.20260710.1`. This is tooling duplication, not a second Effect runtime.

## Exercised behavior

Browser fixture:

- Foldkit Scene interaction through `@foldkit/ui`;
- a Foldkit Command using `foldkit/http` and `HttpApiClient.make(SpikeApi)`;
- typed decoding of `DeclaredFailure` from the shared contract;
- Managed Resource acquisition and disposal around an application-owned Project socket;
- browser WebSocket URL construction with encoded Project ID and same-origin `ws`/`wss` selection.

workerd fixture:

- shared `HttpApi` handler through Gateway Worker and Durable Object;
- JSON projection for declared 409, schema 400, unsupported-media 415, and route 404 failures;
- full `DurableObjectStorage` transaction commit, typed-failure rollback, and interruption rollback;
- explicit rejection when only `storage.sql` is supplied;
- eviction/reconstruction with SQLite persistence;
- constructor-time handler priming under `blockConcurrencyWhile` and recovery after an aborted first external request;
- Project WebSocket 401 rejection and authenticated 101 upgrade with a server frame.

The workerd suite passed three additional consecutive runs after the initial pass.

## Constraints and gaps

- Keep the same pin-and-override policy and rerun both suites on every Effect, Foldkit, Alchemy, or Cloudflare runtime upgrade.
- Keep `skipLibCheck: true`. Full dependency declaration checking still fails in the beta ecosystem: Effect's internal `SchemaErrorTypeId` and `HttpEffect` export mismatches remain; the Worker graph also has Cloudflare/Node ambient conflicts and Alchemy declaration errors. Strict fixture source typechecks cleanly.
- Alchemy compatibility here means package resolution, runtime import, and declaration typechecking. It does not prove `plan`, deploy, migration emission, or remote Cloudflare behavior.
- WebSocket authentication emulates the identity header Cloudflare Access injects. A live Access policy/cookie upgrade was not exercised.
- The socket proof covers authenticated handshake and model-driven lifecycle, not reconnect, replay, sequence gaps, hibernation, or the final event envelope. Those remain decisions for the realtime contract.
- Browser tests inject Effect's `FetchHttpClient.Fetch` service explicitly. This tests the real HTTP seam without module mocks and avoids relying on mutable global `fetch` capture.
- The existing HTTP adapter constraints still apply: constructor-time handler priming, full `ctx.storage`, explicit JSON error projection, and no correctness dependency on Durable Object finalizers.

## Run

```sh
npm install
npm run check:runtime
npm run check
npm test
npm audit --omit=dev
```

Expected result: runtime/package check passes, strict fixture source typechecks, 5 browser tests pass, 6 workerd tests pass, and the production dependency audit reports no vulnerabilities.
