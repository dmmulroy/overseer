Our Durable Object pattern is a **typed internal HTTP client/server architecture**, with Effect defining the contracts and Alchemy wiring the Cloudflare resources.

## Request flow

```text
Public request
  → ApiWorker
  → OverseerSdk
  → WorkspaceClient
  → WorkspaceServer DO selected by WorkspaceId
  → Workspace HTTP handlers
  → Workspace SQLite

                         └→ BookkeeperClient
                           → singleton BookkeeperServer DO
                           → Bookkeeper SQLite
```

There is no real network hop between the Worker and DOs. The calls use Cloudflare DO stubs.

## 1. Shared Effect HTTP contract

Each DO has an `HttpApi` describing paths, payloads, responses, and typed errors:

```ts
export class WorkspaceHttpApi extends HttpApi.make("WorkspaceHttpApi")
  .add(WorkspaceHttpApiGroup)
  .prefix("/v1") {}
```

`apps/api/src/durable-objects/workspaces/workspace-http-api.ts`

That same contract drives both:

- server routing and validation
- generated client methods and response decoding

This prevents the client and server protocols from drifting.

## 2. Server side

`WorkspaceServer` is an Alchemy Effect-native DO:

```ts
export class WorkspaceServer extends Cloudflare.DurableObject<WorkspaceServer>()(
  "WorkspaceServer",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    // construct instance dependencies

    return Effect.gen(function* () {
      const fetch = yield* HttpRouter.toHttpEffect(/* HttpApi layers */);
      return { fetch };
    });
  }),
) {}
```

`apps/api/src/durable-objects/workspaces/workspace-server.ts`

The important split is:

1. **Outer DO initialization**
   - obtains `DurableObjectState`
   - connects `state.raw.storage` to `SqliteClient`
   - resolves instance-level services such as `BookkeeperClient`
   - is also evaluated by Alchemy during dependency discovery

2. **Inner runtime implementation**
   - builds the `HttpApiBuilder` handler layer
   - converts it with `HttpRouter.toHttpEffect`
   - returns `{ fetch }`

Alchemy’s `DurableObjectBridge` turns that Effect `fetch` handler into Cloudflare’s native DO `fetch(Request): Response`.

We do not run an HTTP server inside the DO. The DO stub is the server adapter.

## 3. Client side

The application does not expose namespaces or stubs. It exposes an Effect service:

```ts
export class WorkspaceClient extends Context.Service<WorkspaceClient, IWorkspaceClient>()(
  "@overseer/WorkspaceClient",
) {}
```

`WorkspaceClient`:

1. yields `WorkspaceServer`, obtaining Alchemy’s namespace handle
2. selects an instance with `namespace.getByName(workspaceId)`
3. adapts the stub into an Effect HTTP client:

```ts
HttpApiClient.makeWith(WorkspaceHttpApi, {
  baseUrl: "http://workspace.internal",
  httpClient: Cloudflare.toHttpClient(namespace.getByName(id)),
});
```

`Cloudflare.toHttpClient` short-circuits requests to `stub.fetch`; the internal hostname is only used to construct request URLs.

The generated HTTP client is then wrapped in application operations such as:

```ts
workspaceClient.getWorkspace(id);
workspaceClient.renameWorkspace({ id, name });
```

Those wrappers hide transport details and translate HTTP/schema failures into domain errors.

## 4. Why `makeExecutionMemo` matters

Alchemy evaluates Worker and DO initialization Effects during planning to discover bindings. At that point, yielding a namespace is valid, but calling:

```ts
namespace.getByName(...)
```

is not—the concrete runtime binding does not exist yet.

Therefore our clients defer stub construction until an actual Worker request or DO call:

```ts
const clients = yield * makeExecutionMemo(/* lazy client construction */);
```

`makeExecutionMemo` provides:

- no stub creation during Alchemy planning
- one memo/cache per Worker event or DO call
- concurrent callers joining the same initialization
- cleanup when the execution scope closes
- no reuse of Cloudflare I/O objects across execution contexts

For Workspaces, that execution-local cache is keyed by `WorkspaceId`. For Bookkeeper, it memoizes one client to the fixed `BOOKKEEPER_ID`.

## 5. How Alchemy discovers everything

The stack only explicitly creates the API Worker:

```ts
const api = yield * ApiWorker;
```

But the Effect dependency graph reaches the DOs:

```text
ApiWorker
  → overseerSdkLayer
  → WorkspaceClient
  → yield* WorkspaceServer
  → BookkeeperClient
  → yield* BookkeeperServer
```

Alchemy observes those yielded resources and automatically:

- exports both DO classes from the Worker
- creates the namespace bindings
- generates SQLite DO migrations
- wires the bindings in deployed Cloudflare
- creates equivalent local workerd namespaces during `alchemy dev`

So dependency injection and infrastructure declaration are effectively the same graph.

## 6. Bookkeeper relationship

`WorkspaceServer` injects a `BookkeeperClient` into its handlers. Workspace mutations can therefore perform a direct DO-to-DO call:

```text
WorkspaceServer(id)
  → BookkeeperClient
  → BookkeeperServer("bookkeeper")
```

Because this is a non-atomic cross-DO protocol, Workspace mutation handlers use a per-instance semaphore to preserve mutation ordering while the Bookkeeper request is suspended.

## In short

- **Effect `HttpApi`** is the shared protocol.
- **DO server classes** turn handlers into an Effect `fetch`.
- **Application clients** hide namespace/stub/generated-client details.
- **`Cloudflare.toHttpClient`** sends internal HTTP directly through `stub.fetch`.
- **`makeExecutionMemo`** keeps runtime-only clients lazy and execution-scoped.
- **Alchemy** discovers the DO dependency graph and provisions bindings, exports, migrations, and local workerd state.
