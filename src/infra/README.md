# Infrastructure composition roots

Infrastructure modules declare deployed Alchemy v2 resources and wire Effect services, Layers, adapters, and Cloudflare bindings. They contain construction and lifecycle wiring, not reusable domain policy.

## Main modules

### `gateway-resource.ts` and `gateway.ts`

`gateway-resource.ts` declares the public `Gateway` Worker identity. `gateway.ts` declares Cloudflare Access resources, hosts the Workspace Registry Durable Object, provides the RPC adapter directly as `WorkspaceRegistryService`, provides the Access verifier, and exposes the final HTTP `fetch` Effect.

### `workspace-registry-resource.ts` and `workspace-registry.ts`

`workspace-registry-resource.ts` declares the singleton `WorkspaceRegistryObject` against the eight-method application-owned Workspace and Project registry RPC contract. `workspace-registry.ts`:

1. obtains `Cloudflare.DurableObjectState`;
2. creates one `@effect/sql-sqlite-do` client from `state.raw.storage` for that activation;
3. runs ordered migrations under Alchemy's bridge-owned constructor concurrency guard;
4. builds the SQLite state, Web Crypto, and ULID Layers;
5. yields those dependencies to the object-local application service;
6. exposes operation-specific Workspace and Project list, read, create, and rename methods.

The infrastructure root does not call `blockConcurrencyWhile` itself and does not manage Alchemy bridge scopes. Reconstruction creates a new client and reruns idempotent migrations. Correctness does not depend on an eviction finalizer.

At the RPC boundary, detailed object-local persistence failures are logged with safe operation and cause classifications, then translated to cause-free cloneable tags. Expected failures remain Effect failures. Defects reject native RPC and become Alchemy `RpcCallError` in wrapped callers.

## Future Project object

The Project Durable Object is not deployed until the first project-local capability needs it. When it is added, a caller captures the Project namespace in the Alchemy outer constructor and calls a named stub from an RPC or Worker handler. Worker-to-DO and DO-to-DO calls use the same schemaless bridge; no second transport, `RpcDurableObject`, or pseudo-transaction is introduced.

The future Project `alarm()` is a native Durable Object entrypoint. It will run idempotent Attachment reconciliation from Project SQLite and set the next native alarm directly. Do not add `ScheduledEvents`, a scheduler service, or a job-table abstraction.

## Rules

Use Alchemy resource classes and `.make(...)` Layers as shown in the vendored source. Resolve raw runtime capabilities only here or in owning adapters. Let Effect requirements expose application dependencies, and keep Cloudflare state, namespaces, and stubs out of application and domain interfaces.
