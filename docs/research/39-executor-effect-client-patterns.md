# Executor patterns relevant to Overseer’s client pipeline

**Primary source:** [`UsefulSoftwareCo/executor`](https://github.com/UsefulSoftwareCo/executor) at [`44f29bc`](https://github.com/UsefulSoftwareCo/executor/tree/44f29bc1b990fdbfe2153d7d80ba881948b01b27) (read 2026-07-18).

## Corrections to the first prototype attempt

1. **Keep the application execution model in Effect.** Executor constructs one `AtomHttpApi.Service` directly from the shared `HttpApi` declaration and `FetchHttpClient.layer`; it does not first `runPromise` a generated client and then wrap Promise-returning methods in a second cache abstraction ([client composition](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/react/src/api/client.tsx#L118-L124)).
2. **Define query and mutation atoms declaratively.** Executor’s feature atom module exports `Client.query(...)`, `Client.mutation(...)`, derived atoms, and Effect-native command atoms. React observes those atoms; no imperative Promise-based cache coordinator sits between the generated client and Atom ([query atoms](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/react/src/api/atoms.tsx#L29-L151), [mutation atoms](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/react/src/api/atoms.tsx#L153-L252)).
3. **Use Atom’s native optimistic machinery.** Executor composes `Atom.optimistic` with `Atom.optimisticFn`; reducers remain pure and the Atom runtime owns stacked transitions, rollback, and post-success refresh. Hand-rolled pending Maps/generations duplicate weaker versions of this machinery ([policy implementation](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/react/src/api/atoms.tsx#L379-L459)).
4. **Use reactivity keys for mutation convergence.** Mutation callers supply the affected keys and `AtomHttpApi` invalidates matching query atoms after success, rather than an imperative coordinator manually walking cache entries ([reactivity-key convention](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/react/src/api/atoms.tsx#L153-L158)).
5. **Let route modules own URL structure, not server-state storage.** Executor configures TanStack Router with `defaultPreloadStaleTime: 0`, but ordinary route files choose components and validate params/search while React’s atom subscriptions initiate and retain resource reads ([router configuration](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/app/src/router.tsx#L1-L10), [representative route](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/react/src/routes/resume.%24executionId.tsx#L141-L158)). This avoids a Promise-shaped `ensure` interface merely to satisfy loaders.
6. **Promise adaptation is an outermost React escape hatch, not the architecture.** Executor sometimes asks `useAtomSet` for `promiseExit` so an event handler can branch after a command, while the command, transport, errors, and cache remain Effect/Atom values ([React mutation use](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/react/src/pages/api-keys.tsx#L53-L88)). Overseer should prefer rendering command `AsyncResult` directly and use this adapter only where a browser callback genuinely requires sequential local UI work.
7. **Registry lifetime belongs at React composition.** Executor places `RegistryProvider` around the application and keys it only when the server connection identity changes ([provider](https://github.com/UsefulSoftwareCo/executor/blob/44f29bc1b990fdbfe2153d7d80ba881948b01b27/packages/react/src/api/provider.tsx#L10-L25)).

## Overseer-specific adaptation

Executor’s direct query atoms do not by themselves satisfy Overseer’s stronger, already-locked requirement to explicitly own ETags and `validated_at`; Overseer therefore still needs a small application query combinator around the generated Effect client. That combinator should remain Effect-native and atom-local:

- retain the prior successful representation and ETag in the query atom value;
- issue `If-None-Match` from that value;
- convert `200` and `304` into a newly validated value;
- use `Atom.swr` for the five-second grace and wake-up behavior;
- scope polling to the mounted route atom;
- use reactivity keys and native optimistic atoms for post-mutation convergence;
- persist drafts through a separate IndexedDB adapter, never canonical query atoms (the throwaway specimen uses `localStorage` only as a cheap stand-in).

This is one deep query module expressed in Effect/Atom—not a Promise-returning cache service, request-generation Map, or second state runtime.
