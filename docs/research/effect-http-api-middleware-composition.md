# Effect HTTP API middleware composition

**Research status:** verified against the pinned Effect `4.0.0-beta.102` source and tests in `repos/effect`, the current application middleware, and the local first-party Alchemy Worker lifecycle source. No application code was changed.

## Conclusion

The composition in `apps/api/src/api-worker.ts:48-60` is **semantically correct and lifecycle-appropriate here, but it is not the ordinary minimal Effect composition**.

The ordinary Effect 4 pattern is:

1. declare endpoint/group middleware with `.middleware(MiddlewareService)`;
2. implement that service with `Layer.succeed` or `Layer.effect`; and
3. provide the implementation layer directly to the `HttpApiBuilder.layer(...)` graph with `Layer.provide`.

Effect's own server tests use exactly that arrangement for both ordinary and security middleware (`repos/effect/packages/platform-node/test/HttpApi.test.ts:101-133, 438-471`). A missing implementation fails as a missing service (`HttpApi.test.ts:634-662`).

Overseer's extra materialization step—build `accessAuthenticationMiddlewareLayer`, extract its service, then inject that same value with `Layer.succeed`—is nevertheless justified because the production verifier deliberately owns one in-memory remote-JWKS cache (`apps/api/src/cloudflare-access-verifier.ts:163-195`). Building that implementation in the Worker init effect gives it the intended isolate lifetime; providing the original effectful layer inside the `HttpRouter.toHttpEffect` application graph would move construction into that graph's ambient build scope. In this Alchemy Worker shape, the init closure is built once per isolate while incoming events receive separate scopes (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts:1648-1680`; `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerBridge.ts:60-145, 262-279, 344-366`). Thus the current bridge through `Layer.succeed` preserves one verifier/JWKS cache across requests.

## Why it works

`HttpApiMiddleware.Service` creates a `Context.Service` key whose value is the server middleware implementation; security middleware values are records of scheme handlers (`repos/effect/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts:52-100, 261-346`). `HttpApiBuilder.group` captures its build context (`HttpApiBuilder.ts:121-140`), and route construction looks up each declared middleware by that key and applies the retrieved service (`HttpApiBuilder.ts:836-850`). Therefore the builder does not care whether the service came from its original `Layer.effect` or from `Layer.succeed` containing an already-constructed value.

The security wrapper cache is also keyed by the **service implementation object**, not merely by the service tag (`HttpApiBuilder.ts:854-903`). Effect has a regression test proving separate implementation objects do not contaminate one another (`HttpApi.test.ts:487-559`). Reusing Overseer's one captured implementation is consequently valid and intentionally reuses the corresponding wrapper.

This does **not** cache an authenticated actor across requests. The captured middleware function still evaluates `verifyAccessAssertion(credential)` for each endpoint execution and supplies `CurrentActor` through `Effect.provideServiceEffect` (`apps/api/src/access-authentication-middleware.ts:54-72`). Only the verifier implementation and its JWKS machinery are shared.

## Comparison with the standard patterns

### Direct `Layer.provide`

`Layer.provide` is the canonical dependency-graph operator: it builds the dependency layer first, feeds its output into the target layer, and hides the dependency's outputs (`repos/effect/packages/effect/src/Layer.ts:1277-1296, 1298-1405`). For middleware with no special lifetime requirement, directly providing `accessAuthenticationMiddlewareLayer` to `HttpApiBuilder.layer(ApiHttpApi)` would be clearer and match Effect's tests.

The important difference here is _where the layer graph is built_. `HttpRouter.toHttpEffect` is itself an outer Effect which calls `Layer.build(...)` and returns the request handler (`repos/effect/packages/effect/src/unstable/http/HttpRouter.ts:550-579`). `Layer.build` uses the ambient scope and memo map (`repos/effect/packages/effect/src/Layer.ts:650-683`); layer sharing occurs within a memo map, and finalization follows the owning scope (`Layer.ts:184-229, 381-409, 685-745`). Moving the verifier layer into that graph therefore changes its acquisition/lifetime boundary. The current code constructs it in the longer-lived Worker init boundary and presents a pure value layer to the HTTP graph.

### `HttpApiBuilder.middleware`

There is no server middleware-service constructor named `HttpApiBuilder.middleware` in the pinned Effect 4 `HttpApiBuilder` module. Endpoint middleware is declared with the `HttpApiMiddleware.Service` key and implemented by providing that key's layer. `HttpApiMiddleware` itself exposes specialized helpers such as `layerSchemaErrorTransform` and client-only `layerClient`, both of which return layers (`repos/effect/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts:385-470`).

The similarly named Effect 3 [`HttpApiBuilder.middleware`](https://github.com/Effect-TS/effect/blob/effect%403.14.21/packages/platform/src/HttpApiBuilder.ts#L869-L943) registered **whole-application `HttpMiddleware`**. It was not the implementation mechanism for a declared endpoint/group `HttpApiMiddleware.Service`, so it is not the appropriate comparison or replacement for `AccessAuthenticationMiddleware`.

## Lifecycle caveat

Extracting a service from a layer and rewrapping it in `Layer.succeed` erases the dependency graph from the receiving layer. That is safe only when the captured service remains inside the lifetime of the scope that built it. It would be hazardous for a scoped resource if the value escaped its acquisition scope or if callers expected the new `Layer.succeed` to own its finalizer. Effect explicitly ties effectful/scoped layer construction and release to the layer scope (`repos/effect/packages/effect/src/Layer.ts:940-1033, 685-745`).

That caveat does not currently invalidate this code: the middleware and verifier are built with `Layer.effect`/`Layer.unwrap`, not a scoped acquisition, and the shared state is an in-memory `createRemoteJWKSet` cache (`apps/api/src/access-authentication-middleware.ts:75-96`; `apps/api/src/cloudflare-access-verifier.ts:163-205`). In workerd, Alchemy also documents that init-level disposable resources are inappropriate because there is no isolate-teardown hook (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts:1664-1679`).

## Verdict

- **Correct:** yes; `Layer.succeed` supplies exactly the middleware service object `HttpApiBuilder` resolves.
- **Idiomatic in general:** direct `Layer.provide(middlewareLayer)` is the standard Effect API/test pattern.
- **Appropriate in this Worker:** yes; the explicit extraction is a reasonable composition-root adaptation to obtain one isolate-lived verifier/JWKS cache while keeping request authentication and `CurrentActor` request-scoped.
- **Constraint:** keep this technique limited to non-disposable isolate-owned services, or manage any scoped resource with an explicit scope whose lifetime truly encloses every request using it.
