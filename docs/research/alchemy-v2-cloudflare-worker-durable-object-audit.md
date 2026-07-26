# Alchemy v2 Cloudflare Worker and Durable Object audit

Date: 2026-07-20  
Updated after the operation-specific Effect/Alchemy refactor.

## Scope

This audit compares Overseer's current implementation with:

- the installed and pinned `alchemy@2.0.0-beta.64` package;
- Alchemy's Worker, Durable Object, RPC, bridge, examples, tests, and first-party documentation under [`repos/alchemy`](../../repos/alchemy/);
- the build-once Worker initialization and per-event scope model introduced in Alchemy beta.62.

The current architecture is also recorded in [ADR 0001](../adr/0001-mvp-system-architecture.md) and the [`src/infra` README](../../src/infra/README.md).

## Current conclusion

Overseer's Alchemy composition now follows the intended runtime model:

- [`Gateway`](../../src/infra/gateway-resource.ts) and [`WorkspaceRegistryObject`](../../src/infra/workspace-registry-resource.ts) keep lightweight resource identities separate from implementations.
- [`src/infra/gateway.ts`](../../src/infra/gateway.ts) builds configuration, Access verification, the HTTP router, the Workspace Registry RPC adapter, Web Crypto, and the application once during Worker initialization. The returned `fetch` Effect performs request work.
- [`src/infra/workspace-registry.ts`](../../src/infra/workspace-registry.ts) uses Alchemy's nested Durable Object constructor shape, acquires `Cloudflare.DurableObjectState` at the outer boundary, and builds object-local SQLite services in the inner Effect.
- The implementation relies on Alchemy's bridge-owned `blockConcurrencyWhile`; it does not add a nested concurrency guard.
- [`workspace-registry-rpc-client.ts`](../../src/adapters/gateway/workspace-registry-rpc-client.ts) yields the hosted namespace and directly provides the application-owned `WorkspaceRegistryService`.
- The Durable Object exposes four operation-specific schemaless RPC methods rather than a generic read/command envelope.
- Expected failures retain operation-specific tags. Local persistence causes are logged inside the object and replaced with cause-free remote failures.

## Runtime and lifetime audit

### Worker

Alchemy Effect Workers have two phases: an initialization Effect and returned event handlers. Overseer builds reusable, isolate-safe values during initialization:

- the remote JWK set cache;
- parsed runtime configuration;
- the declared HTTP router;
- immutable service implementations and Durable Object namespace adapters.

Request values, request scope, authentication results, request IDs, and response bodies remain per request. In particular, `GatewayApi.make` builds `HttpRouter.toHttpEffect(...)` once rather than rebuilding the router for each request.

### Durable Object

The Workspace Registry constructor:

1. yields `Cloudflare.DurableObjectState`;
2. creates one SQLite client for the activation from `state.raw.storage`;
3. acquires the migration Layer and the application service before exposing methods;
4. returns the four RPC methods.

Layer acquisition completes before the local service is returned, so migrations finish before any exposed registry method can execute. Object reconstruction creates a fresh client and reruns forward-only migrations.

Retaining this SQLite client for the Durable Object activation is appropriate: it wraps object-local synchronous storage and a semaphore, not a network pool, socket, response body, or request-owned promise.

## RPC audit

Alchemy's schemaless RPC is the correct fit for the current private same-deployment boundary. The inputs and successful values are structured-clone-safe application/domain records. Runtime Schema parsing remains at persistence, HTTP, and test-controlled untrusted boundaries; the code does not add a second Effect RPC transport.

Alchemy beta.64 still omits `RpcCallError` from the inferred error channel of schemaless stub methods even though native call defects produce it at runtime. The narrow widening in `withRpcCallError` is therefore retained with a safety comment. The adapter then logs safe method context and maps the transport failure to `WorkspaceRegistryRpcCallFailed`.

## Production-seam evidence

[`tests/workerd/alchemy-runtime.test.ts`](../../tests/workerd/alchemy-runtime.test.ts) bundles and runs the production Alchemy Gateway and Workspace Registry bridges in workerd. It verifies:

- concurrent first calls initialize one object activation safely;
- operation-specific RPC and SQLite persistence;
- remote defects remain distinct from expected tagged failures;
- corrupt stored data crosses as a cause-free expected failure;
- reconstruction reads committed state;
- failed migration initialization can be repaired and retried after reconstruction.

The faster raw Worker and native Durable Object fixtures remain useful for focused HTTP and SQLite coverage, but they are no longer the only runtime evidence.

## Deferred Project object

The Project Durable Object is intentionally not deployed before the first project-local capability needs it. When introduced, it should use the same lightweight resource identity, nested Effect constructor, operation-specific schemaless RPC, and bridge-owned initialization guard. Its native `alarm()` entrypoint should compose object-local services directly rather than route through HTTP or a scheduler abstraction.

## Verification

The current worktree passes the production Alchemy workerd suite with Alchemy `2.0.0-beta.64`, and the full `npm run check` gate passes.
