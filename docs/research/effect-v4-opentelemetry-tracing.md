# Effect v4 OpenTelemetry Tracing Research

This document grounds the E2E trace-recording design in the APIs and runtime semantics actually present in this repository. It is research, not a design decision. Open questions and decisions remain in [`../../e2e-trace-recording-planning.md`](../../e2e-trace-recording-planning.md).

## Version and source boundary

The application pins `effect@4.0.0-beta.107`. The vendored Effect and `@effect/opentelemetry` sources are also `4.0.0-beta.107`.

Two export paths exist in that version:

1. **Effect-native tracing plus lightweight OTLP/HTTP export**
   - Core APIs come from the `Effect`, `Tracer`, `Layer`, `Logger`, `Stream`, `Channel`, and `RequestResolver` namespaces exported by `effect`.
   - HTTP propagation and automatic HTTP spans come from `effect/unstable/http`.
   - Direct OTLP export comes from `effect/unstable/observability`.
   - This route does not require the OpenTelemetry JavaScript SDK.
2. **OpenTelemetry JavaScript SDK bridge**
   - `@effect/opentelemetry` adapts Effect spans to official OpenTelemetry providers, processors, exporters, context, and span types.
   - Its exact-version source is vendored, but Overseer does **not** currently depend on `@effect/opentelemetry` or its OpenTelemetry peer packages.

Effect's current repository guidance recommends lightweight `effect/unstable/observability` OTLP modules for new applications and `@effect/opentelemetry` when integrating with an existing OpenTelemetry setup. The public Effect website tracing guide still emphasizes `@effect/opentelemetry`; it is useful background, but pinned source is authoritative where it differs or omits newer v4 APIs.

## The core tracing model

### Tracer backend

`Tracer.Tracer` is the low-level backend installed in Effect context. Its required operation is:

```ts
span(options): Tracer.Span
```

The options supplied by the runtime include name, resolved parent, annotations, links, start time, kind, root state, and sampling decision. A custom backend may also implement `context(primitive, fiber)`. When present, the Effect runtime invokes it while evaluating primitives under an active span. The OpenTelemetry SDK bridge uses this hook to make the corresponding OpenTelemetry context active around Effect evaluation.

`Tracer.make` only returns a value satisfying this interface; it adds no lifecycle behavior.

`Tracer.Tracer` is a `Context.Reference` with a default backend. Therefore tracing APIs work without an explicitly provided tracing Layer. The default backend creates `Tracer.NativeSpan` values in memory but has no registry or exporter, so completed default spans become unreachable unless code captures them.

### Span values

`Tracer.AnySpan` is either:

- `Tracer.Span`: a local Effect-managed mutable span; or
- `Tracer.ExternalSpan`: trace identity imported from another tracing system or process.

A local span contains:

- `name`, `traceId`, `spanId`, parent, kind, and sampled state;
- `annotations`, attributes, and links;
- `SpanStatus`, initially `Started` and eventually `Ended` with start time, end time, and the complete Effect `Exit`;
- mutation operations `attribute`, `event`, `addLinks`, and `end`.

`Tracer.NativeSpan` additionally exposes an `events` array. Events are not part of the public `Tracer.Span` interface, so a generic recorder cannot assume every custom span exposes that array.

The native tracer inherits the parent's trace ID or creates a 32-character hexadecimal trace ID, then creates a 16-character hexadecimal span ID. Its data is mutable. Directly serializing a native span is unsafe: its ended status contains the full `Exit`, including the full failure `Cause` and arbitrary error values.

`Tracer.externalSpan` creates an external parent from IDs and optional sampling/annotations. It defaults to sampled and does not validate identifier format. Protocol boundaries must validate IDs themselves; `HttpTraceContext.w3c` does, while the B3 decoders are permissive.

### Span options

The shared `Tracer.SpanOptions` surface supports:

- `attributes: Record<string, unknown>`;
- `links`;
- explicit `parent`;
- `root`;
- low-level `annotations: Context.Context<never>`;
- `kind`: `internal`, `server`, `client`, `producer`, or `consumer`;
- explicit `sampled`;
- trace `level` for dynamic filtering;
- `captureStackTrace`.

An explicit parent wins over `root`; otherwise `root: true` removes the ambient parent. Explicit `sampled` bypasses normal sampling computation. Without it, an unsampled parent makes the child unsampled; otherwise `MinimumTraceLevel` is compared with the span's explicit level or `CurrentTraceLevel`.

`CurrentTraceLevel` defaults to `Info`; `MinimumTraceLevel` defaults to `All`. Timing defaults to enabled. A disabled timing context writes zero for both start and end time.

Stack capture is diagnostic call-site metadata used by Effect's cause/stack machinery. It is enabled by tracing wrappers unless explicitly disabled. It should not be confused with a guaranteed standalone `code.stacktrace` span attribute on every successful span.

### Parent context and fiber behavior

`Tracer.ParentSpan` is the context service used as the parent of newly created spans. The fiber runtime caches it as `fiber.currentSpan`, so ordinary Effect child fibers inherit active trace context through Effect context inheritance.

`Effect.currentSpan` returns only a local `Tracer.Span`; it fails with `NoSuchElementError` when there is no local span or the current parent is external. `Effect.currentParentSpan` returns either a local or external parent and also fails when absent. `Fiber.currentSpan` exposes the current `AnySpan` to low-level runtime integrations.

Providing a different `Tracer.Tracer` around each execution is fiber-context-local and can isolate span creation between concurrent executions, provided work remains under that execution's Effect context. A single exporter Layer shared by several executions intentionally combines their output.

## Top-level Effect tracing APIs

### Creating and managing spans

| API                       | Lifetime                              | Installed as parent for nested work? | Important semantics                                                                                                                         |
| ------------------------- | ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Effect.withSpan`         | Ends on every effect exit             | Yes                                  | Primary structured tracing wrapper; records success, typed failure, defect, timeout interruption, or other interruption through the `Exit`. |
| Named `Effect.fn("name")` | Ends on every function effect exit    | Yes                                  | Internally creates a span for every invocation. Unnamed `Effect.fn(...)` adds stack-frame metadata but no span.                             |
| `Effect.fnUntraced`       | No span                               | No                                   | Appropriate where a reusable Effect function should not create an operation span.                                                           |
| `Effect.useSpan`          | Ends when callback effect exits       | No, not automatically                | Gives the standalone span to the callback; the callback must explicitly install it if nested work should be parented.                       |
| `Effect.makeSpan`         | Caller-managed                        | No                                   | Creates a span but neither installs nor ends it. Easy to leak.                                                                              |
| `Effect.makeSpanScoped`   | Ends when the supplied `Scope` closes | No                                   | Standalone scoped span. Scope exit becomes the span exit.                                                                                   |
| `Effect.withSpanScoped`   | Ends when the supplied `Scope` closes | Yes                                  | Installs a scoped child span around the wrapped effect. Its span can outlive that effect until scope finalization.                          |
| `Effect.withParentSpan`   | Does not own supplied span            | Yes                                  | Continues work beneath a local or external span.                                                                                            |

`Effect.withSpan` and named `Effect.fn` are the natural execution wrappers because they both install parent context and finalize on all Effect exits. `makeSpan` is not a safe lifecycle primitive by itself.

### Access, annotation, and links

- `Effect.tracer` reads the active backend; `Effect.withTracer` provides a backend to an effect.
- `Effect.annotateCurrentSpan` mutates only the current local span and silently does nothing when no local span exists.
- `Effect.annotateSpans` adds inherited attributes to every span created inside its scope.
- `Effect.spanAnnotations` reads those inherited values.
- `Effect.linkSpans` adds links inherited by spans created inside its scope; `Effect.spanLinks` reads them.
- Direct `span.event(...)`, `span.attribute(...)`, and `span.addLinks(...)` are available after obtaining a local span.

Inherited annotations are copied into each span at creation, followed by explicit span attributes. Explicit attributes therefore overwrite inherited attributes with the same key in the built-in implementations.

### Enabling, propagation, timing, and sampling

- `Effect.withTracerEnabled(false)` supplies `References.TracerEnabled = false`. Span creation returns a non-recording no-op span with IDs `noop`, zero timing, and sampled false.
- `Effect.withTracerTiming(false)` keeps spans but writes zero times.
- `Tracer.DisablePropagation` is a separate context reference/annotation. It creates non-propagating no-op spans and causes descendants to skip disabled spans when resolving a parent.
- `Tracer.CurrentTraceLevel` and `Tracer.MinimumTraceLevel` control default sampling. Unsampled spans can still exist in custom/native tracers, but `OtlpTracer` does not export them.

Disabling tracer registration and disabling HTTP propagation are not identical. Notably, the pinned `HttpClient` checks `Tracer.DisablePropagation` and its own disable predicate before instrumentation, but does not check `TracerEnabled` before constructing and propagating its no-op client span. Code that needs no outgoing context should use the HTTP propagation control or the propagation-disable context explicitly rather than assuming `withTracerEnabled(false)` suppresses headers.

### Other traced structures

- `Layer.span` provides a new parent span for Layer construction and ends it when the Layer scope closes.
- `Layer.parentSpan` provides an existing span without owning it.
- `Layer.withSpan` wraps Layer construction in a scope-owned span.
- `Layer.withParentSpan` attaches Layer construction to an existing span.
- Layer span options add an `onEnd(span, exit)` finalizer hook.
- `Channel.withSpan` spans the complete channel acquisition/use/release lifetime and ends with the channel exit.
- `Stream.withSpan` delegates to `Channel.withSpan`, so it spans stream consumption rather than stream declaration.
- `RequestResolver.withSpan` creates one span per resolver batch, adds `batchSize`, and links the distinct request parent spans instead of choosing one request as the batch's parent.

## Logs and failures

`Logger.tracerLogger` converts Effect logs under a local span into span events. It is in the default logger set, so this happens without explicitly installing it unless the application replaces the default loggers.

A log event contains:

- the string-rendered log message as event name;
- log annotations;
- `effect.fiberId`;
- `effect.logLevel`;
- a pretty-rendered `effect.cause` when the log carries a Cause.

This is a major retention and redaction boundary: any sensitive value written to an ordinary Effect log inside an execution span can enter the trace artifact.

Both the lightweight OTLP tracer and `@effect/opentelemetry` translate ended spans as follows:

- successful exit → OpenTelemetry status OK;
- interruption-only failure → status OK, an interrupted message/label, and `status.interrupted = true`;
- other failure → status ERROR, first pretty error as status message, and one `exception` event per pretty error containing type, message, and stack trace.

Nested JavaScript `Error.cause` details are included in rendered stacks. Typed failures, defects, and arbitrary cause values can therefore become diagnostic strings. A trace retention policy cannot rely only on attribute filtering; it must also govern logs and rendered failures.

## HTTP tracing and distributed propagation

### Outgoing `HttpClient`

The low-level `HttpClient.make` wrapper automatically creates a `client` span named `http.client <METHOD>` unless disabled by `HttpClient.TracerDisabledWhen` or `Tracer.DisablePropagation`. `HttpClient.SpanNameGenerator` can change the name.

The client span records:

- method;
- server origin and optional port;
- full URL, path, scheme, and raw query;
- request headers;
- response status;
- response headers.

`HttpClient.TracerHeaderFilter(name, phase)` filters header attributes and defaults to allowing every request and response header. `Headers.CurrentRedactedNames` redacts only `authorization`, `cookie`, `set-cookie`, and `x-api-key` by default. Redaction replaces values; filtering prevents attributes from being added.

If `HttpClient.TracerPropagationEnabled` is true, the client injects both:

- W3C `traceparent`; and
- compact B3 `b3`.

The propagation headers are added after request-header attributes are captured. The request work itself runs with the client span installed as parent.

HTTP status is an attribute, not the source of span status. A successfully returned HTTP 500 remains a successful client span unless the low-level request effect itself fails; response filtering commonly occurs outside that low-level span.

### Incoming HTTP server

`HttpEffect.toHandled`, used by Effect HTTP server adapters, always applies `HttpMiddleware.tracer`. The server middleware:

1. parses an external parent from incoming headers;
2. creates a `server` span named `http.server <METHOD>` by default;
3. installs it as `Tracer.ParentSpan` while the app runs;
4. records request/response attributes; and
5. ends it with the app's effective exit.

`HttpMiddleware.SpanNameGenerator` customizes the name. `HttpMiddleware.TracerDisabledWhen` and `layerTracerDisabledForUrls` disable selected requests. `HttpRouter` adds the matched `http.route` to the current local server span.

Inbound context parsing tries W3C first, then compact B3, then multi-header B3. Only W3C version `00` is accepted. `tracestate` and baggage are neither parsed nor emitted by the Effect-native HTTP propagation module.

The server records full URL, raw query, user agent, all request headers, remote address, response status, and all response headers. It applies `Headers.CurrentRedactedNames`, but there is no server equivalent of `HttpClient.TracerHeaderFilter` in the pinned API. URL username/password are replaced with `REDACTED`; query parameters are not sanitized.

As on the client, an HTTP 500 returned successfully is not automatically an ERROR span. Unsampled server spans skip HTTP attribute collection and are not emitted by the lightweight OTLP exporter.

### Security consequence for Overseer

Overseer's Cloudflare Access client secret header is not one of Effect's default redacted names. A default-instrumented E2E `HttpClient` can therefore retain it as a plain span attribute. The raw query string and all other non-default headers are also retained by default.

Before any real E2E trace capture, the harness must apply an explicit client header allowlist or equivalent filter and must decide whether URL/query attributes are acceptable. Merely relying on Effect's default redaction is insufficient.

## Lightweight OTLP/HTTP path

### `OtlpTracer`

`effect/unstable/observability/OtlpTracer.make` creates an Effect `Tracer.Tracer` that:

- creates OTLP-oriented span implementations;
- queues only ended, sampled spans;
- batches spans by resource and instrumentation scope;
- serializes them through `OtlpSerialization`; and
- exports through Effect `HttpClient`.

`OtlpTracer.layer` installs that tracer and a shared `OtlpExporter.Flusher`. It requires:

- `HttpClient.HttpClient`;
- `OtlpSerialization`; and
- a scope while being built.

JSON and protobuf serializers are available as `OtlpSerialization.layerJson` and `layerProtobuf`. `Otlp.layerJson` / `layerProtobuf` combine logs, metrics, and traces against one base URL. `OtlpTracer` exports a normal OTLP trace payload containing resource, scope, IDs, parent IDs, timing, kind, attributes, events, status, and links.

`OtlpTracer` is an OTLP sender, not a pluggable in-memory exporter API. Its conversion from Effect spans to OTLP spans is private. The public `TraceData` grouping types exist primarily for serialization.

### Configuration

`OtlpTracer.layerFromConfig` recognizes:

- `OTEL_SDK_DISABLED`;
- `OTEL_TRACES_EXPORTER`, which must include `otlp`;
- signal-specific or shared OTLP endpoint and headers;
- signal-specific/shared exporter timeout;
- `OTEL_BSP_EXPORT_TIMEOUT`;
- `OTEL_BSP_SCHEDULE_DELAY`;
- `OTEL_BSP_MAX_EXPORT_BATCH_SIZE`;
- resource service name/version/attributes.

A shared endpoint receives `/v1/traces`; a signal-specific endpoint is used as supplied. Signal-specific headers win over shared headers. Header configuration values are URI-decoded. If no explicit or configured service name is available, resource construction defects.

### Flush and shutdown

The shared `OtlpExporter`:

- buffers completed telemetry;
- exports on interval or batch size;
- retries transient failures up to three times;
- honors `Retry-After` for HTTP 429;
- disables itself for 60 seconds after an unhandled export failure and drops its buffer;
- disables tracing and trace propagation for its own export request;
- flushes remaining telemetry when its scope closes;
- bounds final shutdown waiting with `shutdownTimeout`, defaulting to three seconds for traces.

`OtlpExporter.Flusher.flush` manually initiates all registered signal exports concurrently. It cannot fail and has no built-in timeout. It does not wait for an export already started by the timer or a full batch, and it skips exporters in the 60-second disabled window. Callers needing a hard guarantee must account for those semantics rather than treating `flush` as durable acknowledgement.

These best-effort network semantics are appropriate for observability export but do not satisfy evidence persistence's stronger local durability requirements by themselves.

## `@effect/opentelemetry` SDK bridge

The exact `4.0.0-beta.107` package is available as vendored reference but is not installed in Overseer.

### `OtelTracer`

`OtelTracer.make` adapts an official `Otel.Tracer` into `Tracer.Tracer`. Its span implementation:

- creates official OpenTelemetry spans;
- maps Effect kinds, attributes, events, links, timing, sampling, and exits;
- preserves external trace flags and trace state when they are supplied through its own external-span helper;
- makes OpenTelemetry context active through `Tracer.context` while Effect primitives run.

Top-level capabilities include:

- `OtelTracer`, `OtelTracerProvider`, `OtelTraceFlags`, and `OtelTraceState` services;
- `make`;
- `makeExternalSpan`;
- `currentOtelSpan`, including a wrapper around lightweight/native Effect spans;
- `withSpanContext` for continuing from an official OpenTelemetry `SpanContext`;
- Layers using the global provider, an explicitly supplied provider, or an explicitly supplied tracer.

Unlike Effect-native `HttpTraceContext`, this bridge can preserve OpenTelemetry trace state and interoperate with third-party OpenTelemetry instrumentation and processors.

### Node and Web SDK Layers

`NodeSdk.layer` and `WebSdk.layer` build resources and conditionally install tracing only when a non-empty span processor configuration is supplied. They can also install metrics and logging.

`NodeSdk.layerTracerProvider` creates a scoped `NodeTracerProvider`. On Layer release it calls `forceFlush`, then `shutdown`, ignores provider failures, and bounds the operation with the configured timeout or three seconds. `WebSdk` force-flushes and shuts down without the Node timeout option in the pinned source.

The official SDK path supports `SimpleSpanProcessor`, `BatchSpanProcessor`, and `InMemorySpanExporter`. Therefore an execution-scoped Node SDK Layer plus an execution-owned `InMemorySpanExporter` is a standards-native way to isolate and retrieve finished spans. It requires adding `@effect/opentelemetry` and compatible OpenTelemetry SDK peer dependencies.

Third-party Node auto-instrumentations have separate initialization-order and global context/provider requirements. `NodeSdk.layer`'s own provider is passed explicitly to Effect's tracer; it does not by itself prove that arbitrary auto-instrumentation is registered against that provider.

## Recording strategies enabled by the APIs

The API research leaves three technically distinct routes:

1. **Custom execution-scoped `Tracer.Tracer`**
   - No new dependency.
   - Can create/capture `NativeSpan`-like values directly.
   - Must define a recorder-owned event-capable span implementation or knowingly depend on `NativeSpan.events`.
   - Must perform its own safe conversion from mutable spans and `Exit` values into a versioned trace document.
2. **Execution-scoped official OpenTelemetry SDK exporter**
   - Add `@effect/opentelemetry` plus compatible OpenTelemetry packages.
   - Use an execution-owned `InMemorySpanExporter` and processor.
   - Gains official readable-span/exporter representation and easier interoperability.
   - Must still convert/sanitize SDK span data before evidence persistence and carefully own provider/context lifecycle.
3. **Lightweight `OtlpTracer` to a collector**
   - No official OpenTelemetry SDK dependency.
   - Best suited to sending telemetry to an OTLP endpoint.
   - Does not directly expose an in-memory recorder or durable local artifact.
   - Best-effort flushing and exporter disable/drop behavior make it insufficient as the sole evidence store.

No source evidence supports treating the default native tracer or direct OTLP exporter as an already-built durable execution trace recorder.

## Implications to carry into design discussion

These are constraints discovered from the APIs, not approved design choices:

- An execution root should use a structured wrapper such as `Effect.withSpan`; a bare `makeSpan` does not guarantee finalization.
- A per-execution tracer context is a viable isolation boundary for harness-local spans.
- Lightweight OTLP export and local evidence recording solve different durability problems.
- A finalized evidence document must copy and sanitize span data; it must not serialize mutable spans or raw Effect exits.
- Attribute safety requires an allowlist. Effect's HTTP defaults collect substantially more than Overseer permits.
- Log events and rendered failures are additional sensitive-data channels.
- The Cloudflare Access secret header requires explicit protection before real E2E client tracing.
- W3C parent propagation through Effect HTTP is built in, but trace state and baggage are not.
- Distributed Worker/Durable Object capture still needs a runtime/export destination in every process; propagating IDs alone does not retain remote spans.
- An execution can naturally contain several trace IDs if code starts explicit roots or receives unrelated external parents. “One execution equals one trace” would need enforcement, not assumption.
- HTTP status and span status are independent in the pinned implementation.

## Sources inspected

Pinned/vendored `4.0.0-beta.107` source and tests:

- `node_modules/.pnpm/effect@4.0.0-beta.107/node_modules/effect/src/Tracer.ts`
- `.../src/Effect.ts` and `.../src/internal/effect.ts`
- `.../src/References.ts`, `Layer.ts`, `Logger.ts`, `Channel.ts`, `Stream.ts`, `RequestResolver.ts`
- `.../src/unstable/http/HttpClient.ts`, `HttpEffect.ts`, `HttpMiddleware.ts`, `HttpRouter.ts`, `HttpTraceContext.ts`, `Headers.ts`
- `.../src/unstable/observability/Otlp.ts`, `OtlpTracer.ts`, `OtlpExporter.ts`, `OtlpSerialization.ts`, `OtlpResource.ts`, and `internal/otlpEnv.ts`
- `repos/effect/packages/effect/test/Tracer.test.ts`
- `repos/effect/packages/effect/test/unstable/http/HttpClient.test.ts` and `HttpMiddleware.test.ts`
- `repos/effect/packages/effect/test/unstable/observability/OtlpExporter.test.ts` and `OtlpConfig.test.ts`
- `repos/effect/packages/opentelemetry/src/OtelTracer.ts`, `NodeSdk.ts`, `WebSdk.ts`, and `Resource.ts`
- `repos/effect/packages/opentelemetry/test/OtelTracer.test.ts`
- `repos/effect/ai-docs/src/08_observability/20_otlp-tracing.ts`
- Effect public website, “Tracing in Effect”
