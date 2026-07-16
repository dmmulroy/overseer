# Effect v4 for Overseer's Cloudflare backend

**Research snapshot:** 2026-07-16, canonical `Effect-TS/effect` `main` at [`80ea8cb9222ca73f564c8267ab2f82966fea027a`](https://github.com/Effect-TS/effect/tree/80ea8cb9222ca73f564c8267ab2f82966fea027a), published package version `4.0.0-beta.98` ([package](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/package.json#L1-L6)). The former repository is named `effect-smol`, not `effect-small`; it is archived and points v4 development to the canonical repository ([archive notice](https://github.com/Effect-TS/effect-smol)).

## Answer

**Use Effect v4 for the MVP, but as a pinned, replaceable beta dependency—not as an architectural boundary.** Core `Effect`, `Schema`, `Context`, and `Layer` fit Overseer's typed application services and Cloudflare composition roots. The schema-driven `effect/unstable/httpapi` is useful for REST parsing, encoding, OpenAPI, generated clients, and in-memory contract tests, but it is explicitly unstable and has Cloudflare-specific gaps. `@effect/sql-sqlite-do` is a useful implementation detail for a Durable Object persistence adapter, not an application-facing repository API.

Adoption should have four gates:

1. Pin every Effect package to exactly `4.0.0-beta.98` initially and upgrade deliberately. V4 remains beta, and `http`, `httpapi`, `sql`, and related modules are explicitly allowed to break between minor versions ([status](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/README.md#L7-L17), [unstable-module contract](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/MIGRATION.md#L40-L49)).
2. Keep domain modules and application-owned ports independent of `effect/unstable/*`, HTTP, and Cloudflare types.
3. Prove the Web handler and SQLite Durable Object adapter in Cloudflare's local Workers runtime before product work depends on them.
4. Own one stable JSON error contract and test every framework-generated failure path; Effect's defaults are not sufficiently actionable or uniform.

## Facts versus recommendations

| Area | Upstream fact at the pinned snapshot | Recommendation for Overseer |
| --- | --- | --- |
| HTTP contract | `HttpApi` describes groups/endpoints once for server handlers, clients, URLs, reflection, and OpenAPI ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApi.ts#L1-L18)). Endpoint constructors parse path/query/header fields through string-tree codecs and bodies/success/errors through JSON codecs unless `disableCodecs` is set ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiEndpoint.ts#L964-L1053)). | Use `HttpApi` only in the inbound REST adapter. Parse directly to branded domain/application inputs where the wire and domain shapes agree; add an explicit transport projection only where they differ. |
| Domain types | Schema v4 has refinements/checks, brands, schema-backed classes, and schema-backed yieldable error classes ([brands/refinements](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Schema.ts#L5013-L5130), [errors](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Schema.ts#L12898-L13015)). | Define `WorkspaceId`, `ProjectId`, `IssueId`, project-local issue number, version, and legal state as schema-backed domain values. Keep state transitions pure; use `Schema.TaggedErrorClass` for expected domain/application failures. |
| Services and layers | V4 replaces tags with `Context.Service`; a key is itself yieldable, while `Layer` constructs/provides implementations ([service API](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Context.ts#L37-L100), [constructors](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Context.ts#L151-L252)). V4 no longer auto-creates layers or wires a `dependencies` list; layers are explicit ([migration](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/migration/services.md#L103-L158)). | Define narrow application-owned service keys beside the use case. Construct concrete binding adapters only in each Worker/Durable Object entrypoint. Do not pass `Env`, `DurableObjectState`, binding names, or a shared dependency bag inward. |
| Request context | `HttpApiMiddleware.Service` can declare services it provides/requires and typed errors ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts#L64-L100), [constructor](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts#L272-L376)). The lower-level router documentation demonstrates middleware providing a `CurrentSession` service only around a request ([example](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/http/HttpRouter.ts#L855-L919)). | Authentication middleware should parse credentials and provide required `Actor` and `RequestMetadata` services. Never make `Actor` a `Context.Reference`: references have defaults and carry no requirement type, so missing authentication can compile silently ([type](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Context.ts#L303-L334)). |
| Durable Object SQL | `@effect/sql-sqlite-do` accepts either `SqlStorage` or full `DurableObjectStorage`, exposes both its specific client and generic `SqlClient`, serializes access, and needs full storage for `withTransaction` ([configuration](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/sql/sqlite-do/src/SqliteClient.ts#L65-L104), [implementation](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/sql/sqlite-do/src/SqliteClient.ts#L176-L307), [layer](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/sql/sqlite-do/src/SqliteClient.ts#L311-L341)). | Pass `ctx.storage`, not only `ctx.storage.sql`. Keep `SqlClient`, rows, SQL errors, and migrations inside a Durable Object adapter implementing an application-owned issue-store port. |
| Testing | `@effect/vitest` provides `it.effect`, live/scoped tests, shared test layers, test clock, and property tests ([API](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/vitest/src/index.ts#L46-L144)). `HttpApiTest.groups` runs the generated client through real request encoding, router handling, response encoding, and client decoding without a socket ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiTest.ts#L1-L45)). | Use property tests for domain schemas/transitions, small layers/fakes for application ports, `HttpApiTest` for contracts, and Cloudflare Vitest integration for runtime/binding behavior. Do not substitute an in-memory Effect test for a workerd integration test. |
| Cancellation and resources | The Web bridge interrupts the request fiber when the Web `Request.signal` aborts ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/http/HttpEffect.ts#L231-L266)). Routes are made interruptible by default; handlers can opt the whole route into `uninterruptible` ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/http/HttpRouter.ts#L192-L231), [route option](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L261-L326)). | Leave handlers interruptible. Protect only the smallest atomic commit when necessary; let the DO transaction adapter roll back on failure/interruption. Never use a detached Effect fiber as a substitute for Cloudflare lifecycle ownership. |
| Optimistic concurrency | Effect has no resource-version or conditional-write abstraction. `HttpApi` can parse an `If-Match`-like header, and its error schemas support status 409/412, but response-header schemas are absent from the endpoint model; handlers may escape to a raw `HttpServerResponse` ([handler type](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiEndpoint.ts#L559-L586)). | Put optimistic concurrency in the domain/application port: require a parsed expected version and return a precise `VersionConflict`. Implement it as a conditional SQL update (prefer `UPDATE … WHERE version = ? … RETURNING …`) and project it to actionable JSON. Use a raw response or explicit middleware only if the REST contract requires `ETag`; Effect does not model that response header declaratively today. |

## Concrete HTTP and schema pattern

The current endpoint API supports `get`, `post`, `put`, `patch`, `delete`, `head`, and `options`; each declaration can contain `params`, `query`, `headers`, `payload`, `success`, and one or more `error` schemas ([constructor](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiEndpoint.ts#L964-L1053), [method exports](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiEndpoint.ts#L1299-L1361)). `HttpApiBuilder.group` then requires implementations for the group's endpoints, and `HttpApiBuilder.layer` registers those groups with `HttpRouter` ([builder](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L56-L158)).

For an issue mutation, the contract should therefore declare:

- branded/refined path parameters and expected version header or payload field;
- a schema for the external patch document, parsed into an explicit application input;
- a success representation schema;
- every expected transport error schema (`not_found`, `version_conflict`, `invalid_transition`, and so on);
- authentication/request-metadata middleware at the API or group level.

Do not set `disableCodecs` unless implementing an unusual media type. The default behavior deliberately derives string-tree codecs for path/query/headers and canonical JSON codecs for payloads and responses. Media-specific helpers support JSON, form URL encoding, text, bytes, multipart, and SSE ([encoding model](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiSchema.ts#L1-L65)). The same declaration can generate an OpenAPI 3.1 document ([generator](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/OpenApi.ts#L1-L20)) and a schema-decoding client.

### Cloudflare HTTP boundary

There is no first-party Cloudflare HTTP server package in this snapshot. The relevant integration is runtime-neutral: `HttpRouter.toWebHandler` returns a Fetch-compatible `(Request) => Promise<Response>` plus `dispose` ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/http/HttpRouter.ts#L1273-L1339)). That is enough for both a Worker `fetch` handler and a Durable Object `fetch` method, but Overseer must own the composition glue.

A second portability rough edge is that `HttpApiBuilder.layer` currently requires `Etag.Generator`, `FileSystem`, `HttpPlatform`, and `Path` even for a JSON-only API ([signature](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L64-L86)). Upstream's own HTTP API tests satisfy those requirements with `Path.layer`, `Etag.layerWeak`, `HttpPlatform.layer`, and `FileSystem.layerNoop` ([setup](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/test/unstable/httpapi/HttpApiBuilder.test.ts#L15-L23)). Treat that as a beta workaround to prove in workerd, not evidence of a production Cloudflare filesystem. If it creates unacceptable bundle/runtime cost, the lower-level `HttpRouter` plus explicit Schema parsers avoids the declarative builder's unconditional platform requirements.

The handler also accepts a second `Context` containing request requirements not supplied by the application layer ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/http/HttpEffect.ts#L231-L266)). This is the correct seam for invocation-scoped capabilities: construct narrow adapters from `env`/`ctx`, put those adapter services—not raw Cloudflare objects—into the context, and invoke the cached handler.

**Current blocker:** the layer-based Web bridge lazily memoizes layer construction inside the first request and exposes a manual `dispose` function ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/http/HttpEffect.ts#L285-L343)). Upstream issue [#6319](https://github.com/Effect-TS/effect/issues/6319) reports that an aborted first request can leave that promise permanently pending under workerd and wedge the isolate. It remains open at this snapshot, and the current source still has the reported lazy-promise shape.

Until that issue is fixed and regression-tested:

- do not let an aborted request own first-time layer construction;
- build synchronous binding adapters directly into a context where possible;
- for a Durable Object, initialize its Effect graph/migrations under `ctx.blockConcurrencyWhile` and store the ready handler on the object instance;
- for a stateless Worker, explicitly prime/build the static graph outside a request I/O context or keep per-request composition lightweight;
- add a cold-start-abort integration test.

Cloudflare documents `blockConcurrencyWhile` as the constructor-time mechanism for migrations/initialization and warns that a thrown callback resets the object ([Cloudflare](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile)). A composition-root callback must therefore classify/report expected startup failures rather than leak a rejection accidentally.

## Errors: domain values versus REST values

### Domain and application errors

Use small, precise `Schema.TaggedErrorClass` unions in domain/application code, for example `IssueNotFound | VersionConflict | InvalidIssueTransition | IssueStoreUnavailable`. These errors carry domain identifiers, safe context, and a cause only where useful. They do **not** carry HTTP status annotations.

At the HTTP adapter, map those values exhaustively to transport error classes. A transport error should include stable machine-readable and actionable fields, for example:

```json
{
  "code": "version_conflict",
  "message": "The issue changed after it was read.",
  "resource": { "projectId": "…", "issueNumber": 14 },
  "expectedVersion": 7,
  "currentVersion": 9,
  "requestId": "…"
}
```

Define that projection with `Schema.ErrorClass` and a literal `code`, then annotate the class with `httpApiStatus: 409` (or 412 if the final REST contract adopts strict `If-Match` semantics). Effect's own tests demonstrate `Schema.TaggedErrorClass(..., { httpApiStatus })` round-tripping through a declared endpoint error ([test](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/test/unstable/httpapi/HttpApiBuilder.test.ts#L477-L526)). The builder chooses status/content type from schema annotations, encodes only declared error schemas, and turns undeclared or unencodable failures into defects ([pipeline](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L755-L817), [response encoding](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L1042-L1134)). This makes exhaustive declaration and adapter mapping mandatory.

Do not expect ordinary JavaScript `Error.message`, `stack`, or `cause` to become useful JSON automatically. Schema encoding emits the fields declared by the schema. Put the safe public message and recovery data in those fields; keep sensitive/internal causes out of the transport schema.

### Framework-generated errors and present gaps

The defaults are not an actionable REST contract:

- A request schema failure becomes `HttpApiSchemaError`, containing the failed component and structured `SchemaError`, but its built-in server response is an **empty 400** ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiError.ts#L430-L475)).
- `HttpApiMiddleware.layerSchemaErrorTransform` can convert that failure into a declared custom middleware error ([source and example](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts#L383-L448)). Use it to emit field paths and safe remediation messages.
- Schema v4 can flatten its issue tree into Standard Schema V1 `{ message, path }` entries, but the default messages may include actual input values ([formatter](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/SchemaIssue.ts#L969-L1053)). Use a custom safe leaf formatter; never echo credentials or bodies.
- Unsupported payload content type is currently returned directly as plain text 415 by the builder, not as a declared schema error ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts#L670-L719)). Route-not-found and other outer HTTP failures also live outside endpoint error declarations.
- The endpoint model does not declare success/error response headers. Upstream previously tracked that limitation in [#4229](https://github.com/Effect-TS/effect/issues/4229), and the current endpoint type still has only body/status/content-type success and error schemas.

Therefore add black-box assertions for malformed JSON, each request component, unsupported content type, missing route/method, unauthorized/forbidden, every domain error, defects, and aborted requests. If one JSON envelope is non-negotiable, add an outer adapter middleware for the remaining framework responses and explicitly patch/document OpenAPI where the unstable API cannot express the result. Do not decode and rewrite already serialized bodies by string inspection.

## Request-scoped actor and session metadata

Use two required services:

- `Actor`: a parsed human or agent principal with the minimum authorization identity needed by application services;
- `RequestMetadata`: request/correlation ID and optional, parsed harness-generic session fields.

An `HttpApiMiddleware.Service` should declare that it **provides** these services and can fail with declared authentication/metadata transport errors. Its implementation receives redacted Bearer/API-key credentials—the security model exposes token credentials as `Redacted` ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiSecurity.ts#L39-L76), [constructors](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiSecurity.ts#L100-L180))—and wraps the endpoint effect with `Effect.provideService` for the parsed values.

Application services yield `Actor`/`RequestMetadata`; they never read headers or `HttpServerRequest`. Adapters may add safe actor/session IDs to spans and logs, but never raw credentials. Make metadata optional *inside* the always-present `RequestMetadata` value rather than making the service itself optional.

One maturity warning: current `HttpApiSecurity` JSDoc still refers to a nonexistent `HttpApiBuilder.middlewareSecurity` helper ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/unstable/httpapi/HttpApiSecurity.ts#L100-L169)); the actual current pattern is `HttpApiMiddleware.Service` plus a layer. This is direct evidence that examples around unstable APIs can lag the beta surface; compile a small spike against the pinned version rather than copying v3 or older v4 examples.

## Durable Object adapter and optimistic concurrency

The v4 beta adapter is materially better than the old v3 behavior reported in upstream issues [#5987](https://github.com/Effect-TS/effect/issues/5987) and [#6006](https://github.com/Effect-TS/effect/issues/6006): current source uses `DurableObjectStorage.transaction`, rolls back when the Effect exits unsuccessfully, and waits for transaction completion on interruption ([implementation](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/sql/sqlite-do/src/SqliteClient.ts#L116-L168)). Upstream unit tests cover success, typed failure rollback, interruption rollback, nested-transaction rejection, and migration—but with hand-written fake storage, not workerd ([tests](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/sql/sqlite-do/test/Client.test.ts#L195-L319)). Treat real-runtime compatibility as unproven until Overseer's integration test passes.

Cloudflare's own storage contract says SQLite-backed DO storage is private, strongly consistent, and transactional per object; SQL cursors must be fully consumed before an `await`, and transaction SQL such as `BEGIN` is forbidden in favor of storage transaction APIs ([Cloudflare](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)). The Effect adapter does synchronously consume cursors into arrays and uses the storage transaction API, matching those constraints.

The package does **not** adapt Durable Object namespaces/stubs, routing/partitioning, alarms, `blockConcurrencyWhile`, hibernating WebSockets, or Worker `ExecutionContext`. Those remain Overseer-owned adapters/composition roots.

For optimistic concurrency:

1. Persist a monotonically increasing domain `Version` with each mutable aggregate.
2. Require `expectedVersion` on every externally observable mutation that can race.
3. Execute a conditional update inside the object's storage boundary; `UPDATE … WHERE id = ? AND version = ? … RETURNING version` avoids depending on cursor row-count metadata that the Effect SQL adapter does not expose.
4. If no row is returned, read the current safe representation/version and return typed `VersionConflict`—do not retry automatically.
5. Map it to the JSON conflict response above so an agent can re-read, reconcile, and retry deliberately.

Durable Object serialization reduces concurrent execution inside one active object, but does not remove stale clients, replay, retries, or an incorrect partition boundary. Optimistic concurrency remains an application invariant.

## Lifecycle and interruption rules

- Use `Effect.acquireRelease`, `Effect.acquireUseRelease`, `Scope`, and finalizers for real resources; the APIs guarantee release on success, failure, or interruption ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Effect.ts#L6432-L6704)).
- Do not set a whole mutation handler's `uninterruptible: true` merely to protect writes. That delays cancellation across parsing, authorization, remote calls, and rendering. Keep the storage operation atomic/idempotent instead.
- Use `Effect.onInterrupt` for observability/compensation and `Effect.abortSignal` when adapting cancellable Web APIs ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Effect.ts#L7244-L7446)).
- `Effect.forkChild` follows the parent, `forkScoped` follows a scope, and `forkDetach` follows Effect's global scope ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Effect.ts#L8546-L8722)). None tells Cloudflare to extend a Worker invocation.
- For post-response work, inject an application-owned background-task port whose Worker adapter passes the resulting promise to `ctx.waitUntil`; Cloudflare says that is what extends Worker execution, with a 30-second post-response limit ([Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil)). Use Queues/workflows for durable work. A Durable Object remains alive for pending I/O and its `waitUntil` has no lifecycle effect ([Cloudflare](https://developers.cloudflare.com/durable-objects/api/state/#waituntil)).
- `toWebHandlerLayerWith` owns one long-lived scope and only closes it through its returned `dispose`. Cloudflare has no dependable isolate-shutdown callback, so do not put correctness-critical shutdown behavior in that finalizer. Use `dispose` in tests/local servers; make Worker/DO resources eviction-safe.

## Test plan required before adoption

1. **Domain:** schema round trips and properties for branded IDs, version ordering, legal transitions, graph-cycle rejection, and normalization. Schema v4 can derive `fast-check` arbitraries ([source](https://github.com/Effect-TS/effect/blob/80ea8cb9222ca73f564c8267ab2f82966fea027a/packages/effect/src/Schema.ts#L13018-L13086)).
2. **Application services:** recording/in-memory implementations of narrow ports supplied with `Layer.succeed`; assert returned values/errors and resulting state, not calls/spies.
3. **HTTP contract:** `HttpApiTest.groups` for request/response/error round trips and middleware-provided actor metadata; generated client decoding must see the same error values the server emitted.
4. **Fetch boundary:** invoke the real Fetch-compatible handler with Web `Request`, including cancellation and streamed bodies.
5. **Cloudflare runtime:** run with Cloudflare's Vitest pool, which executes tests inside the Workers runtime with bindings and isolated storage ([Cloudflare](https://developers.cloudflare.com/workers/testing/vitest-integration/)). Cover migrations, transaction success/failure/interruption, blob conversion, stale-version races, cold-start abort/recovery for #6319, DO eviction/reconstruction, and external response bytes/headers.
6. **Architecture check:** search inner modules for `Env`, `ExecutionContext`, `DurableObjectState`, `DurableObjectNamespace`, `SqlStorage`, `HttpServerRequest`, and binding names. Every match must be an entrypoint or adapter.

## Proposed dependency direction

```text
Worker fetch / Durable Object constructor or method       (composition root)
  -> Fetch/HttpApi inbound adapter + auth middleware      (unstable API contained here)
     -> application service (`Context.Service`)
        -> pure issue/workspace/project domain modules
        -> application-owned persistence/event ports
           -> Durable Object adapter
              -> @effect/sql-sqlite-do / Cloudflare bindings
```

This shape takes advantage of Effect's typed error channel, schema parsing, service graph, cancellation, and test layers while preserving the option to replace the beta HTTP or SQL integrations without rewriting Overseer's domain and use cases.

## Decision checklist

- **Go:** core Effect v4, Schema v4, explicit `Context.Service`/`Layer`, typed expected errors, request-scoped required services, and `@effect/vitest`.
- **Conditional go:** `effect/unstable/httpapi` and `@effect/sql-sqlite-do`, only pinned and behind adapters after Cloudflare integration tests pass.
- **Do not rely on:** implicit JSON errors, declarative response headers, automatic optimistic concurrency, detached fibers for Worker lifetime, lazy first-request layer initialization, or raw Cloudflare/SQL types in application services.
