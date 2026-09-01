Our Durable Object pattern is a **typed internal HTTP client/server architecture**, with Effect defining contracts and Alchemy wiring Cloudflare resources.

## Request flow

```text
Public request
  → ApiWorker
  → OverseerSdk
  → WorkspaceClient
  → WorkspaceServer DO selected by WorkspaceId
  → Workspace HTTP handlers
  → Workspace SQLite
```

There is no real network hop between the Worker and Durable Objects. Calls use Cloudflare Durable Object stubs.

## 1. Shared Effect HTTP contract

Each Durable Object has an `HttpApi` describing paths, payloads, responses, and typed errors:

```ts
export class WorkspaceHttpApi extends HttpApi.make("WorkspaceHttpApi")
  .add(WorkspaceHttpApiGroup)
  .prefix("/v1") {}
```

`apps/api/src/durable-objects/workspaces/workspace-http-api.ts`

The same contract drives server routing and validation plus generated client methods and response decoding. This prevents the client and server protocols from drifting.

## 2. Server side

`WorkspaceServer` is an Alchemy Effect-native Durable Object. Its composition root:

1. obtains `Cloudflare.DurableObjectState`;
2. adapts `state.raw.storage` with `SqliteClient`;
3. provides `WorkspaceDatabase` to the Workspace HTTP handlers;
4. converts the resulting API layer with `HttpRouter.toHttpEffect`;
5. returns the `{ fetch }` implementation.

Alchemy evaluates the outer constructor during dependency discovery. State-backed database acquisition and migrations therefore remain in the returned runtime Effect. Alchemy's Durable Object bridge turns the Effect handler into Cloudflare's native `fetch(Request): Response`; no separate HTTP server runs inside the Durable Object.

`apps/api/src/durable-objects/workspaces/workspace-server.ts`

## 3. Client side

Application code receives the `WorkspaceClient` Effect service rather than a namespace or stub. The client:

1. yields `WorkspaceServer` to obtain Alchemy's namespace handle;
2. selects an instance with `namespace.getByName(workspaceId)`;
3. adapts the stub into an Effect HTTP client with `Cloudflare.toHttpClient`;
4. translates generated HTTP client failures into domain errors.

The internal `http://workspace.internal` hostname only constructs request URLs; `Cloudflare.toHttpClient` sends requests directly through `stub.fetch`.

`apps/api/src/durable-objects/workspaces/workspace-client.ts`

## 4. Why `makeExecutionMemo` matters

Alchemy can yield a namespace while planning, but the concrete runtime binding required by `namespace.getByName(...)` does not exist yet. `WorkspaceClient` therefore defers stub-backed client construction until an actual Worker invocation.

`makeExecutionMemo` provides an execution-local cache keyed by `WorkspaceId`, so concurrent calls in one invocation share initialization while Cloudflare I/O objects are never reused across execution contexts.

## 5. Infrastructure discovery

The stack explicitly creates the API Worker, and Alchemy discovers the Workspace Durable Object through the Effect dependency graph:

```text
ApiWorker
  → overseerSdkLayer
  → WorkspaceClient
  → WorkspaceServer
```

Alchemy uses that graph to export the Durable Object class, create namespace bindings and SQLite migrations, and configure equivalent local workerd state.

## In short

- **Effect `HttpApi`** is the shared internal protocol.
- **`WorkspaceServer`** owns Workspace SQLite persistence.
- **`WorkspaceClient`** hides namespace, stub, and generated-client details.
- **`makeExecutionMemo`** keeps runtime-only clients lazy and execution-scoped.
- **Alchemy** discovers and provisions the Worker-to-Durable-Object dependency graph.
