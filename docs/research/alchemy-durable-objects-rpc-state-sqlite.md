# Alchemy Durable Objects: RPC, state, and SQLite

Date: 2026-07-21

## Scope

This report covers the vendored Alchemy snapshot in [`repos/alchemy`](../../repos/alchemy/) at commit `a821f8df7626f014abe8d334bfbb255403198d27`, package version `2.0.0-beta.63`. It uses only Alchemy source, tests, examples, and first-party docs. The application is pinned to beta.64; runtime-sensitive conclusions have since been checked against the installed package and the production Alchemy workerd fixture.

Primary sources:

- [`DurableObject.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts)
- [`DurableObjectBridge.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectBridge.ts)
- [`Rpc.ts` (Cloudflare adapter)](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Rpc.ts)
- [`Rpc.ts` (shared wire protocol)](../../repos/alchemy/packages/alchemy/src/Rpc.ts)
- [`RpcDurableObject.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/RpcDurableObject.ts)
- [`DurableObjectState.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectState.ts)
- [`DurableObjectStorage.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectStorage.ts)
- [Durable Objects guide](../../repos/alchemy/website/src/content/docs/cloudflare/compute/durable-objects.mdx)
- [Schemaless RPC guide](../../repos/alchemy/website/src/content/docs/apis/schemaless.mdx)
- [Effect RPC guide](../../repos/alchemy/website/src/content/docs/cloudflare/apis/effect-rpc.mdx)

## Brief overview

Alchemy treats a Durable Object as four things joined together:

1. **A typed declaration** carried by a class or descriptor.
2. **A Worker binding** that puts a native Durable Object namespace in the hosting Worker's environment.
3. **An exported runtime implementation** generated as a real Cloudflare `DurableObject` subclass.
4. **Worker-owned infrastructure state**: class creation, rename, deletion, transfer, adoption, and namespace IDs are reconciled by the Worker provider.

The normal internal RPC path is **schemaless RPC over Cloudflare's native JSRPC channel**. The DO's returned method shape is also the caller's TypeScript stub shape. Alchemy adds Effect execution, typed-failure envelopes, stream envelopes, and per-call scopes, but performs no schema validation.

`RpcDurableObject` is a separate, schema-based path. It serves an Effect `RpcGroup` through the DO's `fetch` handler and turns `getByName` into a scoped Effect `RpcClient`. It is useful when schema validation or reconstruction of `Schema.Class` values matters; it is not the default internal DO-to-DO or Worker-to-DO mechanism.

## 1. Declaration, deployment, and runtime lifecycle

### Declaration forms

Alchemy supports these forms in [`DurableObject.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts):

```ts
// Effect-native, inline implementation
class Counter extends Cloudflare.DurableObject<Counter>()("Counter", implementation) {}

// Effect-native, modular declaration + Layer
class Counter extends Cloudflare.DurableObject<Counter, Shape>()("Counter") {}
const CounterLive = Counter.make(implementation);

// Descriptor for a plain async Worker
Cloudflare.DurableObject<NativeShape>("Counter", {
  className: "Counter",
  scriptName: host.workerName,
});
```

The modular form is the important composition form. The class is a small typed identifier; `.make(impl)` supplies the runtime Layer only to the host. Consumers can import the class without bundling the implementation. Cross-script consumers use `Counter.from(HostWorker)` or `Counter.from(scriptName)`. See the [cross-Worker guide](../../repos/alchemy/website/src/content/docs/cloudflare/compute/cross-worker-durable-object.mdx).

### Host contract and binding

A host declares published DOs in the Worker's dependency type:

```ts
class Host extends Cloudflare.Worker<Host, {}, Counter>()("Host") {}
```

Yielding `Counter`, or `Counter.from(Host)`, registers a Worker binding equivalent to:

```ts
{
  type: "durable_object_namespace",
  name: "Counter",
  className: "Counter",
  scriptName?: string,
  transferredFrom?: string[]
}
```

At runtime the namespace is read from `WorkerEnvironment`; at plan time yielding it records the binding and evaluates the outer constructor enough to discover further infrastructure requirements. The binding implementation is in [`DurableObject.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts).

### Worker provider behavior

Durable Objects are not deployed by a separate provider. [`WorkerProvider.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerProvider.ts) reconciles them with the Worker script:

- precreates placeholder exported classes to break Worker/resource cycles;
- emits `new_sqlite_classes` for new classes—beta.63 defaults every new DO to SQLite;
- tracks logical-ID-to-class-name mappings in `alchemy:dos:` Worker tags;
- emits rename and delete migrations;
- supports data-preserving `transferred_classes` through `transferredFrom`;
- adopts existing classes by matching a live binding name on the first adopting deploy;
- returns stable `durableObjectNamespaces: Record<className, namespaceId>` attributes.

The generated Worker entry exports a concrete bridge class for each DO:

```ts
export class Counter extends DurableObjectBridge("Counter") {}
```

See [`WorkerBundle.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerBundle.ts).

### Two-phase implementation and scopes

An implementation has an outer and inner Effect:

```ts
Effect.gen(function* () {
  const state = yield* Cloudflare.DurableObjectState;
  const peers = yield* OtherObject;

  return Effect.gen(function* () {
    // Per-activation setup; state I/O is legal here.
    return {
      call: (input: Input) =>
        Effect.gen(function* () {
          /* ... */
        }),
    };
  });
});
```

The bridge lifecycle is:

1. Build the hosting entrypoint's Layer graph once per isolate and share it with the Worker and all DO classes.
2. For each in-memory DO activation, run the outer and inner constructor under native `state.blockConcurrencyWhile`.
3. For every RPC, `fetch`, alarm, and WebSocket event, create a fresh `Scope`, provide the captured services plus `DurableObjectState`, run the Effect, then close the scope through `state.waitUntil`.
4. If an RPC returns a Stream, transfer scope ownership to the Stream and close it when draining ends.

This is implemented in [`WorkerBridge.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerBridge.ts) and [`DurableObjectBridge.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectBridge.ts). An extra user-level `state.blockConcurrencyWhile` around constructor initialization is normally redundant.

## 2. Schemaless Durable Object RPC

### Public shape

The central types are simplified below:

```ts
interface DurableObject<Shape> {
  kind: "Cloudflare.DurableObject";
  name: string;
  namespaceId: Output<string>;
  getByName(name: string, options?: GetOptions): DurableObjectStub<Shape>;
  // Declared by the interface; see implementation gap below.
  newUniqueId(): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId, options?: GetOptions): DurableObjectStub<Shape>;
  jurisdiction(j: DurableObjectJurisdiction): DurableObject<Shape>;
}

type DurableObjectStub<Shape> = Shape & {
  fetch(request: HttpServerRequest): Effect<HttpServerResponse, HttpServerError>;
};
```

In beta.63, the concrete Effect-native namespace currently implements only `getByName`; `newUniqueId`, `idFromName`, `idFromString`, `get`, and `jurisdiction` are present in the interface but commented out in the implementation. Treat those methods as unavailable until that gap is closed.

A callable RPC member should be a function returning `Effect` or `Stream`. The class carries the inferred shape through Alchemy's `Rpc<Shape>` phantom marker, so callers need no second protocol interface or schema. See [`Platform.MainRpc`](../../repos/alchemy/packages/alchemy/src/Platform.ts) and the [schemaless guide](../../repos/alchemy/website/src/content/docs/apis/schemaless.mdx).

### Worker → Durable Object

The path is:

1. Worker init yields `Counter` or `Counter.from(Host)` and captures the namespace.
2. `namespace.getByName(name)` calls the native namespace and wraps its raw stub with `makeRpcStub`.
3. A Proxy turns `stub.method(...args)` into an Effect that invokes the native JSRPC Promise.
4. The generated DO bridge catches the method name through its own Proxy, runs the returned Effect/Stream with the DO's services and a new call scope, and encodes the exit.
5. The caller decodes a value, typed failure, or Stream.

Here is an abridged version of the real Worker-to-DO round trip in Alchemy's `do-rpc` fixture:

```ts
// object.ts — methods returned by the inner Effect become the RPC shape.
const KV = Cloudflare.KV.Namespace("DurableObjectWorkerEnvironmentKV", {
  title: "durable-object-worker-environment-kv",
});

export class WorkerEnvironmentKVObject extends Cloudflare.DurableObject<WorkerEnvironmentKVObject>()(
  "WorkerEnvironmentKVObject",
  Effect.gen(function* () {
    const kv = yield* Cloudflare.KV.ReadWriteNamespace(KV);

    return Effect.gen(function* () {
      return {
        put: (key: string, value: string) => kv.put(key, value),
        get: (key: string) => kv.get(key),
        tick: (n: number) => Stream.iterate(0, (i) => i + 1).pipe(Stream.take(n)),
      };
    });
  }).pipe(Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding)),
) {}

// worker.ts — capture the namespace during Worker init, then call its stub
// from the request handler.
export default class DurableObjectWorkerEnvironmentWorker extends Cloudflare.Worker<DurableObjectWorkerEnvironmentWorker>()(
  "DurableObjectWorkerEnvironmentWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    const objects = yield* WorkerEnvironmentKVObject;

    return {
      fetch: Effect.gen(function* () {
        const object = objects.getByName("default");

        yield* object.put("greeting", "ok").pipe(Effect.orDie);
        const value = yield* object.get("greeting").pipe(Effect.orDie);

        return yield* HttpServerResponse.json({ value });
      }),
    };
  }),
) {}
```

`objects` is the bound namespace, `object` is the typed native stub, and `put`/`get` cross the JSRPC boundary before the Worker returns `{ value: "ok" }`. The full executable sources are [`object.ts`](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/do-rpc/object.ts) and [`worker.ts`](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/do-rpc/worker.ts).

### Durable Object → Durable Object

Alchemy does not have a second DO-to-DO transport or a dedicated `callDurableObject` API. A DO captures another namespace in its **outer constructor**, then calls its stub from a method:

```ts
Effect.gen(function* () {
  const peers = yield* PeerObject;
  return Effect.gen(function* () {
    return {
      notifyPeer: (id: string, message: string) => peers.getByName(id).notify(message),
    };
  });
});
```

The namespace is still a binding on the hosting Worker script, and the call uses the exact same native stub, `makeRpcStub`, envelopes, and bridge as Worker → DO. The caller being another DO changes Cloudflare's runtime topology, not Alchemy's RPC protocol.

For calls to another script's DO, capture `PeerObject.from(HostWorker)` instead. For sibling instances of the same namespace, Alchemy injects the surrounding namespace as `DurableObjectScope`; the schema-based equivalent, `RpcDurableObjectScope`, is explicitly documented for sibling calls in [`RpcDurableObject.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/RpcDurableObject.ts).

Limitations:

- There is no separate first-party integration fixture dedicated to schemaless DO → DO in this snapshot; the conclusion follows from the shared namespace/stub implementation and the documented ability to resolve other DO dependencies in the outer constructor.
- Alchemy adds no same-object recursion, cycle, deadlock, or reentrancy guard. Those remain Cloudflare runtime concerns.
- Resolve/capture namespace handles during construction, but execute calls in handlers; do not start request I/O in the isolate-level Layer build.

### RPC envelopes and streams

The shared protocol in [`src/Rpc.ts`](../../repos/alchemy/packages/alchemy/src/Rpc.ts) defines:

```ts
const StreamTag = "~alchemy/rpc/stream";
const ErrorTag = "~alchemy/rpc/error";
const StreamErrorTag = "~alchemy/rpc/stream-error";

type RpcStreamEnvelope = {
  _tag: typeof StreamTag;
  encoding: "bytes" | "jsonl";
  body: ReadableStream<Uint8Array>;
};

type RpcErrorEnvelope = {
  _tag: typeof ErrorTag;
  error: unknown;
};
```

`handleRpcExit` returns successes directly into native structured clone, converts typed Effect failures to `RpcErrorEnvelope`, converts Streams to `RpcStreamEnvelope`, and rejects defects. `makeRpcStub` maps rejected native calls to `RpcCallError` and turns error envelopes back into Effect failures.

`asEffectOrStream` brands one deferred call as both an Effect and a Stream because the raw Proxy cannot know synchronously which the remote method returns. Byte Streams remain bytes; other elements are JSONL. A mid-stream failure becomes `RpcRemoteStreamError`; malformed frames become `RpcDecodeError`.

Important type/serialization limits:

- There is no runtime validation.
- Tagged failures preserve `_tag` and enumerable fields but arrive as plain records; `catchTag` works, `instanceof` does not.
- Plain errors preserve `name`, `message`, and `stack` data.
- Arguments/results must survive Cloudflare structured clone; stream values must be JSON-serializable or `Uint8Array`.
- The stub's static method type mirrors `Shape` exactly, so transport-level `RpcCallError` is not added to the declared method error type even though it can occur at runtime.
- Alchemy docs say class identity is stripped by the schemaless bridge. The unary implementation itself does not explicitly call `JSON.stringify`; it delegates the value to native JSRPC. Either way, callers must not rely on prototype or `Schema.Class` identity.

## 3. Schema-based `RpcDurableObject`

`RpcDurableObject` is thin sugar over a normal DO with a `fetch` method:

```ts
interface RpcDurableObject<Self, Rpcs extends Rpc.Any> {
  getByName(
    id: string,
    options?: GetOptions,
  ): Effect<RpcClient<Rpcs, RpcClientError>, never, Rpc.MiddlewareClient<Rpcs>>;
}
```

Its implementation:

1. wraps the user's inner `HttpEffect` as `{ fetch }` for a normal `DurableObject`;
2. uses `bindEffectRpc` to adapt `rawNamespace.getByName(id).fetch` into an Effect `HttpClient`;
3. provides `RpcClient.layerProtocolHttp` with a placeholder URL—the request goes directly to the DO stub's `fetch`, not the public internet;
4. uses `RpcSerialization.layerNdjson` by default;
5. returns `RpcClient.make(group)`.

The server is still supplied by the user:

```ts
RpcServer.toHttpEffect(Group).pipe(
  Effect.provide(Layer.mergeAll(Group.toLayer(handlers), RpcSerialization.layerNdjson)),
);
```

Because both ends share the `RpcGroup` and serialization Layer, payloads, successes, failures, and Streams are schema encoded/decoded, including reconstructing schema classes. Create/yield the client inside the call scope. Worker → DO and DO → DO again use the same `getByName` client; `RpcDurableObjectScope` lets an instance obtain its surrounding namespace for sibling calls. See the implementation fixture under [`fixtures/rpc-do-namespace-do-rpc`](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/rpc-do-namespace-do-rpc/).

Use schemaless RPC for internal calls where both sides deploy together. Use `RpcDurableObject` when validation, an Effect RPC protocol, or schema-class reconstruction earns its extra framing and decode cost.

## 4. Durable Object state abstractions

`DurableObjectState` is an Effect `Context.Service` built from the native state by `fromDurableObjectState`:

```ts
interface DurableObjectState.Service {
  id: DurableObjectId
  storage: DurableObjectStorage
  container?: cf.Container
  raw: cf.DurableObjectState

  waitUntil(effect): Effect<void, never, R | RuntimeContext>
  blockConcurrencyWhile(callback): Effect<T, never, RuntimeContext>

  acceptWebSocket(ws, tags?): Effect<void, never, RuntimeContext>
  getWebSockets(tag?): Effect<WebSocket[], never, RuntimeContext>
  setWebSocketAutoResponse(pair?): Effect<void, never, RuntimeContext>
  getWebSocketAutoResponse(): Effect<Pair | null, never, RuntimeContext>
  getWebSocketAutoResponseTimestamp(ws): Effect<Date | null, never, RuntimeContext>
  setHibernatableWebSocketEventTimeout(ms?): Effect<void, never, RuntimeContext>
  getHibernatableWebSocketEventTimeout(): Effect<number | null, never, RuntimeContext>
  getTags(ws): Effect<string[], never, RuntimeContext>
  abort(reason?): Effect<void, never, RuntimeContext>
}
```

`RuntimeContext` is a type-level color: it prevents storage/runtime operations in plan-only code. `waitUntil` captures the caller's full Effect context, starts the Effect, and registers its Promise without awaiting it. `raw` is the escape hatch for libraries that already understand Cloudflare state, including `state.raw.storage` adapters.

## 5. Key/value storage, transactions, alarms, and bookmarks

`DurableObjectStorage` wraps the native asynchronous storage API:

| Group                  | Methods                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| Read                   | `get(key)`, `get(keys)`, `list(options)`                                         |
| Write                  | `put(key, value)`, `put(entries)`, `delete(key)`, `delete(keys)`, `deleteAll()`  |
| Transaction            | `transaction(txn => Effect<T>)`                                                  |
| Alarm                  | `getAlarm()`, `setAlarm(dateOrMillis)`, `deleteAlarm()`                          |
| Consistency            | `sync()`                                                                         |
| Point-in-time recovery | `getCurrentBookmark()`, `getBookmarkForTime()`, `onNextSessionRestoreBookmark()` |
| SQLite/sync KV         | `sql: SqlStorage`, `kv: cf.SyncKvStorage`                                        |

`DurableObjectTransaction` exposes `get`, `list`, `put`, `delete`, `rollback`, and the three alarm methods. Constructors `fromDurableObjectStorage` and `fromDurableObjectTransaction` adapt native Promises into Effects.

All public wrapper signatures advertise `never` in the typed error channel; there is no Alchemy storage error algebra. This hides a runtime distinction: Promise-backed methods use bare `Effect.tryPromise`, whose vendored Effect implementation turns rejection into `Cause.UnknownError`, while SQL cursor and synchronous state methods use `Effect.sync`, whose thrown exceptions become defects ([Effect declaration](../../repos/effect/packages/effect/src/Effect.ts#L900-L950), [implementation](../../repos/effect/packages/effect/src/internal/effect.ts#L1041-L1068)). Generic `get<T>` and SQL row types are compile-time assertions, not runtime decoding. Parse persisted data and map storage failures at the application boundary.

The wrapper does not expose native `transactionSync`. It exposes native synchronous KV as raw `storage.kv`; other missing/native operations remain reachable through `state.raw.storage`.

## 6. SQLite abstractions

Every new DO class is deployed as a SQLite class. `state.storage.sql` is Alchemy's small Effect wrapper:

```ts
interface SqlStorage {
  raw: cf.SqlStorage;
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: any[]
  ): Effect<SqlCursor<T>, never, RuntimeContext>;
  databaseSize: number;
}

interface SqlCursor<T> extends Stream<T> {
  next(): Effect<IteratorResult<T>, never, RuntimeContext>;
  toArray(): Effect<T[], never, RuntimeContext>;
  one(): Effect<T, never, RuntimeContext>;
  raw<U extends SqlStorageValue[]>(): Stream<U, never, RuntimeContext>;
  columnNames: string[];
  rowsRead: Effect<number, never, RuntimeContext>;
  rowsWritten: Effect<number, never, RuntimeContext>;
}
```

`exec` executes eagerly enough to obtain the native cursor. The cursor is also an Effect Stream, so rows can be processed without first materializing an array. `raw` on `SqlStorage` supports third-party integrations. Alchemy does not add migrations, schema validation, query building, or a transaction abstraction around SQL in this module.

### SQLite-backed scheduled events

[`ScheduledEvents.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/ScheduledEvents.ts) is the main higher-level abstraction built on DO SQLite:

```ts
interface ScheduledEvent {
  id: string
  runAt: Date
  repeatMs?: number
  payload: unknown
}

scheduleEvent(id, runAt, payload, repeatMs?): Effect<void, never,
  DurableObjectState | RuntimeContext>
cancelEvent(id): Effect<void, never, DurableObjectState | RuntimeContext>
listEvents: Effect<ScheduledEvent[], never, DurableObjectState | RuntimeContext>
processScheduledEvents: Effect<ScheduledEvent[], never,
  DurableObjectState | RuntimeContext>
```

It lazily creates an `alchemy_scheduled_events` table, upserts named events, keeps the one native DO alarm pointed at the earliest event, reschedules repeating events, and returns due events from `processScheduledEvents`. Payloads are stored with plain `JSON.stringify`/`JSON.parse` and are not schema validated.

### Persistence Layer

Alchemy also exports a [`DurableObjectChatPersistence`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectChatPersistence.ts) Layer implementing Effect's `BackingPersistence` over `state.storage`. It namespaces keys by `storeId`, supports get/set/batch/remove/clear, maps failures to `PersistenceError`, and ignores TTL because native DO storage has no TTL. The Cloudflare AI module adds `layerChatDurableObject` on top of the same idea.

## API inventory

### Durable Object core

- `DurableObject`, `DurableObjectClass`, `DurableObjectLike`, `DurableObjectShape`, `DurableObjectStub`
- `DurableObjectScope`, `DurableObjectServices`, `DurableObjectExport`
- `DurableObjectProps`, `DurableObjectTransferSource`, `normalizeTransferredFrom`
- `DurableObjectId`, `DurableObjectJurisdiction`, `DurableObjectLocationHint`, `DurableObjectGetDurableObjectOptions`, `AlarmInvocationInfo`
- `isDurableObjectLike`, `isDurableObjectExport`, `makeDurableObjectBridge`

### Schemaless RPC

- `Rpc<Shape>`, `Rpc.Shape<W>`, `makeRpcStub`
- `RpcErrorEnvelope`, `RpcStreamEnvelope`, `RpcStreamErrorMarker`, `StreamEncoding`
- `RpcCallError`, `RpcDecodeError`, `RpcRemoteStreamError`
- `encodeRpcError`, `decodeRpcResult`, `decodeRpcValue`
- `toRpcStream`, `fromRpcStreamEnvelope`, `decodeRpcByteStream`, `asEffectOrStream`
- generic fetch-transport helpers: `makeFetchRpcStub`, `serveRpc`, `RPC_PATH_PREFIX`, `RPC_STREAM_HEADER`

### Effect RPC DO

- `RpcDurableObject`, `RpcDurableObjectClass`, `RpcDurableObjectScope`
- `bindEffectRpc`
- Effect primitives supplied by the caller: `Rpc`, `RpcGroup`, `RpcServer.toHttpEffect`, `RpcClient`, `RpcSerialization`

### State and storage

- `DurableObjectState`, `fromDurableObjectState`
- `DurableObjectStorage`, `DurableObjectTransaction`
- `fromDurableObjectStorage`, `fromDurableObjectTransaction`
- `SqlStorageValue`, `SqlStorage`, `SqlCursor`
- scheduled-event APIs and `DurableObjectChatPersistence`

## Bottom line

Alchemy's deepest abstraction is not a repository or actor service. It is a typed Worker-bound namespace plus a runtime bridge. Worker → DO and DO → DO calls are the same operation after the caller has captured the proper namespace. The bridge makes native JSRPC feel like Effect by running methods in the DO context, preserving typed failures structurally, adapting Streams, and managing scopes. State and SQLite wrappers are intentionally thin: they color native operations with `RuntimeContext`, convert Promises/cursors to Effects/Streams, and retain raw escape hatches. Schema validation, persisted-data decoding, migrations, and domain error modeling remain application responsibilities.
