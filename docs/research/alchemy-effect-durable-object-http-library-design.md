# Alchemy Effect Durable Object HTTP library design

> Historical note: Overseer's Bookkeeper Durable Object was removed. Bookkeeper examples below document prior design research, not the current architecture.

**Status:** Design note for possible extraction into a generic library.

**Target versions:** Alchemy v2 and Effect v4.

This design captures the reusable parts of Overseer's Durable Object client/server split without asking application callers to manage Durable Object namespaces, stubs, generated HTTP clients, caches, or instance facades.

## Design judgment

Build a small set of composition primitives, not a framework that generates domain clients and servers. The library should make lifecycle correctness automatic while leaving domain operations, errors, schemas, handlers, and persistence policy explicit.

A possible package layout is:

```text
packages/durable-object-http/
  src/
    durable-object-http-client.ts
    durable-object-http-server.ts
    durable-object-sqlite.ts
    index.ts
```

Possible public namespaces:

```ts
import {
  DurableObjectHttpClient,
  DurableObjectHttpServer,
  DurableObjectSqlite,
} from "@overseer/durable-object-http";
```

## Keyed Durable Object HTTP clients

Resources such as Workspaces, Projects, and Issues have many Durable Object instances selected by branded domain IDs:

```ts
const workspaceHttpClient =
  yield *
  DurableObjectHttpClient.keyed({
    namespace: WorkspaceServer,
    api: WorkspaceHttpApi,
    baseUrl: "http://workspace.internal",
  });
```

The returned accessor remains private to `makeWorkspaceClient`:

```ts
const client = yield * workspaceHttpClient(workspaceId);
```

A conceptual API is:

```ts
interface KeyedClientOptions<Api, Namespace> {
  readonly namespace: Namespace;
  readonly api: Api;
  readonly baseUrl: string;
}

function keyed<Id, Api>(
  options: KeyedClientOptions<Api, DurableObjectNamespace>,
): Effect.Effect<
  (id: Id) => Effect.Effect<HttpApiClient.ForApi<Api>, never, Alchemy.RuntimeContext>,
  never,
  Cloudflare.Worker
>;
```

Internally, the primitive should:

1. Yield the namespace during Alchemy Init.
2. Allocate one `Cache` per execution with `makeExecutionMemo`.
3. Key that cache by the canonical domain ID.
4. Suspend `namespace.getByName(id)` until a runtime lookup.
5. Join concurrent first lookups for the same ID.
6. Return a runtime-colored accessor.

Conceptually:

```ts
export const keyed = Effect.fn("DurableObjectHttpClient.keyed")(function* <Id extends string, Api>(
  options: KeyedClientOptions<Api>,
) {
  const namespace = yield* options.namespace;

  const clients = yield* makeExecutionMemo(
    Cache.make<Id, HttpApiClient.ForApi<Api>>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: (id) =>
        Effect.suspend(() =>
          HttpApiClient.makeWith(options.api, {
            baseUrl: options.baseUrl,
            httpClient: Cloudflare.toHttpClient(namespace.getByName(id)),
          }),
        ),
    }),
  );

  return (id: Id) => Effect.flatMap(clients, (cache) => Cache.get(cache, id));
});
```

The real implementation should preserve branded IDs. Requiring `Id extends string` is appropriate for Overseer's branded string IDs; a more general library could accept an explicit `key: (id: Id) => string` conversion.

## Singleton Durable Object HTTP clients

Bookkeeper has exactly one target:

```ts
const bookkeeperHttpClient =
  yield *
  DurableObjectHttpClient.singleton({
    namespace: BookkeeperServer,
    name: BOOKKEEPER_ID,
    api: BookkeeperHttpApi,
    baseUrl: "http://bookkeeper.internal",
  });
```

Usage remains private to the application client:

```ts
const client = yield * bookkeeperHttpClient;
```

Conceptually:

```ts
export const singleton = Effect.fn("DurableObjectHttpClient.singleton")(function* (options) {
  const namespace = yield* options.namespace;

  return yield* makeExecutionMemo(
    Effect.suspend(() =>
      HttpApiClient.makeWith(options.api, {
        baseUrl: options.baseUrl,
        httpClient: Cloudflare.toHttpClient(namespace.getByName(options.name)),
      }),
    ),
  );
});
```

Do not implement the singleton form as a keyed cache containing one key. Its separate API communicates the stronger invariant and avoids unnecessary machinery.

## Domain clients remain explicit

The generic package should never generate `WorkspaceClient`. It supplies only the private transport recipe:

```ts
export const makeWorkspaceClient = Effect.gen(function* () {
  const workspaceHttpClient = yield* DurableObjectHttpClient.keyed({
    namespace: WorkspaceServer,
    api: WorkspaceHttpApi,
    baseUrl: "http://workspace.internal",
  });

  return WorkspaceClient.of({
    getWorkspace: Effect.fn("WorkspaceClient.getWorkspace")(function* (id) {
      const client = yield* workspaceHttpClient(id);

      return yield* client.workspace.getWorkspace().pipe(
        // Workspace-owned error translation
      );
    }),

    createWorkspace: Effect.fn("WorkspaceClient.createWorkspace")(function* (input) {
      const id = yield* generateWorkspaceId;
      const client = yield* workspaceHttpClient(id);

      return yield* client.workspace
        .createWorkspace({
          payload: { id, name: input.name },
        })
        .pipe(
          // Workspace-owned error translation
        );
    }),
  });
});
```

The ownership boundary is:

```text
Generic package owns:
  Alchemy phases
  execution-scope lifetime
  stub construction
  HttpApiClient construction
  keyed or singleton caching

Application client owns:
  domain IDs
  domain operations
  ID generation
  expected errors
  error translation
  protocol payloads
```

## Durable Object HTTP server primitive

Keep the outer Alchemy constructor visible. A generic server helper should only remove repetitive HTTP router wiring:

```ts
export const makeDurableObjectHttpServer = <Api, Handlers>(options: {
  readonly api: Api;
  readonly handlers: Layer.Layer<Handlers>;
  readonly platform?: Layer.Layer<never>;
}) =>
  Effect.gen(function* () {
    const fetch = yield* HttpApiBuilder.layer(options.api).pipe(
      Layer.provide(options.handlers),
      Layer.provide(options.platform ?? durableObjectBaseHttpServerLayer),
      HttpRouter.toHttpEffect,
    );

    return { fetch };
  });
```

Bookkeeper should remain visibly two-phase:

```ts
export class BookkeeperServer extends Cloudflare.DurableObject<BookkeeperServer>()(
  "BookkeeperServer",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    const databaseLayer = DurableObjectSqlite.provide(
      bookkeeperDatabaseLayerWithoutDependencies,
      state,
    );

    const handlersLayer = bookkeeperHttpHandlersLayer.pipe(Layer.provide(databaseLayer));

    return DurableObjectHttpServer.make({
      api: BookkeeperHttpApi,
      handlers: handlersLayer,
    });
  }),
) {}
```

`DurableObjectHttpServer.make(...)` must return the inner runtime Effect. It must not build handlers, databases, or routers during Alchemy's outer planning pass.

## Durable Object SQLite primitive

The SQLite adapter should remain small:

```ts
const databaseLayer = DurableObjectSqlite.provide(workspaceDatabaseLayerWithoutDependencies, state);
```

Conceptually:

```ts
export const provide = <Service, Error, Requirements>(
  databaseLayer: Layer.Layer<Service, Error, SqlClient.SqlClient | Requirements>,
  state: Cloudflare.DurableObjectState["Service"],
): Layer.Layer<Service, Error, Requirements> =>
  databaseLayer.pipe(
    Layer.provide(
      SqliteClient.layer({
        storage: state.raw.storage,
      }),
    ),
  );
```

This primitive should not own:

- database schemas;
- migrations;
- SQL queries;
- domain parsing;
- transaction policy.

Those remain in application modules such as `WorkspaceDatabase` and `BookkeeperDatabase`.

## Complete Workspace server example

```ts
export class WorkspaceServer extends Cloudflare.DurableObject<WorkspaceServer>()(
  "WorkspaceServer",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const bookkeeper = yield* BookkeeperClient;

    const databaseLayer = DurableObjectSqlite.provide(
      workspaceDatabaseLayerWithoutDependencies,
      state,
    );

    const handlersLayer = workspaceHttpHandlersLayer.pipe(
      Layer.provide(databaseLayer),
      Layer.provide(Layer.succeed(BookkeeperClient, bookkeeper)),
    );

    return DurableObjectHttpServer.make({
      api: WorkspaceHttpApi,
      handlers: handlersLayer,
    });
  }).pipe(Effect.provide(bookkeeperClientLayer)),
) {}
```

This preserves the Alchemy two-phase structure where reviewers can inspect it.

## Runtime coloring

Client accessors should require `Alchemy.RuntimeContext`:

```ts
type DurableObjectRuntimeClient<Client, Error = never> = Effect.Effect<
  Client,
  Error,
  Alchemy.RuntimeContext
>;
```

This makes accidental Init-time usage a compile error:

```ts
Effect.gen(function* () {
  const clientFor = yield* DurableObjectHttpClient.keyed(/* ... */);

  // Compile error during Init:
  yield* clientFor(workspaceId);

  return {
    fetch: Effect.gen(function* () {
      // Valid inside a runtime handler:
      const client = yield* clientFor(workspaceId);
    }),
  };
});
```

Runtime coloring is stronger than relying only on `Effect.suspend`: suspension fixes evaluation timing, while the requirement prevents an invalid call site from type-checking.

## APIs to avoid

Do not add broad generators such as:

```ts
DurableObject.define(/* ... */);
DurableObjectRepository(/* ... */);
DurableObjectCrud(/* ... */);
DurableObjectEntity(/* ... */);
generateClientAndServer(/* ... */);
```

Those would conflate infrastructure identity, transport, persistence, domain behavior, lifecycle transitions, and error contracts.

## Recommended initial API

```ts
DurableObjectHttpClient.keyed(/* ... */);
DurableObjectHttpClient.singleton(/* ... */);

DurableObjectHttpServer.make(/* ... */);

DurableObjectSqlite.provide(/* ... */);
```

Implement only `keyed` and `singleton` first if this design is extracted. They already have two concrete consumers and remove lifecycle-sensitive duplication. The server and SQLite helpers save less code and should wait until Project or Issue confirms the same composition shape.

## Required verification before publication

A publishable implementation should include tests proving:

- planning can build a client service without invoking `getByName`;
- the same key in one execution scope returns the same generated client;
- concurrent first access for one key joins one construction;
- different keys in one scope receive different clients;
- the same key in a later scope receives a fresh client;
- singleton clients construct once per scope;
- runtime accessors require `Alchemy.RuntimeContext` at the type level;
- server database and handler Layers are acquired only in the inner runtime Effect;
- database migrations do not execute during planning.
