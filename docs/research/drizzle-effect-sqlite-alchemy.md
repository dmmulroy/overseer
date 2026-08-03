# Drizzle + Effect + Alchemy v2 + Durable Object SQLite

**Research status:** complete. This report is based first on the checked-out Alchemy and Effect sources, local examples, installed/package-cache metadata, and then on official Drizzle and Cloudflare documentation/source. No implementation files or `planning.md` were changed. The report compares paths and recommends a practical investigation sequence; it does **not** make a final project decision.

## Executive summary

- **[Verified] Direct Drizzle support exists for Cloudflare Durable Object SQLite.** The official driver is `drizzle-orm/durable-sqlite`; its type definition accepts a `DurableObjectStorage`, creates a synchronous `DrizzleSqliteDODatabase`, and the source executes through `client.sql.exec(...)` and `client.transactionSync(...)`. ([Drizzle DO guide](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-do); [official driver source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/durable-sqlite/driver.ts); local cached types `/Users/dmmulroy/.bun/install/cache/drizzle-orm@0.45.2@@@1/durable-sqlite/driver.d.ts:4-9`, `session.d.ts:13-24`.)
- **[Verified] Alchemy exposes the exact raw handle needed.** `Cloudflare.DurableObjectState` contains an Effect-wrapped storage plus `raw: cf.DurableObjectState`; `state.storage.raw` is the underlying `cf.DurableObjectStorage`, while `state.storage.sql` is an Effect wrapper around `cf.SqlStorage`. ([`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectState.ts:11-64`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectState.ts); [`DurableObjectStorage.ts:28-71`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectStorage.ts).)
- **[Recommendation] For a DO-local ORM, test direct `drizzle-orm/durable-sqlite` first.** It avoids a network/proxy hop and preserves Cloudflare's synchronous SQLite API. Put it in an infrastructure/composition-root module and expose domain-shaped Effect services; do not let domain code import Drizzle, `cloudflare:workers`, or Alchemy.
- **[Verified] Effect has a first-party DO SQLite SQL client, but not a current vendored generic Drizzle bridge.** `@effect/sql-sqlite-do` adapts DO SQLite to Effect's generic `SqlClient`, supports migrations and a storage-backed transaction path, and is present in `repos/effect`; the current vendored tree has no `packages/sql-drizzle`. A historical `@effect/sql-drizzle` package was added in an older Effect commit, but that package is not evidence of a current v4 dependency/API. ([local Effect source](../../repos/effect/packages/sql/sqlite-do/src/SqliteClient.ts); [Effect API docs](https://effect-ts.github.io/effect/docs/sql-sqlite-do); [historical Effect integration commit](https://github.com/Effect-TS/effect/commit/e50e01db54958c74946ac0e7dbba8c461671ccae).)
- **[Verified] D1 is a separate, supported Alchemy path.** Alchemy's `Drizzle.D1` builds `@effect/sql-d1` and `drizzle-orm/effect-d1`; Alchemy's checked-in example uses `yield* db.select().from(...)`. D1 is appropriate for shared/queryable application data, not a substitute for each DO's private per-instance database. ([Alchemy D1/Drizzle guide](https://alchemy.run/cloudflare/data/d1-drizzle/); [`Drizzle/D1.ts:11-80`](../../repos/alchemy/packages/alchemy/src/Drizzle/D1.ts); [`examples/cloudflare-d1-drizzle/src/Api.ts:15-81`](../../repos/alchemy/examples/cloudflare-d1-drizzle/src/Api.ts).)
- **[Compatibility gap] Alchemy's current Drizzle migration resource is wired for D1/other database resources, not directly for DO-local storage.** `Drizzle.Schema` can generate SQLite migration files, but a DO still needs runtime initialization that applies those files to each DO instance. Alchemy's public `DurableObjectProps` has commented-out `sqlite`/`namespaceId` fields in this checkout; the provider emits SQLite class migrations by default for new local classes. ([`DurableObject.ts:219-259`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts); [`Drizzle/Schema.ts:41-116`](../../repos/alchemy/packages/alchemy/src/Drizzle/Schema.ts); [`WorkerProvider.ts:3301-3381`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerProvider.ts).)

## What was inspected locally

| Area | Local evidence |
| --- | --- |
| Repository runtime versions | Root `package.json`: `effect` `4.0.0-beta.102`, `alchemy` `2.0.0-beta.67`; `apps/api/package.json` currently depends only on `effect`. |
| Drizzle install state | Drizzle is not installed in root `node_modules`/`npm ls`; Alchemy declares `drizzle-orm` and `drizzle-kit` as optional peers (`repos/alchemy/packages/alchemy/package.json:425-460`), and the Alchemy D1 example declares them as workspace/catalog dependencies (`examples/cloudflare-d1-drizzle/package.json:21-28`). A Bun package cache contains `drizzle-orm@0.45.2` and `drizzle-kit@0.31.10`; its type definitions were inspected, but that cache is not a project dependency. |
| Alchemy examples | `examples/cloudflare-d1-drizzle` demonstrates `Drizzle.Schema` + D1 migrations + `Drizzle.D1`; `examples/cloudflare-effect-sql-d1` demonstrates raw `alchemy/SQL/D1`; `examples/cloudflare-agent/src/tools/Sql.ts` demonstrates `state.storage.sql.exec`. |
| Effect sources | `repos/effect/packages/effect/src/unstable/sql/*`; `repos/effect/packages/sql/d1`; `repos/effect/packages/sql/sqlite-do`, `sqlite-bun`, `sqlite-node`, and `libsql`. |
| Existing research convention | Reports are stored in `docs/research/`; this report follows that convention. |

## Drizzle SQLite drivers and adapters

### 1. Cloudflare Durable Object SQLite: `drizzle-orm/durable-sqlite`

**[Verified facts]**

- The official documentation says Drizzle fully supports Cloudflare Durable Object SQLite and shows `drizzle(this.storage, ...)`, where `this.storage` is the DO's `DurableObjectStorage`. It constructs the database in the DO constructor and recommends completing migrations before accepting queries. ([official guide](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-do).)
- The local package definition is unusually important here: `drizzle(client, config?)` accepts `TClient extends DurableObjectStorage`, returns `DrizzleSqliteDODatabase`, and marks the database as `'sync'` (`durable-sqlite/driver.d.ts:4-9`).
- The official source's `SQLiteDOSession` calls `client.sql.exec`; `run`, `all`, `get`, and `values` are synchronous. Its `transaction` calls `client.transactionSync(() => ...)`, and nested Drizzle transactions recurse through the same session (`durable-sqlite/session.d.ts:13-45`; [source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/durable-sqlite/session.ts)).
- The driver is a good structural match for Alchemy's `state.storage.raw`, not for Alchemy's Effect wrapper. `state.storage.sql.exec(...)` returns an Effect, whereas Drizzle expects a raw `DurableObjectStorage` whose `sql.exec(...)` is synchronous. ([`DurableObjectStorage.ts:28-71`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectStorage.ts).)

**[Compatibility conclusion]** Drizzle can operate **directly** on an Alchemy DO's SQLite storage; a proxy or adapter is not required for the Drizzle query engine. The required seam is only an application composition-root seam: obtain `DurableObjectState` through Alchemy, pass `state.storage.raw` to `drizzle`, and wrap synchronous calls in `Effect.sync`/`Effect.try` when exposing them as Effect services.

**[Caveats]**

- Because this driver is sync, do not yield or await individual query results. Consume cursors immediately; Cloudflare warns that a cursor resumed after an `await` has no stable snapshot guarantee. ([Cloudflare SQL API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#exec).)
- `transactionSync` requires a synchronous callback. Do not put `fetch`, an Effect suspension, or any other async work inside a Drizzle transaction. Cloudflare explicitly documents `transactionSync` for synchronous SQL operations. ([Cloudflare SQLite storage API, `transactionSync`](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync).)
- The checked-in cached Drizzle types are `0.45.2`, while Alchemy's current D1 guide asks for `drizzle-orm@^1.0.0-rc.4`. Pin and test one version compatible with the project's Alchemy release; do not infer compatibility from the cache alone.

### 2. Cloudflare D1: `drizzle-orm/d1` and Alchemy's `Drizzle.D1`

**[Verified facts]**

- Drizzle's native D1 driver accepts a `D1Database` and returns an async `DrizzleD1Database`; the type definition also exposes `batch` (`d1/driver.d.ts:6-13`; [official D1 guide](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)).
- Alchemy's `Drizzle.D1` is an Effect-native integration around `drizzle-orm/effect-d1`, not the ordinary `drizzle-orm/d1` constructor. It resolves an `@effect/sql-d1` `D1Client`, calls `makeWithDefaults`, and uses `proxyChain` so Drizzle query chains can be yielded as Effects (`repos/alchemy/packages/alchemy/src/Drizzle/D1.ts:11-80`).
- The example demonstrates relational queries and inserts/deletes in an Effect Worker (`examples/cloudflare-d1-drizzle/src/Api.ts:15-81`). Its database resource wires `Drizzle.Schema` output into `Cloudflare.D1.Database.migrationsDir` (`examples/cloudflare-d1-drizzle/src/Db.ts:5-25`).
- D1's Effect client explicitly does not support transactions, streaming queries, or `updateValues` (`repos/effect/packages/sql/d1/src/D1Client.ts:8-9, 51-61, 99-267`). Alchemy's guide correspondingly says `sql.withTransaction` and Drizzle `db.transaction` are unavailable; use D1 batch semantics where appropriate ([Alchemy guide](https://alchemy.run/cloudflare/data/d1-drizzle/), “Prefer tagged-template SQL?” / transaction note).

**[Recommendation]** Use this path if the data is shared across DO instances or needs D1's database-level migrations, external tooling, imports, and queryability. Do not use a D1 binding merely to avoid learning the DO SQLite adapter: it changes the data topology and loses the zero-latency, per-object storage model.

### 3. libSQL/Turso: `drizzle-orm/libsql`

**[Verified facts]**

- Drizzle's libSQL driver accepts a URL/config or an existing `@libsql/client`; the official docs list node, web, HTTP, WebSocket, SQLite-file, and WASM client variants ([SQLite guide](https://orm.drizzle.team/docs/sqlite/get-started-sqlite); local `libsql/driver.d.ts:1-23`).
- Effect has a matching `@effect/sql-libsql` adapter. The vendored source supports managed or caller-owned `@libsql/client` instances, URL forms including `file:`, HTTP, WebSocket, and transactions/savepoints, but explicitly says streaming is not implemented (`repos/effect/packages/sql/libsql/src/LibsqlClient.ts:1-14, 73-126, 190-275`).

**[Compatibility conclusion]** libSQL is not a direct adapter for Cloudflare `SqlStorage`. A `@libsql/client/web`/HTTP client would talk to a libSQL/Turso service, not the private SQLite database attached to the current DO. It is a viable external database option, but it introduces network/auth/service lifecycle concerns and is not a replacement for `durable-sqlite`.

### 4. `better-sqlite3`, `node:sqlite`, and `bun:sqlite`

**[Verified facts]**

- Drizzle has synchronous adapters for `better-sqlite3`, `node:sqlite`, and Bun SQLite ([official SQLite guide](https://orm.drizzle.team/docs/sqlite/get-started-sqlite); [Bun guide](https://orm.drizzle.team/docs/sqlite/connect-bun-sqlite)). The cached types show native client/file configuration for `better-sqlite3` (`better-sqlite3/driver.d.ts:1-29`) and `bun:sqlite` (`bun-sqlite/driver.d.ts:1-50`).
- Effect similarly provides separate runtime-specific clients: `@effect/sql-sqlite-node` imports `node:sqlite` and opens a filename (`repos/effect/packages/sql/sqlite-node/src/SqliteClient.ts:1-14, 68-125`), while `@effect/sql-sqlite-bun` imports `bun:sqlite` and opens a filename (`repos/effect/packages/sql/sqlite-bun/src/SqliteClient.ts:1-14, 68-122`).

**[Compatibility conclusion]** These are for Node/Bun tests or services with a local filesystem/native runtime. They are not appropriate imports in an Alchemy Worker/DO bundle: a workerd isolate does not provide `node:sqlite`, `bun:sqlite`, `better-sqlite3` native bindings, or an arbitrary SQLite file path. They can still be useful for local repository tests if the application deliberately maintains a platform-specific test composition root.

### 5. `drizzle-orm/sqlite-proxy`

**[Verified facts]**

- The official proxy driver accepts an async callback `(sql, params, method)` and expects `{ rows }`; it also has an optional batch callback ([Drizzle proxy guide](https://orm.drizzle.team/docs/sqlite/connect-drizzle-proxy); cached types `sqlite-proxy/driver.d.ts:5-24`).
- The proxy is intentionally a custom transport boundary: Drizzle builds SQL, the callback sends it to a server/database, and the callback maps raw rows back to Drizzle. It can therefore run in a Worker if the callback talks to an allowed HTTP/RPC service.

**[Possible DO design]** A Worker could use `sqlite-proxy` with a callback that calls a narrowly scoped DO RPC method, and the DO could execute `state.storage.raw.sql.exec(sql, ...params)`. A batch callback could execute a sequence in `transactionSync`. This is technically possible, but arbitrary SQL RPC is a security and API-design smell, and one query becomes a DO round trip. Prefer direct DO-local Drizzle unless the proxy boundary is itself a requirement (for example, a separate process owns the database or a non-DO caller must use the same query surface).

## Effect SQL and Drizzle integration options

### Current vendored Effect SQL

**[Verified facts]**

- The current Effect v4 SQL API is under `effect/unstable/sql`. `SqlClient` combines tagged-template construction, connection acquisition, transaction handling, row transforms, and reactive query helpers (`repos/effect/packages/effect/src/unstable/sql/SqlClient.ts:1-16, 41-82, 138-219`).
- The generic migrator creates a migrations table (default `effect_sql_migrations`), loads ordered migrations, runs pending work through `sql.withTransaction`, detects duplicates/locks, and supports loaders such as `fromRecord`, `fromGlob`, and `fromFileSystem` (`repos/effect/packages/effect/src/unstable/sql/Migrator.ts:1-17, 38-110, 270-330, 389-440`).
- `@effect/sql-sqlite-do` is a first-party adapter in the vendored repository. Its `SqliteClientConfig` accepts either `db?: SqlStorage` or `storage?: DurableObjectStorage` (`repos/effect/packages/sql/sqlite-do/src/SqliteClient.ts:91-108`). `make` builds a SQLite compiler/connection over `storage.sql` or `db`, serializes access with a semaphore, normalizes `ArrayBuffer` blobs to `Uint8Array`, and provides both the DO-specific client and generic `SqlClient` (`:177-312`).
- The DO adapter only offers `withTransaction` when the full `DurableObjectStorage` is passed; passing only `storage.sql` deliberately produces an unsupported-transaction error (`:114-175, 300-306`). It also says `updateValues` is unsupported (`:60-74`).
- `@effect/sql-sqlite-do/SqliteMigrator` reuses the generic migrator and defaults to `effect_sql_migrations`; it is intended to run against a `DurableObjectStorage`-backed client before request handlers (`repos/effect/packages/sql/sqlite-do/src/SqliteMigrator.ts:1-60`).
- The D1 adapter is a different implementation: it uses `D1Database.prepare`, caches prepared statements, and marks transactions and streams unsupported (`repos/effect/packages/sql/d1/src/D1Client.ts:99-237`).

### Drizzle integration status

**[Verified]** There are three materially different choices:

1. **Direct Drizzle DO driver:** use `drizzle-orm/durable-sqlite` over Alchemy's `state.storage.raw`; queries are synchronous and must be lifted into Effects at the boundary.
2. **Effect SQL DO driver:** use `@effect/sql-sqlite-do` over `state.storage.raw`; repositories depend on generic `SqlClient`, but this is not a Drizzle ORM bridge.
3. **Alchemy D1 Drizzle driver:** use `alchemy/Drizzle` `Drizzle.D1`; this is the checked-in, Effect-native Drizzle path, but it targets D1.

The vendored Effect repository has no current `repos/effect/packages/sql-drizzle` directory. A historical Effect commit added `@effect/sql-drizzle`, including `SqliteDrizzle` and a patch that makes Drizzle `QueryPromise` yieldable, but the commit's package version/dependencies are from the older Effect API and the package is absent from this checkout. Treat it as historical context, not a drop-in v4 solution. ([historical source](https://github.com/Effect-TS/effect/commit/e50e01db54958c74946ac0e7dbba8c461671ccae); local absence verified under `repos/effect/packages/`.)

**[Unresolved question]** If the project wants both Drizzle's query builder and Effect's `SqlClient` abstraction over DO SQLite, it must either (a) use direct Drizzle at the repository boundary and standardize an Effect wrapper, (b) use Effect SQL without Drizzle, or (c) build/maintain a compatibility adapter. There is no current local package that makes that choice for this repository.

## Alchemy v2 Durable Object APIs and raw SQLite access

### The state shape

**[Verified facts]**

- An Alchemy DO namespace handle has `getByName`, `newUniqueId`, `idFromName`, `idFromString`, `get`, and `jurisdiction`; its public shape may expose `fetch` plus RPC/alarm/WebSocket handlers (`DurableObject.ts:81-118`).
- `Cloudflare.DurableObjectState` is an Effect service with `id`, Effect-wrapped `storage`, `raw`, `blockConcurrencyWhile`, `waitUntil`, and WebSocket helpers (`DurableObjectState.ts:11-62`).
- Alchemy's storage wrapper explicitly exposes `storage.sql.raw: cf.SqlStorage`, `storage.sql.exec(...)` as an Effect, cursor `toArray`/`one`/`raw`, and `databaseSize` (`DurableObjectStorage.ts:28-71`). It also wraps the raw async storage methods and `storage.transaction(...)` (`:123-176, 223-277`).
- The wrapper is not a substitute for the native object when a third-party library expects Cloudflare's type: pass `state.storage.raw` to Drizzle or Effect's DO client. Use `state.storage.sql.exec` when you intentionally want Effect's typed boundary.

### The two-phase Alchemy DO lifecycle

- Alchemy's DO implementation resolves shared dependencies and the state reference in an outer Effect; state methods are runtime-context-colored and are intended to run in the inner Effect (`DurableObject.ts:335-365, 671-700`).
- `yield*` of a local DO registers the namespace binding and exports the class; during plan time Alchemy evaluates the constructor with a mock state to discover bindings (`DurableObject.ts:1220-1257`). Therefore, migration/query execution must not happen during plan discovery.
- At runtime, `DurableObjectBridge` constructs the instance under Cloudflare `state.blockConcurrencyWhile`, then executes every RPC/fetch call in a fresh Effect scope (`DurableObjectBridge.ts:47-90, 124-175`). A returned `fetch` Effect is converted to/from Web `Request`/`Response` (`:179-188`).
- The current public `DurableObjectProps` contains `className`, `scriptName`, and `transferredFrom`; `sqlite` is commented out (`DurableObject.ts:219-259`). The Worker provider nevertheless emits `newSqliteClasses` for new local classes and tracks class renames/transfers (`WorkerProvider.ts:3301-3381`).

### Cloudflare storage behavior relevant to Drizzle/Effect

**[Verified facts from Cloudflare]**

- Each DO has private, strongly consistent, transactional storage; SQLite-backed DOs expose `ctx.storage.sql`, PITR, synchronous KV, asynchronous KV, and alarms. ([Cloudflare storage overview](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/); [access storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).)
- `sql.exec` is synchronous, accepts `?` bindings, can contain multiple statements, and returns an iterable cursor. Cloudflare says to consume the cursor before crossing an `await`; `BEGIN`/`SAVEPOINT` are not allowed through `sql.exec`. Use `transactionSync` for synchronous SQL transactions. ([Cloudflare SQL API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#exec); [transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync).)
- SQLite-backed DO operations are implicitly transactional/isolated; writes without an intervening `await` can be automatically coalesced atomically. Cloudflare says the legacy async `transaction()` `txn` object is obsolete for SQLite-backed classes because direct `ctx.storage` operations, including SQL, are in the transaction context. ([Cloudflare SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction); [rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).)
- `blockConcurrencyWhile` prevents all other events while its callback runs. Cloudflare recommends it for one-time initialization/migrations, not every request; external I/O inside it is an anti-pattern. ([Cloudflare rules, `blockConcurrencyWhile`](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).)
- `PRAGMA user_version` is not supported by DO SQLite. Cloudflare recommends a migration table or a migration library and says initialization/migration should finish before accepting requests. ([Cloudflare rules, “Initialize storage and run migrations in the constructor”](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).)
- DOs are one globally unique, single-threaded instance per identity. Cloudflare recommends sharding by the atom of coordination rather than routing unrelated data through one “global” DO. ([Cloudflare rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).)

**[Compatibility gap]** Direct Drizzle's `transactionSync` maps cleanly to the documented DO transaction model. Effect's `@effect/sql-sqlite-do` implementation instead uses `storage.transaction(...)` for its `withTransaction` path (`SqliteClient.ts:118-175, 300-306`), while Cloudflare now describes the async `txn` object as obsolete for SQLite-backed classes. This may still work because the adapter executes SQL through the storage handle during the transaction callback, but it should be verified against the exact `workerd`/Workers types used by the repository before treating Effect `withTransaction` as the canonical DO transaction path.

## Migrations and deployment behavior

### Drizzle migrations

- Drizzle's DO migrator accepts the generated journal and migration SQL map and returns `Promise<void>` (`durable-sqlite/migrator.d.ts:1-14`; [official source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/durable-sqlite/migrator.ts)). The source creates `__drizzle_migrations` and applies statements inside `db.transaction(...)`.
- Alchemy's `Drizzle.Schema` provider invokes drizzle-kit programmatically/through its CLI fallback and supports `dialect: "sqlite"` (`Drizzle/Schema.ts:14-116, 359-451`). The checked-in D1 example wires generated output to the D1 resource, where deployment applies migrations (`examples/cloudflare-d1-drizzle/src/Db.ts:5-25`).
- **[Unresolved]** A DO has one private database per object ID, so a deploy-time migration against a single resource cannot migrate all future and existing DO instances. The migration must be bundled and run when each instance is initialized, usually behind an idempotent migration table and `blockConcurrencyWhile`.
- Effect's `SqliteMigrator` offers the same per-instance model with a different table/default (`effect_sql_migrations`) and supports compiled `fromRecord`/`fromGlob` loaders. `fromFileSystem` is not a good Worker runtime choice because workerd has no ordinary filesystem; load bundled migration records instead (`repos/effect/packages/effect/src/unstable/sql/Migrator.ts:389-440`; `repos/effect/packages/sql/sqlite-do/src/SqliteMigrator.ts:1-60`).

### Alchemy/Cloudflare class migrations are separate

Cloudflare/Alchemy class migrations provision or rename the **DO class/namespace storage backend**. They are not application SQL schema migrations. Alchemy's provider tracks new SQLite classes and class moves; Drizzle/Effect migration tables change the SQL schema inside each already-created DO instance. Keep these as two separate migration concerns and test both deploy order and first activation.

## Composition-root designs

The following are designs to compare, not a final project choice.

### Design A — direct Drizzle inside the DO (best first spike)

**Boundary:**

```text
Alchemy stack/deploy root
  -> declares Worker + DurableObject class and class migration metadata
DO composition root
  -> resolves Cloudflare.DurableObjectState
  -> obtains state.storage.raw
  -> constructs drizzle-orm/durable-sqlite
  -> runs idempotent bundled migrations during initialization
  -> exposes domain-shaped Effect services/RPC methods
Domain/application
  -> depends only on repository/service interfaces returning Effect
```

**Shape:**

```ts
const state = yield* Cloudflare.DurableObjectState;
const db = drizzle(state.storage.raw, { schema: drizzleSchema });

return Effect.gen(function* () {
  // Run migrate(db, bundledMigrations) here, not during Alchemy plan discovery.
  // Each synchronous Drizzle operation is lifted with Effect.sync/Effect.try.
  return {
    save: (input) => Effect.try(() => db.insert(table).values(input).returning()),
    find: (id) => Effect.sync(() => db.select().from(table).where(...).get()),
  };
});
```

**Benefits:** official direct driver; no RPC hop; native `transactionSync`; Drizzle schema/query ergonomics; simplest path to a DO-local proof. **Costs:** synchronous database calls must be carefully lifted; Drizzle types remain in infrastructure; migration initialization and version compatibility need tests.

### Design B — Effect SQL DO client, no Drizzle query engine

Use `@effect/sql-sqlite-do` with `SqliteClient.layer({ storage: state.storage.raw })`, provide `SqlClient`, and put repositories on `SqlClient`/`SqlSchema`/tagged SQL. Use `SqliteMigrator` with bundled migration Effects. This gives the strongest Effect-native error/resource/layer model and local tests, but it gives up Drizzle's query builder/relations unless a maintained Drizzle bridge is added.

This is attractive when the domain already speaks Effect SQL or when transaction/error semantics matter more than Drizzle's relational API. Validate the adapter's async transaction implementation against current workerd behavior before relying on `withTransaction` for critical workflows.

### Design C — a custom `sqlite-proxy`/RPC boundary

Keep Drizzle on the caller side and expose a narrow DO method such as `executeQuery`/`executeBatch` from the DO composition root. The method maps SQL and parameters to raw `state.storage.raw.sql.exec`; batch execution uses synchronous transaction boundaries. Return only raw rows and write operations needed by the trusted caller.

Use this only when a separate caller must own the Drizzle client. It increases latency, creates a protocol/security surface, complicates transaction semantics, and can accidentally expose arbitrary SQL. It is not needed to make Drizzle work inside the DO.

### Design D — shared D1 instead of per-object DO SQLite

Use Alchemy's existing `Drizzle.Schema` + `Cloudflare.D1.Database` + `Drizzle.D1` pattern. This is the most complete current Alchemy integration and gives deploy-driven schema migrations, but the database is shared and D1's driver lacks interactive transactions/streaming. It should be compared as a domain/data-topology choice, not as an adapter workaround.

## Comparison

| Option | Runtime fit in Alchemy DO | Effect fit | Transactions | Migration story | Main trade-off |
| --- | --- | --- | --- | --- | --- |
| `drizzle-orm/durable-sqlite` over `state.storage.raw` | **Direct**; official DO driver | Boundary wrapper required; no current generic Effect Drizzle package locally | Sync `transactionSync`; good fit for DO SQL rules | Bundle Drizzle migrations and run per instance; Alchemy `Drizzle.Schema` can generate SQL but does not apply it to every DO | Best ORM fit, but sync calls and version pinning need discipline |
| `@effect/sql-sqlite-do` | **Direct**; official Effect adapter | **Native** `SqlClient`/Layers | Full-storage transaction path exists; validate against current Cloudflare async transaction guidance | `SqliteMigrator`, per-instance, bundled loaders | Best Effect abstraction, but no current Drizzle bridge in vendored v4 |
| `drizzle-orm/d1` / Alchemy `Drizzle.D1` | Direct to D1, not DO-private SQLite | **Native in Alchemy** via `drizzle-orm/effect-d1` | No interactive transaction support in D1 driver; batch instead | Strongest current Alchemy provider/resource path | Shared D1 topology, network/service semantics |
| `drizzle-orm/libsql` / Effect libSQL | Only through external libSQL service/client | Effect adapter exists | libSQL client transactions/savepoints; streaming not implemented in Effect adapter | External service/schema workflow | Not the DO's embedded database |
| `better-sqlite3`, `node:sqlite`, `bun:sqlite` | Node/Bun only; not workerd | Effect runtime-specific clients only | Native local runtime | Local file migrations | Native/filesystem incompatibility in Worker/DO |
| `sqlite-proxy` | Works with a custom Worker/DO RPC or HTTP callback | Callback can be wrapped in Effect | Must design batch/transaction protocol | Caller/server owns migrations | Round trips and security/protocol complexity |

## Practical recommendation, without a final decision

1. **Run a small direct-driver spike first:** add Drizzle and Drizzle Kit only to the intended application workspace, pin versions compatible with Alchemy `2.0.0-beta.67`, define one pure SQLite schema, and exercise one Alchemy DO with `state.storage.raw`, `select`, `insert`, `db.transaction`, and first-activation migration. Do not change the project implementation as part of this report.
2. **Make the composition root the only Cloudflare/Drizzle-aware layer:** keep the Drizzle schema, migration loader, `drizzle(...)` construction, `Effect.sync` lifting, and Alchemy state access in an infrastructure module. Expose `UserRepository`/domain services as Effect-returning interfaces. Domain code should not import `drizzle-orm`, `cloudflare:workers`, `@cloudflare/workers-types`, or `alchemy/Cloudflare`.
3. **Use `blockConcurrencyWhile` only for per-instance initialization/migration.** Consume all synchronous cursors before any await, use `transactionSync` for multi-statement synchronous workflows, and avoid external I/O inside a transaction or initialization lock.
4. **Keep Effect SQL as the serious alternative:** if direct Drizzle wrappers become awkward or the application needs generic `SqlClient`/migration services, compare Design B rather than inventing a Drizzle proxy. Treat its transaction behavior as an explicit compatibility test.
5. **Compare D1 separately:** if the domain needs shared relational data, external query tooling, or one database-wide migration, evaluate Design D. Do not let the convenience of Alchemy's existing D1 integration decide a per-entity DO storage requirement.
6. **Avoid native SQLite drivers in the Worker bundle** and avoid `sqlite-proxy` unless a remote ownership boundary is required.

## Verified facts, recommendations, gaps, and unresolved questions

### Verified facts

- Official Drizzle has a direct Durable Object SQLite driver and migrator.
- Alchemy's `DurableObjectState` exposes both raw Cloudflare state and a raw underlying `DurableObjectStorage` through `state.storage.raw`.
- Alchemy's current Effect-native Drizzle helper is D1-specific and built on `@effect/sql-d1`/`drizzle-orm/effect-d1`.
- Effect v4 in this repository has generic SQL plus `@effect/sql-sqlite-do`, D1, libSQL, Node SQLite, and Bun SQLite adapters.
- Cloudflare DO SQLite SQL is synchronous, private per object, transactionally protected, and requires application-level schema migration tracking; `PRAGMA user_version` is unsupported.

### Recommendations

- Start with direct `drizzle-orm/durable-sqlite` for a DO-local ORM proof.
- Keep all platform/ORM wiring in an infrastructure composition root and expose narrow Effect services to the domain.
- Use Effect SQL as the alternative if Effect-native transaction/error/layer behavior is more important than Drizzle's query builder.
- Use D1 only when the desired data topology is shared D1 data.

### Compatibility gaps

- Alchemy's D1 integration targets `drizzle-orm/effect-d1`; there is no corresponding current `alchemy/Drizzle` DO SQLite helper in the checked-out source.
- The current vendored Effect tree has no current `@effect/sql-drizzle` package; the historical package used older APIs.
- Effect DO transaction code uses async `storage.transaction`, while current Cloudflare SQLite documentation emphasizes direct SQL/`transactionSync` and calls the async `txn` object obsolete for SQLite-backed classes.
- Alchemy's provider and the DO runtime have separate class-migration and SQL-schema-migration lifecycles.
- Local Drizzle cache types (`0.45.2`) and Alchemy docs/examples (`1.0.0-rc.4`) are different release lines; exact package-version compatibility is unverified.

### Unresolved questions for a future implementation spike

- Which Drizzle/Drizzle Kit release line should this repository pin with Alchemy beta.67 and the project's TypeScript/toolchain?
- Does `drizzle-orm/durable-sqlite/migrator`'s current implementation and migration table meet the desired per-object rollout/rollback policy?
- Does `@effect/sql-sqlite-do`'s `withTransaction` behave correctly under the exact production and local Alchemy workerd versions, given Cloudflare's current transaction guidance?
- Should repositories expose Drizzle result types, domain values, or schemas decoded into domain values at the infrastructure boundary?
- Which entity is the DO's atom of coordination, and is its expected throughput compatible with one DO instance per identity?
- How should migrations be bundled and tested in Alchemy local dev, where the class is discovered with a plan-time mock and runtime storage is supplied by workerd?
- Does the project need D1 as a second/shared store, and if so, which consistency boundary owns cross-DO workflows?

## Sources

### Drizzle ORM (official)

- [Cloudflare Durable Object SQLite guide](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-do)
- [Cloudflare D1 guide](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
- [SQLite/libSQL/Node SQLite/better-sqlite3 guide](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)
- [Bun SQLite guide](https://orm.drizzle.team/docs/sqlite/connect-bun-sqlite)
- [SQLite proxy guide](https://orm.drizzle.team/docs/sqlite/connect-drizzle-proxy)
- [DO driver source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/durable-sqlite/driver.ts)
- [DO session source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/durable-sqlite/session.ts)
- [DO migrator source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/durable-sqlite/migrator.ts)
- [SQLite proxy source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-proxy/driver.ts)

### Effect (official and vendored)

- [Effect SQL DO API reference](https://effect-ts.github.io/effect/docs/sql-sqlite-do)
- [Effect repository](https://github.com/Effect-TS/effect)
- Local generic SQL: `repos/effect/packages/effect/src/unstable/sql/SqlClient.ts`, `Migrator.ts`
- Local DO SQL: `repos/effect/packages/sql/sqlite-do/src/SqliteClient.ts`, `SqliteMigrator.ts`
- Local D1 SQL: `repos/effect/packages/sql/d1/src/D1Client.ts`
- Local libSQL/Node/Bun SQL: `repos/effect/packages/sql/libsql/src/LibsqlClient.ts`, `sqlite-node/src/SqliteClient.ts`, `sqlite-bun/src/SqliteClient.ts`
- [Historical `@effect/sql-drizzle` addition](https://github.com/Effect-TS/effect/commit/e50e01db54958c74946ac0e7dbba8c461671ccae)

### Alchemy (official docs and vendored source)

- [Alchemy D1 + Drizzle guide](https://alchemy.run/cloudflare/data/d1-drizzle/)
- [Alchemy Durable Objects guide](https://alchemy.run/cloudflare/compute/durable-objects/)
- [Alchemy repository](https://github.com/alchemy-run/alchemy)
- Local DO declaration/state: `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts:81-118, 219-259, 335-365, 671-700, 1108-1344`; `DurableObjectState.ts:11-102`; `DurableObjectStorage.ts:28-71, 123-277`
- Local runtime bridge: `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectBridge.ts:47-189`
- Local Drizzle/SQL integrations: `repos/alchemy/packages/alchemy/src/Drizzle/D1.ts:11-80`; `SQL/D1.ts:10-95`; `Drizzle/Schema.ts:14-116, 359-451`
- Local examples: `repos/alchemy/examples/cloudflare-d1-drizzle/src/Api.ts:15-81`; `src/Db.ts:5-25`; `examples/cloudflare-agent/src/tools/Sql.ts:12-27`; `examples/cloudflare-effect-sql-d1/src/Api.ts:15-87`

### Cloudflare Durable Objects (official)

- [Getting started with SQLite-backed Durable Objects](https://developers.cloudflare.com/durable-objects/get-started/)
- [Access Durable Objects storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [SQLite-backed Durable Object Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [SQL API / `exec`](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#exec)
- [`transactionSync`](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync)
- [`transaction`](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Durable Object class exports/migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
