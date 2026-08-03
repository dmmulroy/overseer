# Alchemy v2 Durable Objects and Effect HTTP

**Research status:** verified against the checked-out Alchemy and Effect sources in this repository and first-party documentation fetched during this research. Local line numbers refer to the current checkout and may move as those repositories change. No implementation files or `planning.md` were changed.

## Executive summary

- **[Verified]** An Alchemy v2 Durable Object (DO) is both a Cloudflare namespace/binding resource and, for an Effect-native Worker, an exported class whose implementation has an outer initialization Effect and an inner per-instance/runtime Effect. The public value returned by the inner Effect is the DO shape. (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts:335-409, 1108-1339`.)
- **[Verified]** A Worker does not call a DO through a public URL. It obtains a namespace binding, derives a stub with `getByName`/`get`, then invokes either typed RPC methods or the stub's `fetch`. This agrees with Cloudflare's official model: DOs receive requests from Workers or other DOs, not directly from the Internet. ([Cloudflare getting started](https://developers.cloudflare.com/durable-objects/get-started/); local Alchemy docs `durable-objects.mdx:829-857`).
- **[Verified]** For an HTTP API inside a DO, the natural Alchemy/Effect composition is to build an `HttpEffect` with `HttpApiBuilder` + `HttpRouter.toHttpEffect` and return it as the DO's `fetch` member. A DO does not need to start a TCP listener or use `HttpServer.serve`. (`repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/http-api/object.ts:31-65`.)
- **[Verified]** For a Worker calling a DO's HTTP API, the strongest existing pattern is `Cloudflare.toHttpClient(stub)` plus `HttpApiClient.makeWith(...)`. The configured `baseUrl` is syntactic only; the adapter converts the client request directly to a DO `fetch` call inside the isolate. (`repos/alchemy/website/src/content/docs/cloudflare/apis/effect-http-api.mdx:555-604`; `repos/alchemy/packages/alchemy/src/Cloudflare/Fetcher.ts:184-241`.)
- **[Recommendation]** Use schemaless typed RPC for internal Worker-to-DO procedures when the operation is naturally a method. Use HTTP/`HttpApi` inside the DO when the boundary is intentionally request-shaped (routing, WebSockets, or an HTTP contract shared with other clients). Cloudflare itself recommends RPC for new projects, while retaining `fetch` for HTTP request/response flows ([Cloudflare invoke methods](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/)).
- **[Out of scope]** This report does not choose or design the Drizzle integration.

## 1. Cloudflare's model (first-party facts)

### Identity, storage, and activation

- **[Verified]** A namespace is the set of instances backed by one DO class; it can contain any number of instances. `idFromName`/`getByName` deterministically address an instance, while `newUniqueId` creates an ID that must be stored if it will be reused. Merely creating an ID or stub does not instantiate the object; activation is lazy when a method or `fetch` is called. ([Durable Object Namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/), especially `idFromName`, `newUniqueId`, `get`, and `getByName`.)
- **[Verified]** Each DO has a globally unique identity, colocated durable storage, and single-threaded coordination. Cloudflare describes this as the stateful counterpart to stateless Workers. ([Cloudflare overview](https://developers.cloudflare.com/durable-objects/); [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).)
- **[Verified]** New classes should use SQLite-backed DO storage. In Cloudflare's current configuration model, the class export declares `storage: "sqlite"`; the legacy model uses a migration entry such as `new_sqlite_classes`. ([Cloudflare getting started](https://developers.cloudflare.com/durable-objects/get-started/#5-configure-durable-object-class-with-sqlite-storage-backend).)

### Bindings and request routing

- **[Verified]** A calling Worker needs an upload-time binding with a binding name and class name; `script_name` is optional and selects a different Worker as the host. ([Cloudflare getting started](https://developers.cloudflare.com/durable-objects/get-started/#4-configure-durable-object-bindings).)
- **[Verified]** The default modern path is a public class method exposed through the typed `DurableObjectStub`. Calls are asynchronous and serializable. Cloudflare's documented legacy/HTTP path is `await stub.fetch(request)`. The request URL must be a well-formed URL, but need not resolve publicly. ([Cloudflare invoke methods](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/).)
- **[Verified]** Calls to the same stub have E-order semantics; different stubs do not have ordering guarantees. If a stub call throws an exception, Cloudflare says the Worker must recreate the stub before continuing to invoke that object. ([Durable Object Stub API](https://developers.cloudflare.com/durable-objects/api/stub/).)
- **[Verified]** A DO is created near the first request by default and does not move. `locationHint` is best effort and applies only to the first `get`/`getByName` for that object. Jurisdiction is a separate, stronger data-location constraint. ([Cloudflare data location](https://developers.cloudflare.com/durable-objects/reference/data-location/).)

### Lifecycle and state constraints

- **[Verified]** DOs start when needed and can shut down when idle. In-memory properties therefore cannot be the source of durable truth; important state belongs in the DO's storage. Cloudflare's examples explicitly distinguish in-memory cache/state from SQLite persistence. ([Cloudflare overview](https://developers.cloudflare.com/durable-objects/); [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), “Understand the difference between in-memory state and persistent storage”.)
- **[Verified]** Cloudflare's input/output gates and storage APIs provide consistency protections, but non-storage I/O can allow interleaving. Cloudflare recommends `blockConcurrencyWhile` for initialization/migrations, not as a lock around every request. ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), “Understand input and output gates” and “Use `blockConcurrencyWhile()` sparingly”.)
- **[Limitation]** This means a DO is not a general-purpose globally distributed HTTP server. It is a single-location coordination atom. Shard by the domain entity that needs serialization; do not route all unrelated entities to one name. ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), “Model your Durable Objects around your atom of coordination”.)

## 2. Alchemy v2 Durable Object declarations

### Resource forms and configuration

The primary local API is `Cloudflare.DurableObject`.

- **Effect-native inline class:**

  ```ts
  export default class Counter extends Cloudflare.DurableObject<Counter>()(
    "Counter",
    Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;
      return Effect.gen(function* () {
        return { get: () => Effect.succeed(0) };
      });
    }),
  ) {}
  ```

  The class-form overload and two-phase shape are declared in `DurableObjectClass` and documented in `DurableObject` (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts:261-327, 335-409`).

- **Effect-native modular class:** define the lightweight class with `Cloudflare.DurableObject<Self>()("Name")`, then export `Counter.make(implementation)` (same file or another file). Alchemy documents this specifically for circular Worker/DO dependencies and multiple consumers; the implementation can be tree-shaken out of consumer bundles (`DurableObject.ts:411-469`).

- **Async/resource-only descriptor:** `Cloudflare.DurableObject<Shape>("BindingName", props)` returns a binding descriptor for a plain `async fetch` Worker. The async Worker must export the actual `cloudflare:workers` `DurableObject` subclass. Alchemy's docs show the descriptor in `env`, with `className` matching the exported class (`DurableObject.ts:863-908`; `examples/cloudflare-dev/alchemy.run.ts:20-38`).

The currently implemented public `DurableObjectProps` are:

- `className?: string`: exported class name; defaults to the namespace/resource name (`DurableObject.ts:219-225, 1261-1268`).
- `scriptName?: Input<string>`: foreign Worker script that hosts the class; omit it for a class hosted by the declaring Worker (`DurableObject.ts:227-230`).
- `transferredFrom?: DurableObjectTransferSource | ...[]`: explicit data-preserving host transfer declaration. Accepted sources include a logical ID, physical script name, Worker resource/class, or thunk; a list preserves host history (`DurableObject.ts:129-217, 231-255`; `DurableObject.ts:977-1055`).

`DurableObject.ts:256-259` contains commented-out `environment`, `sqlite`, and `namespaceId` properties. **[Verified limitation]** those are not current public `DurableObjectProps` controls in this checkout. Alchemy's provider instead chooses SQLite by default for newly reconciled classes.

The namespace handle type includes `getByName`, `get`, `idFromName`, `idFromString`, `newUniqueId`, `jurisdiction`, and `namespaceId` (`DurableObject.ts:81-107`). The concrete binding construction currently materializes `getByName` and intentionally leaves the other direct helpers commented in the implementation (`DurableObject.ts:1178-1210`). **[Recommendation]** use the helpers actually exposed by the current Alchemy handle—especially `getByName`—rather than assuming every Cloudflare namespace helper has an Alchemy convenience wrapper.

### How declarations become bindings and classes

- **[Verified]** The Effect class implementation calls `worker.bind` with a `durable_object_namespace` descriptor containing the binding name, class name, optional foreign `scriptName`, and normalized transfer source (`DurableObject.ts:1135-1155`). It resolves the runtime namespace from `WorkerEnvironment` after plan time and fails if the expected binding is missing (`DurableObject.ts:1158-1189`).
- **[Verified]** `yield* Counter` does more than obtain a typed value: `DurableObject.make` registers a local binding, evaluates the constructor during plan time with a storage mock to discover dependencies, and calls `Worker.export(..., { kind: "durableObject", constructor, services })` (`DurableObject.ts:1218-1254`). This is the class/resource construction seam.
- **[Verified]** `DurableObjectShape` supports an optional `fetch` `HttpEffect`, `alarm`, and WebSocket event handlers (`DurableObject.ts:103-119`). The returned methods become RPC members through the bridge; the typed stub is the shape plus `fetch` (`DurableObject.ts:580-638, 1333-1344`).
- **[Verified]** For async `env` values, `WorkerAsyncBindings.toBinding` classifies a DO-like resource as a `durable_object_namespace` binding with `name`, `className`, `scriptName`, and transfer metadata (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerAsyncBindings.ts:322-355`).

### Worker-level configuration and binding surface

`Cloudflare.Worker` accepts `main`, `script`, `bundle`, compatibility settings, assets, `env`, development settings, version settings, and other Worker-level controls (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts:566-729`). For this question the important distinction is:

- **Effect-native Worker:** yield the DO class in the Worker init Effect (`yield* Counter`) and return the Worker's `{ fetch }` shape. The class export and binding metadata are discovered from the Effect resource.
- **Async Worker:** put the descriptor in `env`, e.g. `Counter: Cloudflare.DurableObject<Counter>("Counter", { className: "Counter" })`, and use `Cloudflare.InferEnv` for the typed namespace (`examples/cloudflare-dev/alchemy.run.ts:20-38`; `DurableObject.ts:863-908`).
- **Cross-script Worker:** the host exports/binds the class; the consumer uses `scriptName` (async form) or the modular class's `Counter.from(HostWorker)` (Effect form). Alchemy's type-level contract requires the host Worker to list the DO in its `Deps` type for `from` to type-check (`DurableObject.ts:471-536, 909-976`).

## 3. Alchemy deploy and local lifecycle

### Deploy reconciliation

- **[Verified]** `WorkerProvider` reconciles the current logical-id-to-class mapping and emits `newSqliteClasses` for new classes by default. It emits `renamedClasses`, `deletedClasses`, and `transferredClasses` when the observed state requires them (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerProvider.ts:3240-3320`).
- **[Verified]** Alchemy records the logical-id/class mapping in compact `alchemy:dos:` tags because Cloudflare has a script tag limit (`WorkerProvider.ts:3270-3305`). This is why a binding's logical resource identity is important even if its physical class name changes.
- **[Verified]** Pre-create uploads a temporary Worker that exports every hosted class and supplies SQLite migrations, then the real Worker upload/reconciliation follows. Transfer destination classes are excluded from pre-create because Cloudflare must receive the `transferred_classes` migration rather than seeing a fresh class first (`WorkerProvider.ts:4180-4355`).
- **[Verified limitation]** A class move is not inferred. Declare `transferredFrom`; otherwise the old host's continued reference causes `DurableObjectTransferRequired`. Pure moves require ordering care: Alchemy's docs say add/transfer to the new host first, then remove the old host in a later deploy. Cross-stack moves deploy the destination first (`DurableObject.ts:977-1055`).
- **[Verified limitation]** A version Worker (`version.parent`) cannot host local DO classes because its upload cannot carry class migrations; Alchemy rejects exported/local classes and rejects gradual rollout when a deploy changes DO migrations (`WorkerProvider.ts:2500-2590, 3350-3395`).

### Local development

- **[Verified]** `LocalWorkerProvider.resolveConfig` turns local hosted DO bindings into workerd descriptors with a stable encoded namespace key and `sql: true`; the descriptor is included in the local worker's desired state (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts:300-450`).
- **[Verified]** Local runtime conversion uses `DurableObjectNamespace.local({ binding, className, scriptName, uniqueKey })` (`LocalWorkerProvider.ts:1031-1078`). Local Workers run in workerd and each Worker gets its own dev server/port; this is the default `WorkerProps.dev` mode (`Worker.ts:730-790`).
- **[Verified]** Alchemy's local provider starts/restarts the local Worker from canonical desired config, while retaining local namespace keys across a restart where possible (`LocalWorkerProvider.ts:500-620, 875-1005`). The local namespace is an emulator, not the production namespace or production placement.
- **[Verified limitation]** Alchemy documents that `locationHint` is accepted but ignored under `alchemy dev`, because there is only one local location; placement is observable only after deployment (`website/src/content/docs/cloudflare/compute/durable-objects.mdx:396-443`).
- **[Verified]** The local `cloudflare-dev` example exercises both forms side by side: async `Counter`/`QueueMessages` classes in `src/AsyncWorker.ts`, Effect-native `QueueMessages` in `src/EffectWorker.ts`, and descriptor bindings in `alchemy.run.ts:20-38`. This is a useful lifecycle and typing reference, not evidence that local storage is production storage.

## 4. Fetch and routing behavior in Alchemy

### DO-side fetch

Alchemy's `DurableObjectBridge` is the runtime adapter:

1. It builds the Worker/DO dependency context once per isolate and constructs the DO under `state.blockConcurrencyWhile` (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectBridge.ts:38-79`).
2. It proxies unknown properties to public DO methods and runs returned Effects in a fresh call scope (`DurableObjectBridge.ts:80-163`).
3. Its `fetch(request)` branch invokes `makeRequestEffect` when the DO shape has `fetch`; otherwise it returns a 404 “Not implemented” response (`DurableObjectBridge.ts:174-189`).
4. `makeRequestEffect` converts the Cloudflare Web `Request` to an Effect `HttpServerRequest`, supplies it in context, runs the safe HTTP Effect, then converts the Effect response to a Web `Response` (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/HttpServer.ts:15-76`).

Thus an Alchemy Effect DO's `fetch` is not a URL listener. It is a request-to-response Effect invoked by the Cloudflare DO binding. The method sees the request's URL/path/method/body through Effect's request service.

### Worker-side forwarding

There are two verified forms:

```ts
// Raw request-shaped forwarding; useful for WebSockets and pass-through APIs.
const request = yield* HttpServerRequest;
const room = rooms.getByName(roomId);
return yield* room.fetch(request);
```

This is the documented Alchemy pattern (`DurableObject.ts:628-638, 849-857`) and is used by the real example for WebSocket rooms (`repos/alchemy/examples/cloudflare-worker/src/Api.ts:218-235`). `Room.ts` implements the corresponding DO `fetch` with `Cloudflare.upgrade()` and returns WebSocket handlers (`examples/cloudflare-worker/src/Room.ts:11-81`).

For an async Worker, the equivalent is the Cloudflare-native `const stub = env.DO.getByName(name); return stub.fetch(request);` shown in the Cloudflare invoke-methods documentation. For an Effect Worker, the request must be the Alchemy/Effect `HttpServerRequest` expected by the typed stub, not an arbitrary raw object.

### RPC versus HTTP

- **Schemaless Alchemy RPC:** functions returned by the inner Effect become typed methods; the caller gets `Effect`-returning stubs. Streams can be returned and forwarded as `HttpServerResponse.stream` (`DurableObject.ts:580-626`). This is the best existing internal pattern when the operation is a method.
- **HTTP fetch:** the DO owns URL/method/path routing and can receive a full request. It is the right shape for an HTTP contract, request-body parsing, WebSocket upgrade, or a request that should be forwarded without converting it into method arguments.
- **`RpcDurableObject`:** Alchemy also has a schema-based Effect RPC wrapper over the DO `fetch` (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/RpcDurableObject.ts:1-133, 161-220`). The local Alchemy docs call it a niche when schema validation or `Schema.Class` identity matters, not the default for ordinary internal DO calls (`durable-objects.mdx:361-394`).

## 5. Composing Effect HTTP inside a Durable Object

### The composition root

Effect's vendored HTTP server API is a service for a concrete server adapter: `HttpServer.serve` consumes an Effect that needs the current `HttpServerRequest` and produces an `HttpServerResponse` (`repos/effect/packages/effect/src/unstable/http/HttpServer.ts:38-183`). A Cloudflare DO already supplies the concrete event adapter through Alchemy's bridge, so **do not start `HttpServer.serve` or a Node/Bun listener inside the DO**.

The correct composition is an `HttpEffect`:

```ts
const group = HttpApiBuilder.group(TaskDOApi, "TasksDO", (handlers) =>
  handlers
    .handle("getTask", ({ params }) =>
      state.storage.get<Task>(params.id).pipe(
        Effect.flatMap(decodeTask),
        Effect.orDie,
      ),
    )
    .handle("createTask", ({ payload }) => {
      const task = new Task(/* ... */);
      return state.storage.put(task.id, encodeTask(task)).pipe(Effect.as(task));
    }),
);

return {
  fetch: HttpApiBuilder.layer(TaskDOApi).pipe(
    Layer.provide(group),
    Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
    HttpRouter.toHttpEffect,
  ),
};
```

This is not hypothetical: it is the checked-in integration fixture (`repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/http-api/object.ts:31-65`) and is also documented in the official Alchemy site (`https://alchemy.run/cloudflare/apis/effect-http-api/#bonus-route-some-endpoints-to-a-durable-object`).

### Why the layers look this way

- Keep the schema/API declaration outside the runtime root. `TaskDOApi` is a pure value-level description.
- Build handler groups in init; `HttpApiBuilder.group` constructs a Layer and does not run a request.
- Convert the assembled Layer once with `HttpRouter.toHttpEffect`, returning the resulting handler as `fetch`.
- Provide `Etag.layer`, `Path.layer`, and a Worker-safe `HttpPlatform` implementation. The Alchemy docs provide `HttpPlatformStub` whose file methods die because Workers have no filesystem (`website/src/content/docs/cloudflare/apis/effect-http-api.mdx:223-265, 493-553`).
- Use `HttpServerRequest` only inside a request handler. The service is defined as the current request context (`repos/effect/packages/effect/src/unstable/http/HttpServerRequest.ts:49-119`).

`HttpServerResponse.text`, `json`, `stream`, and `toWeb` are the relevant response primitives. `stream` accepts byte chunks, and `toWeb` turns an Effect response into a Web `Response`, including stream bodies (`repos/effect/packages/effect/src/unstable/http/HttpServerResponse.ts:196-216, 289-447, 965-1030`).

### State boundary

Alchemy's `DurableObjectState` is the composition-root service for the DO instance. Resolve the reference in the outer Effect; use `state.storage`, `state.waitUntil`, and other runtime-context-colored methods inside the inner Effect (`DurableObject.ts:671-700`; `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectState.ts:9-83`). This keeps storage access at the DO boundary while allowing HTTP handlers to depend on a narrow domain/storage service rather than raw Cloudflare state.

## 6. Effect HTTP client usage from a Worker

### General HTTP client API

The vendored Effect client is transport-independent. `HttpClient` executes immutable `HttpClientRequest` values and returns `HttpClientResponse` values; it provides `execute`, `get`, `post`, status filtering, and client construction (`repos/effect/packages/effect/src/unstable/http/HttpClient.ts:1-114, 165-236, 569-635`). `HttpClientRequest` provides `get`/`post`, JSON body encoders, and Web request conversion (`HttpClientRequest.ts:141-183, 648-749, 903-1002`). `HttpClientResponse` provides JSON/body access, response streams, status matching, and `filterStatusOk` (`HttpClientResponse.ts:66-80, 140-234`).

For ordinary external HTTP from a Worker, provide `FetchHttpClient.layer`. It uses the Web Fetch API, defaults to `globalThis.fetch`, and is expressly intended for browsers and edge runtimes (`repos/effect/packages/effect/src/unstable/http/FetchHttpClient.ts:1-15, 22-66, 91-123`). A composition-root sketch is:

```ts
const program = Effect.gen(function* () {
  const response = yield* HttpClient.get("https://example.com");
  return yield* response.text;
}).pipe(Effect.provide(FetchHttpClient.layer));
```

**[Recommendation]** keep the transport Layer in the Worker composition root and inject a client/service into handlers. Do not import `globalThis.fetch` into deep domain code merely because Cloudflare supplies it.

### Worker to DO HTTP as an Effect client

The existing Alchemy adapter is the important seam:

```ts
const tasksDO = yield* TasksObject;

const getTaskDO = (id = "default") =>
  HttpApiClient.makeWith(TaskDOApi, {
    baseUrl: "http://localhost",
    httpClient: Cloudflare.toHttpClient(tasksDO.getByName(id)),
  });
```

The checked-in Worker fixture uses this exact shape (`repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/http-api/worker.ts:31-40`) and forwards typed calls from the public API (`worker.ts:42-87`). The official Alchemy guide explains that `baseUrl` is irrelevant and requests short-circuit to `stub.fetch` (`website/src/content/docs/cloudflare/apis/effect-http-api.mdx:555-604`).

`Cloudflare.toHttpClient` is implemented in `Fetcher.ts:184-241`:

1. Convert each immutable `HttpClientRequest` to an `HttpServerRequest`.
2. Call the supplied server-shaped fetcher (the DO stub).
3. Convert `HttpServerResponse` back to `HttpClientResponse`.
4. Convert failures into `HttpClientError` transport failures.
5. Rebuild the server request on every retry so a consumed body is not replayed accidentally.

This gives a typed client for a DO-local HTTP API without an external hostname, socket, or public route. `HttpApiClient.makeWith` then supplies schema-derived endpoint methods; its API contract remains reusable by external callers if desired.

## 7. Cloudflare runtime constraints that affect the design

- **No direct DO ingress:** a DO needs a Worker/DO binding caller; expose public HTTP on the Worker and delegate to the DO. ([Cloudflare getting started](https://developers.cloudflare.com/durable-objects/get-started/).)
- **No filesystem in the Worker/DO isolate:** the Alchemy Effect HTTP guide therefore supplies an `HttpPlatformStub` for file responses instead of `HttpPlatform.layer` (`effect-http-api.mdx:223-265`). Avoid Node/Bun server adapters and filesystem-backed static responses in the DO.
- **One host per DO class:** other Workers can bind by `scriptName`, but only the host ships the implementation and migrations. Alchemy's cross-worker contract and `.from` behavior are documented in `DurableObject.ts:471-536, 909-976`.
- **Placement is sticky:** choose deterministic names and, where appropriate, a first-request `locationHint`; do not expect a hint to relocate existing data (`durable-objects.mdx:396-443`; [Cloudflare data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)).
- **Persistence is not instance memory:** hibernation/eviction/restart can reconstruct the object. `Room.ts` demonstrates rehydrating WebSocket sessions from attachments in the inner Effect (`examples/cloudflare-worker/src/Room.ts:14-25`).
- **Effect scope lifecycle:** Alchemy creates an isolate-shared layer build, then a fresh Effect scope for each RPC/fetch/alarm/WebSocket event and closes it through `state.waitUntil` (`DurableObjectBridge.ts:38-79, 120-163`; `durable-objects.mdx:444-460`). There is no useful isolate-teardown hook; attach cleanup to call scopes, not init.
- **Request bodies and streams are live resources:** Effect's Web conversions preserve supported request bodies and stream responses (`HttpClientRequest.ts:903-1002`; `HttpServerResponse.ts:965-1030`). Consume a body once, and use the adapter's retry behavior rather than manually replaying a consumed request.
- **Concurrency still matters:** single-threaded DO execution does not make arbitrary external I/O atomic. Keep storage transactions/critical sections deliberate and avoid putting slow external calls inside `blockConcurrencyWhile` ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).
- **Deploy propagation:** Alchemy's `Fetcher` contains a retry-oriented guard for a short post-deploy window where a DO/service fetch can encounter “Handler does not export a fetch() function” (`repos/alchemy/packages/alchemy/src/Cloudflare/Fetcher.ts:165-182`). Treat this as an operational eventual-consistency window, not as evidence that the DO route is absent.

## 8. Resource boundaries and recommended composition roots

### Boundary map

1. **Stack root (`alchemy.run.ts`):** declare providers/state, create Worker/DO resources, and expose outputs such as the Worker URL. The HTTP fixture's stack is the minimal example (`repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/http-api/stack.ts:1-23`).
2. **Worker init root:** yield resource-backed bindings (`yield* TasksObject`, R2/KV/etc.), build pure API/router layers, and return `{ fetch }`. This runs during Alchemy plan discovery and at runtime boot, so it must not execute request-dependent work (`effect-http-api.mdx:114-137, 170-265`).
3. **DO init/instance root:** resolve `DurableObjectState` and shared services in the outer Effect; build the inner runtime implementation and HTTP handler there. The DO class declaration is also what causes Alchemy to export/migrate the class (`DurableObject.ts:335-409, 1218-1254`).
4. **Request scope:** access `HttpServerRequest`, route/validate, call storage/domain services, and return an `HttpServerResponse`. Call-specific finalizers and background work belong here.
5. **Client boundary:** use `Cloudflare.toHttpClient(stub)` for in-isolate DO HTTP, or `FetchHttpClient.layer` for ordinary Web Fetch HTTP. Keep this adaptation in the Worker composition root.

### Existing patterns worth copying

- **Best HTTP composition pattern:** `repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/http-api/object.ts` and `worker.ts`—same schema API style, a DO-local `HttpApi`, `HttpPlatformStub`, `HttpRouter.toHttpEffect`, and `HttpApiClient.makeWith` over `Cloudflare.toHttpClient`.
- **Best raw forwarding/WebSocket pattern:** `repos/alchemy/examples/cloudflare-worker/src/Room.ts` + `src/Api.ts:218-235`—the Worker owns public routing and forwards the original request to a named DO.
- **Best async/Effect comparison:** `repos/alchemy/examples/cloudflare-dev/src/AsyncWorker.ts:20-57, 71-113`, `src/EffectWorker.ts:55-132`, and `alchemy.run.ts:20-38`.
- **Best resource internals reference:** `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts`, `DurableObjectBridge.ts`, `WorkerProvider.ts`, and `LocalWorkerProvider.ts`; these are more authoritative for current behavior than older examples.

## 9. Verified facts versus recommendations and open limitations

### Verified facts

- Alchemy v2 has inline, modular, and descriptor-only DO declaration forms.
- `className`, `scriptName`, and `transferredFrom` are the relevant current declaration options; new local classes reconcile as SQLite by default.
- `yield* DOClass` registers the binding/export and returns a typed namespace handle in an Effect-native Worker.
- The DO `fetch` shape is an Effect HTTP handler, bridged to/from Web `Request`/`Response` by Alchemy.
- `Cloudflare.toHttpClient(stub)` is a first-party local adapter for typed Effect HTTP clients over DO fetch.
- `HttpServer.serve` is a concrete-server API; a Cloudflare DO should return an `HttpEffect` instead.
- DO storage, placement, hibernation, migrations, and single-threading impose the lifecycle and consistency constraints described above.

### Recommendations

- Prefer typed schemaless RPC for internal method-like calls; prefer HTTP fetch/`HttpApi` for request-shaped contracts and WebSockets.
- Keep schemas/API descriptions pure and outside the Worker/DO init roots; construct handlers and provide runtime Layers inside the roots.
- Use `getByName` with a domain identity that matches the unit of coordination; shard rather than creating a global bottleneck.
- Put external HTTP transport (`FetchHttpClient.layer`) and DO transport (`Cloudflare.toHttpClient`) at composition roots.
- Treat the DO's `DurableObjectState` as an injected boundary service, not as a dependency that leaks through the domain.

### Important limitations / unresolved design choices

- The Alchemy resource interface advertises Cloudflare namespace helpers beyond `getByName`, but the concrete binding implementation in this checkout only materializes `getByName`; verify the desired helper before depending on it.
- `locationHint` is first-creation-only and ignored by local dev; it cannot repair an already-created misplaced instance.
- Class moves and migration changes cannot be hidden inside a version/gradual rollout; they require full deployment and explicit transfer declarations.
- The Effect HTTP modules under `repos/effect/packages/effect/src/unstable/http` are marked `@since 4.0.0` and are vendored unstable APIs; pinning/version discipline matters.
- This report intentionally does not settle storage schema tooling or Drizzle integration.

## Sources

### Official Alchemy

- [Alchemy Durable Objects](https://alchemy.run/cloudflare/compute/durable-objects/)
- [Alchemy Effect HTTP API, including DO HTTP and `toHttpClient`](https://alchemy.run/cloudflare/apis/effect-http-api/)
- [Alchemy GitHub source](https://github.com/alchemy-run/alchemy), especially `packages/alchemy/src/Cloudflare/Workers/DurableObject.ts`, `DurableObjectBridge.ts`, `WorkerProvider.ts`, and `LocalWorkerProvider.ts`

### Official Cloudflare

- [Durable Objects overview](https://developers.cloudflare.com/durable-objects/)
- [Getting started](https://developers.cloudflare.com/durable-objects/get-started/)
- [Durable Object Namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [Durable Object Stub API](https://developers.cloudflare.com/durable-objects/api/stub/)
- [Invoke methods / `fetch`](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/)
- [Data location and location hints](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Build a counter](https://developers.cloudflare.com/durable-objects/examples/build-a-counter/)

### Official Effect source

- [Effect HTTP source](https://github.com/Effect-TS/effect/tree/main/packages/effect/src/unstable/http)
- Local vendored API sources: `repos/effect/packages/effect/src/unstable/http/HttpServer.ts`, `HttpServerRequest.ts`, `HttpServerResponse.ts`, `HttpClient.ts`, `HttpClientRequest.ts`, `HttpClientResponse.ts`, and `FetchHttpClient.ts`.
