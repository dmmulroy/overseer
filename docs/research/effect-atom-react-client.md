# Effect Atom for Overseer's React client

**Issue:** [#29, “Assess Effect Atom for Overseer's React client”](https://github.com/dmmulroy/overseer/issues/29)<br>
**Research cutoff:** 2026-07-17 13:11 UTC<br>
**Fixed client boundary:** React + TanStack Router + Kumo; Foldkit is rejected.

## Decision

**Adopt Effect Atom, narrowly.** Use it as Overseer's in-memory reactive runtime and React subscription/lifecycle adapter. Do **not** make it the synchronization architecture.

Effect Atom should own:

- storage and dependency tracking for application-defined in-memory atoms;
- derived selectors and fine-grained React subscriptions;
- `AsyncResult` presentation state for reads and commands;
- scoped execution/cancellation of Effect programs;
- batched publication of state transitions.

An application-owned client synchronization module must remain the sole policy owner for:

- generated `HttpApiClient` adaptation;
- normalization and query membership;
- canonical snapshots versus memory-only optimistic overlays;
- version-conflict classification, rollback/rebase, and authoritative repair;
- WebSocket ordering, replay, polling fallback, and resnapshot decisions;
- IndexedDB schema, transactions, migrations/rebuild, identity scoping, eviction, and read-through behavior;
- request deduplication, freshness, prefetch scheduling, and offline restrictions.

This boundary uses Atom as a mechanism under Overseer's sync module, not as a second endpoint-response cache or a source of product policy.

**No blocking technical compatibility spike is needed before #30.** The current first-party v4 package has an exact matching Effect release, its React peer range intersects Kumo and TanStack Router, and the recommended boundary deliberately avoids the uncertain convenience APIs as policy owners. If #30 instead proposes making `AtomHttpApi.query`, `Atom.optimistic`, or `Atom.kvs` the canonical synchronization/cache layer, that materially different design should be spiked first.

## Context carried forward

The recommendation preserves the current map decisions:

- [#10](https://github.com/dmmulroy/overseer/issues/10) fixes React, TanStack Router, and Kumo; requires the Effect-generated REST client, an application-owned IndexedDB read-through boundary, and Project WebSockets.
- [#14](https://github.com/dmmulroy/overseer/issues/14) established Kumo/TanStack Router and an application-owned synchronization seam.
- [#26](https://github.com/dmmulroy/overseer/issues/26) rejected Fate because normalized storage did not remove conflict, reconnect, active-query, or repair policy.
- [#17](https://github.com/dmmulroy/overseer/issues/17) and [#27](https://github.com/dmmulroy/overseer/issues/27) are historical Foldkit decisions. Their beta.97 alignment was a Foldkit peer constraint and no longer determines the React client.
- [#28](https://github.com/dmmulroy/overseer/issues/28) already validated the application-owned IndexedDB cache, durable cursor transaction, and prefetch policy in Chromium.
- [#22](https://github.com/dmmulroy/overseer/issues/22) fixes REST as mutation authority and a Project-wide, ordered, at-least-once change stream whose durable cursor advances only with the corresponding IndexedDB commit.
- [#30](https://github.com/dmmulroy/overseer/issues/30) should turn this boundary into the revised build-ready React architecture.

## Version compatibility and maturity

### Which “Effect Atom”

There are two similarly named package lines:

1. **Use:** first-party `@effect/atom-react`, with core modules exported from `effect/unstable/reactivity`.
2. **Do not use:** legacy `@effect-atom/atom-react`; its versioned metadata declares an Effect `^3.19` peer, so it is not the v4 package ([npm metadata for `@effect-atom/atom-react@0.5.0`](https://registry.npmjs.org/%40effect-atom%2Fatom-react/0.5.0)).

At the cutoff, npm reports Effect's `beta` tag as `4.0.0-beta.98` ([live dist-tags](https://registry.npmjs.org/-/package/effect/dist-tags)) and `@effect/atom-react`'s `latest` as `4.0.0-beta.98` ([live dist-tags](https://registry.npmjs.org/-/package/@effect%2Fatom-react/dist-tags)). The versioned Atom package metadata requires `effect ^4.0.0-beta.98`, React `^19.2.4`, and `scheduler` ([versioned npm metadata](https://registry.npmjs.org/%40effect%2Fatom-react/4.0.0-beta.98)); the matching source package manifest says the same ([source permalink](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/package.json#L1-L3), [peers](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/package.json#L59-L76)).

**Recommended pin:** pin `effect`, `@effect/atom-react`, and every other Effect package in the workspace to exactly `4.0.0-beta.98`, with lockfile overrides preventing beta drift. Also pin one React 19 release satisfying `^19.2.4` and one `scheduler` release. This replaces the Foldkit-driven beta.97 choice; it does not weaken the existing “one exact Effect runtime” rule.

The rest of the fixed stack is compatible at the peer-metadata level:

- Kumo 2.8.0 accepts React/React DOM `^18 || ^19` ([Kumo source manifest](https://github.com/cloudflare/kumo/blob/ff8ad54101b21181e2344a5a2232aa2fce741deb/packages/kumo/package.json#L456-L479)).
- TanStack React Router 1.170.18 accepts React/React DOM 18 or 19 ([Router source manifest](https://github.com/TanStack/router/blob/0b178a79e2e872df0107bd7f0faa891c4c9815ef/packages/react-router/package.json#L111-L114)).

Thus React 19.2.4 or newer within major 19 satisfies all three. Neither Kumo nor Router has an Effect peer.

### Maturity assessment

Effect Atom is **official and substantial, but not stable**:

- v4 Atom is released only as part of the Effect 4 beta line; beta.98 is marked a prerelease ([Effect beta.98 release](https://github.com/Effect-TS/effect-smol/releases/tag/effect%404.0.0-beta.98)).
- Its core import path is explicitly `effect/unstable/reactivity`, and the package's own examples import from that path ([React source example](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/ScopedAtom.ts#L93-L105)).
- The v4 React package first appeared with the v4 beta and has tracked the fast-moving Effect beta release train ([package changelog](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/CHANGELOG.md#L697-L705)). A fix to `Atom.kvs` async writes landed immediately after beta.97 and shipped in beta.98 ([fix commit](https://github.com/Effect-TS/effect/commit/97fdaa9c1f522c65e579365d314a07878e2b904f)). This is concrete evidence that patch-level behavior is still moving.
- The implementation is not a sketch: the registry has explicit get/set/mount/refresh/subscribe/reset/dispose operations ([registry interface](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AtomRegistry.ts#L52-L83)); React uses `useSyncExternalStore` over that registry ([hooks implementation](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/Hooks.ts#L27-L58)); and first-party tests cover layer injection, React updates, scoped registries, Suspense, and hydration ([React tests](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/test/index.test.tsx#L24-L105), [hydration tests](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/test/index.test.tsx#L254-L365)).
- Documentation is API/JSDoc-oriented rather than a mature end-to-end server-state guide. That is consistent with the package description—“React bindings for the Effect Atom modules”—and with the primitive API surface ([package README](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/README.md)).

**Maturity verdict:** acceptable as a pinned, replaceable reactive primitive behind an application seam; not mature enough to delegate Overseer's synchronization semantics to it. Every Effect upgrade must rerun strict source typechecking and browser/workerd integration gates.

## Capability assessment

### React and Kumo

The React package supplies:

- registry-backed subscriptions through `useSyncExternalStore`;
- value, setter, refresh, mount, subscription, and Suspense hooks;
- a registry context/provider;
- scoped atom providers;
- hydration helpers.

The hook implementation directly maps registry subscription/snapshot functions into `useSyncExternalStore` ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/Hooks.ts#L27-L58)). `useAtomMount` releases a mount through React effect cleanup ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/Hooks.ts#L125-L127), [public hook](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/Hooks.ts#L164-L188)). `useAtomSuspense` can either return typed failures or throw a squashed cause to an error boundary ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/Hooks.ts#L336-L373)).

Kumo is a React component library, not a data/runtime layer: its first-party README describes accessible components built on Base UI and shows ordinary React component imports ([Kumo README](https://github.com/cloudflare/kumo/blob/ff8ad54101b21181e2344a5a2232aa2fce741deb/README.md)). Composition is therefore direct: route/page components read selectors with Atom hooks, render Kumo components, and invoke application commands from Kumo event callbacks. Kumo owns semantics, focus, keyboard behavior, visual state, and component composition; it owns no cache, transport, or synchronization state.

### Asynchronous state

`AsyncResult<A, E>` is `Initial | Success | Failure`, with a separate `waiting` flag ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AsyncResult.ts#L45-L54)). A failure can retain the previous successful value ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AsyncResult.ts#L229-L300)). This is a good primitive for Overseer's loading/stale/revalidating/disconnected presentation, but it does not define freshness, normalization, conflict, or reconnect policy.

Effect-backed atoms create a scope, install it in the Effect context, close it on atom finalization, and cancel interruptible work when the lifetime ends ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L519-L572)). This is sufficient to host read effects and a decoded WebSocket stream, provided application code explicitly owns when the atom is mounted.

### Generated HttpApi access

`AtomHttpApi.Service` is a real first-party bridge. It constructs a generated `HttpApiClient`, exposes an Atom runtime, and offers endpoint query/mutation helpers ([interface](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AtomHttpApi.ts#L32-L148), [construction](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AtomHttpApi.ts#L156-L217)). Query atoms support request-keyed families, optional reactivity keys, TTL, and serialization keys; mutation atoms can invalidate generic reactivity keys after success ([implementation](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AtomHttpApi.ts#L220-L318)). A first-party test proves request encoding, response decoding, and query serialization against a supplied `HttpClient` ([test](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/test/reactivity/AtomHttpApi.test.ts#L1-L87)).

That convenience layer is **endpoint-response oriented**. It does not normalize entities, reconcile list memberships, atomically persist a Project cursor, or understand Overseer conflicts. It also converts schema and low-level HTTP client failures to defects while leaving declared endpoint errors typed ([implementation](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AtomHttpApi.ts#L215-L217)). Overseer needs application-specific classification of authentication, disconnection, malformed responses, and declared `409` conflicts.

**Boundary:** the composition root may use `AtomHttpApi.Service` to construct/provide the generated client and shared Atom runtime, but feature code must not consume its per-endpoint `query`/`mutation` atoms directly. Application query and command atoms call an application-owned transport port backed by the generated client, then normalize and commit outcomes through the sync coordinator. This prevents a parallel endpoint-response cache from becoming a second local server-state model.

### TanStack Router

TanStack Router explicitly supports external data stores as the **coordinator**, requiring only a promise-returning read/write integration ([first-party guide](https://github.com/TanStack/router/blob/0b178a79e2e872df0107bd7f0faa891c4c9815ef/docs/router/guide/external-data-loading.md#L9-L37)). Its own route cache has no persistence model, shared cross-route cache, built-in mutation API, or cache-level optimistic update API ([data-loading guide](https://github.com/TanStack/router/blob/0b178a79e2e872df0107bd7f0faa891c4c9815ef/docs/router/guide/data-loading.md#L31-L52)). Typed router context is intended to inject loader functions, data clients, and mutation services ([router-context guide](https://github.com/TanStack/router/blob/0b178a79e2e872df0107bd7f0faa891c4c9815ef/docs/router/guide/router-context.md#L5-L18)).

**Boundary:** Router owns URL parsing/building, route/search validation, loader dependency keys, navigation, preload intent, pending/error boundaries, and route lifetime. It receives an application `ClientSync`/`ensure` capability through typed router context. Loaders call that capability and return only readiness/identifiers, not canonical entity payloads. Components read Atom selectors.

Set `defaultPreloadStaleTime: 0` so every relevant preload/load reaches the external sync coordinator, which performs its own deduplication and freshness check; this is TanStack's documented configuration for an external cache ([guide](https://github.com/TanStack/router/blob/0b178a79e2e872df0107bd7f0faa891c4c9815ef/docs/router/guide/data-loading.md#L309-L321)). Do not also model route search state with `Atom.searchParam`; TanStack Router must be the only URL owner.

### Normalized server state

Effect Atom provides writable atoms, derived atoms, memoized families, batching, and registry-level direct reads/writes. `Atom.family` returns the same atom object for equal keys and uses weak references where available ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L1334-L1378)); `Atom.batch` delays dependent rebuild/notification until the synchronous batch commits ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L2014-L2025)). It provides no entity adapter or normalized-cache policy.

**Boundary:** application code defines the normalized projection and is its sole writer:

- canonical entities by stable ID;
- query/list memberships as ordered IDs plus completeness/freshness metadata;
- timeline-page metadata and loaded page IDs;
- Project cursor and connection/repair status;
- memory-only optimistic overlays and conflict records.

Expose read-only entity/query selector families and application command atoms to React. Keep normalization, event application, and membership updates as pure application transitions; publish one new projection atom value, or use `Atom.batch` if the implementation splits the projection across atoms. Route/page components retain only route identifiers and ephemeral UI state.

### Optimistic mutation and conflicts

Atom includes generic optimistic primitives. `Atom.optimistic` shows waiting success values, refreshes its source after successful transitions, and restores the latest source value after failures ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L1842-L1943)); `optimisticFn` combines a reducer with an async function atom ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L1945-L2012)). These are useful mechanics, not Overseer's policy.

**Boundary and flow:** application code must:

1. validate whether a mutation is eligible for optimism;
2. create a memory-only overlay tagged with operation identity and base entity revision;
3. render canonical state plus overlays through derived atoms;
4. call the generated REST transport with the expected revision;
5. feed a successful mutation's returned Project change record through the same ordered reconciliation path used by WebSocket/REST catch-up;
6. on a declared `409`, remove or rebase the overlay, retain attempted/current values in a typed conflict record, and run authoritative repair;
7. on network/auth failure, remove or retain a local draft according to application policy—never enqueue an offline mutation.

Do not persist optimistic overlays. Do not let generic `Atom.optimistic` decide whether to refetch, merge, or present a conflict. It may be reused internally only after application tests prove its transition semantics exactly match the above policy; it is not part of the public sync boundary.

### WebSocket reconciliation

An Effect stream atom can own execution and cleanup, but transport and synchronization remain separate:

- `ProjectSocket` adapter: connect/authenticate, negotiate `overseer.project.v1`, decode frames, report lifecycle, close.
- application sync coordinator: enforce contiguous sequence, ignore duplicates, stop on gaps/unknown records, fetch REST catch-up, choose resnapshot, apply canonical records, and commit data plus cursor transactionally.
- Atom: expose connection/repair state, publish the normalized projection, and scope the supervisor Effect while the active Project is mounted.

Use one explicit active-Project resource mount near the Project route root, not incidental page subscriptions. Give the resource atom `idleTTL: 0`/auto-dispose behavior and do not `keepAlive` it. Effect Atom otherwise supports both permanent `keepAlive` and idle-TTL retention ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L212-L225), [keep-alive controls](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L1460-L1486)).

Do not rely on `ScopedAtom.Provider` prop changes to switch Projects: its source explicitly states that changing `value` after mount does not recreate the atom ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/ScopedAtom.ts#L75-L91)). Key/remount the Project scope or select a new family member when `projectId` changes.

### Resource lifetime

Use three explicit lifetimes rather than letting component reads accidentally determine correctness:

- **Application:** one registry and one root-mounted canonical projection live for the browser application. Dispose the registry when the React root is deliberately destroyed; registry disposal resets every node and runs atom lifetime finalizers ([registry disposal](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AtomRegistry.ts#L546-L561)).
- **Active Project:** one keyed/remounted Project supervisor owns socket, polling fallback, and reconnect fibers. Switching `projectId` must finalize the old scope before mounting the new one. Mark this resource auto-disposed with zero idle TTL; never `keepAlive` it.
- **Read/prefetch:** route loaders and intent prefetch acquire an application `ensure` operation with cancellation and deduplication. Component subscriptions may retain result selectors for rendering, but their unmount must not close the Project supervisor or discard the canonical cache. Query-result retention/eviction remains application freshness policy, not Atom's default idle TTL.

The sync coordinator chooses these lifetimes; Atom implements their scopes, cancellation, mounts, and finalizers. This preserves a testable distinction between “no component currently renders this entity” and “the active Project resource may be stopped.”

### IndexedDB read-through cache

Effect Atom's serialization/hydration support is not a persistent normalized cache. `Atom.serializable` attaches a schema codec and stable key ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L2422-L2465)); `Hydration.dehydrate/hydrate` walks registry nodes and preloads encoded values, optionally carrying promises for initially pending results ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Hydration.ts#L49-L101), [hydrate](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Hydration.ts#L110-L158)). Neither API provides IndexedDB migrations, multi-store transactions, quota eviction, deployment/identity scoping, or a durable cursor invariant.

`Atom.kvs` is a schema-backed single-key convenience over `KeyValueStore` ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/Atom.ts#L2095-L2155)). It is the wrong abstraction for Overseer's multi-table normalized cache, and its just-shipped async-write fix reinforces that it should not become a correctness boundary.

Use the already validated application-owned `@effect/platform-browser` IndexedDB port. The first-party query builder supplies schema-encoded/decoded rows and an explicit shared `withTransaction` API ([interface](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/platform-browser/src/IndexedDbQueryBuilder.ts#L99-L138), [transaction implementation](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/platform-browser/src/IndexedDbQueryBuilder.ts#L1977-L1996)); the database layer supports versioned migrations and destructive rebuild ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/platform-browser/src/IndexedDbDatabase.ts#L1-L17), [rebuild contract](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/platform-browser/src/IndexedDbDatabase.ts#L81-L120)).

Read-through flow:

1. restore/migrate drafts separately;
2. decode canonical cache rows and cursor;
3. seed the application projection atom;
4. revalidate through REST according to freshness/route intent;
5. for each contiguous Project record, persist canonical changes and cursor in one IndexedDB transaction;
6. publish the committed projection to Atom only after that transaction succeeds;
7. rebuild only the canonical cache on incompatibility/corruption, preserving drafts.

Atom serialization may still be useful for isolated test fixtures or future SSR hydration, but it must not replace this port.

## Exact ownership matrix

| Concern | Effect Atom owns | Application-owned sync owns | Other owner |
|---|---|---|---|
| React observation | Registry, dependency graph, selector subscription, `AsyncResult` rendering | Defines which read-only selectors are exposed | React renders; Kumo supplies UI primitives |
| Generated REST | Runs provided Effects and can host the client layer | Transport port, error classification, endpoint orchestration, normalization | Shared `HttpApi` declaration defines wire contract |
| Server state | In-memory storage/publication mechanism | Canonical normalized shape, memberships, freshness, dedup, sole-write rules | REST remains authority |
| Optimism/conflicts | May hold overlay and command-status atoms | Eligibility, overlay identity/order, 409 model, rollback/rebase, repair | Kumo renders conflict affordances |
| Realtime | Scopes supervisor Effect and exposes status | Sequence, duplicate/gap rules, replay/poll/resnapshot, event application | Socket adapter only transports/decodes |
| IndexedDB | Nothing correctness-critical | Schema, migration, transactions, cursor, read-through, eviction, identity, drafts | Effect platform-browser is the storage adapter |
| Routing | Nothing; do not mirror search params | `ensure` capability called by loaders | TanStack Router owns URL, loader deps, navigation/preload |
| Resource lifetime | Atom lifetime/finalizers and registry disposal | Explicitly chooses app/Project/query scope; no accidental `keepAlive` | React route/root mount indicates active lifetime |
| Testing | Deterministic registry seam and layer injection | Pure transition suites and adapter contracts | RTL/Kumo browser tests; real HttpApi/IDB/WS integration |

## Composition-root shape

Create one browser-client composition root that constructs:

1. the generated `HttpApiClient` and its error-classifying transport adapter;
2. the IndexedDB cache port;
3. the Project socket adapter;
4. the pure/application `ClientSync` coordinator;
5. one explicit `AtomRegistry` and application atoms backed by `ClientSync`;
6. TanStack Router with a typed context containing only `ClientSync.ensure`/prefetch capabilities;
7. React's `RegistryContext.Provider`, Router provider, and Kumo styles/components.

Prefer supplying an explicitly constructed registry rather than depending on the package's global default context. The default context has a 400 ms idle TTL, while `RegistryProvider` creates one stable registry and delays disposal by 500 ms on unmount ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/RegistryContext.ts#L28-L47), [provider lifecycle](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/src/RegistryContext.ts#L49-L108)). Explicit construction lets the composition root share the same registry with non-hook route loaders/tests and dispose it deliberately.

## Testing boundary

### Pure synchronization tests

Keep normalization, record application, optimistic-overlay reduction, conflict outcomes, and repair decisions as pure transitions. Cover:

- list/detail convergence from the same canonical entity;
- concurrent optimistic overlays and out-of-order REST completion;
- typed `409` with attempted/current values;
- successful REST-record/WebSocket duplicate idempotency;
- gaps, malformed/unknown records, replay, and resnapshot;
- no cursor publication before IndexedDB commit;
- cache rebuild preserving drafts;
- no offline mutation queue.

These tests should not import React or Kumo.

### Atom seam tests

Construct `AtomRegistry.make()` directly, inject test layers/ports, mount the target atom, and assert values/subscriptions/cleanup. The registry constructor accepts initial values and scheduler/TTL controls ([source](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/src/unstable/reactivity/AtomRegistry.ts#L105-L130)), and the first-party React suite demonstrates replacing a runtime layer under `RegistryProvider` ([test](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/atom/react/test/index.test.tsx#L24-L56)). Test:

- selector invalidation without unrelated rerenders;
- `AsyncResult` stale/waiting/failure presentation;
- command result typing;
- Project resource cancellation on project switch/unmount;
- registry disposal finalizers;
- route `ensure` promises against the same registry/coordinator.

### UI and integration tests

- React Testing Library/browser tests render real Kumo components under a real `RegistryContext`, driving user-visible loading, stale, conflict, disconnected, and retry behavior.
- Generated-client tests provide a test `HttpClient`/server at the transport seam, not module mocks; Effect's own `AtomHttpApi` test uses this pattern ([test](https://github.com/Effect-TS/effect/blob/3e4abbcb0d0e9a5e82b6b88c7ef7ab69900105ec/packages/effect/test/reactivity/AtomHttpApi.test.ts#L22-L87)).
- Seeded Chromium/workerd tests exercise the real generated REST client, IndexedDB transaction/rebuild, WebSocket gap/reconnect, Access behavior, and prefetch budgets.
- Rerun package-singleton, strict source typecheck, browser, and workerd gates on every Effect/Atom/React/Kumo/Router upgrade.

## Spike decision before #30

**Decision: no new compatibility spike is required before #30.**

Evidence is sufficient for the recommended narrow adoption:

1. `@effect/atom-react@4.0.0-beta.98` and `effect@4.0.0-beta.98` are matching first-party releases with declared peer compatibility.
2. React 19.2.4+ satisfies Atom, Kumo, and TanStack Router peer ranges.
3. Atom's React adapter, Effect scopes, generated HttpApi bridge, test-layer injection, and hydration are covered by first-party source/tests.
4. TanStack Router's documented external-cache contract only requires a promise/read-write capability; no bespoke Atom/Router adapter is needed.
5. Kumo is ordinary React UI and introduces no state-runtime seam.
6. Overseer's risky policies remain in already required application-owned modules rather than being delegated to Atom's generic helpers.
7. The existing beta.98 Workers proof in [#25](https://github.com/dmmulroy/overseer/issues/25) and IndexedDB/reconnect proof in [#28](https://github.com/dmmulroy/overseer/issues/28) cover the platform-specific seams that package metadata alone cannot establish.

### What would reopen the spike gate

Open a focused spike before architecture lock only if #30 chooses any of these alternatives:

- direct feature use of `AtomHttpApi.query` as the canonical server cache;
- generic `Atom.optimistic`/`optimisticFn` as the conflict owner;
- `Atom.kvs` or Atom hydration as the persistent cache;
- a socket whose correctness depends on Atom idle TTL/`keepAlive` rather than an explicit Project resource scope;
- a second URL state model using Atom alongside TanStack Router;
- a version other than the already aligned beta.98 package set.

Otherwise proceed to #30 with Effect Atom marked **adopted behind an application-owned synchronization boundary, pinned and upgrade-gated**.
