# Cloudflare Workers tracing as an Effect tracer

**Research date:** 2026-08-03  
**Status:** complete; verified against Cloudflare documentation/API definitions, the installed runtime/types, and the vendored Effect and Alchemy sources. No implementation files or `planning.md` were changed.

## Executive conclusion

**Cloudflare can collect custom spans from Worker and Durable Object code, but its runtime API is not an Effect-compatible exporter or a general span backend.** It is a request-scoped annotation/collection API. Cloudflare owns sampling, storage, and OpenTelemetry export after collection.

A custom Effect `Tracer` service/layer is technically implementable: Effect's `Tracer` contract is deliberately pluggable, and a Cloudflare adapter can allocate a Cloudflare span, copy scalar attributes, and end it from Effect's lifecycle. However, the resulting adapter cannot faithfully represent Effect's span tree today because Cloudflare exposes neither manual parent wiring nor `trace/spanContext()` IDs. It should therefore be treated as best-effort Cloudflare instrumentation, not as the canonical Effect tracer.

For complete Effect span semantics and external export, the strongest current design is to keep Effect's OTLP tracer/exporter at the Alchemy composition root and enable Cloudflare native tracing separately for platform spans. The two streams are not guaranteed to be one linked trace.

## Verified Cloudflare surface

### Runtime APIs and code location

Cloudflare exposes the same custom-span API in two forms:

- `import { tracing } from "cloudflare:workers"`, available from utility/library code;
- `ctx.tracing` on the stateless Worker `ExecutionContext`.

The official context documentation explicitly says the Context API is **not** available on Durable Objects; DOs instead have `DurableObjectState`. The importable `tracing` module is the usable form in DO code. Sources: [Custom spans](https://developers.cloudflare.com/workers/observability/traces/custom-spans/), [Context API](https://developers.cloudflare.com/workers/runtime-apis/context/).

The checked-in type definition agrees:

- `ExecutionContext.tracing`: `node_modules/@cloudflare/workers-types/index.d.ts:477-485`;
- `Tracing.enterSpan`, `Tracing.startActiveSpan`, and `Span`: `node_modules/@cloudflare/workers-types/index.d.ts:4088-4105`;
- `cloudflare:workers` module export: `node_modules/@cloudflare/workers-types/index.d.ts:14884-14890`.

The installed project versions are `effect@4.0.0-beta.102` and `alchemy@2.0.0-beta.67` (`package.json:15-21`; `package-lock.json:14-39`). The installed Workers types are `@cloudflare/workers-types@5.20260801.1`; the vendored Alchemy API dependency is `@distilled.cloud/cloudflare@0.30.3` (`node_modules/@distilled.cloud/cloudflare/package.json:1-8`).

### Span lifecycle, nesting, and attributes

`enterSpan(name, callback)` runs the callback and automatically ends the span when it returns, throws, or its returned promise settles. `startActiveSpan(name, callback)` leaves the span open and requires an explicit idempotent `span.end()`. Both make the span active only during the callback. After the callback returns, an open `startActiveSpan` span is no longer the active parent. Sources: [Custom spans API reference](https://developers.cloudflare.com/workers/observability/traces/custom-spans/), [July 28 `startActiveSpan` changelog](https://developers.cloudflare.com/changelog/post/2026-07-28-start-active-span/).

Cloudflare's `Span` only has:

- `isTraced`;
- `setAttribute(key, string | number | boolean | undefined)`;
- `end()`.

There is no public event API, outcome/status API, bulk attribute API, manual parent argument, or span/trace ID accessor. Cloudflare documents the missing `spanContext()` and `setOutcome()` explicitly. A non-sampled invocation still executes the callback; `isTraced` is false and telemetry is not recorded. Sources: [Custom spans limitations/API](https://developers.cloudflare.com/workers/observability/traces/custom-spans/); local type definition above.

Nested custom spans and platform operations such as `fetch` and KV calls are nested by Cloudflare's JavaScript async context. That is automatic context propagation, not caller-supplied parent-child wiring. `span.end()` after ending ignores later attributes. If a manual span is forgotten, Cloudflare documents a request-owned-object backstop, but says not to rely on it.

### What is automatically traced

When enabled, Cloudflare automatically instruments fetches, binding calls, handler invocations, Durable Object invocations, and Durable Object storage operations. The supported span/attribute inventory includes `durable_object_subrequest` and DO storage operations. Source: [Traces](https://developers.cloudflare.com/workers/observability/traces/), [Spans and attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/).

### Enablement, sampling, persistence, and export

Tracing is enabled by Worker metadata, not by a binding or a runtime exporter call:

```jsonc
{
  "observability": {
    "traces": {
      "enabled": true,
      "head_sampling_rate": 0.05,
      "persist": true,
      "destinations": ["my-otlp-destination"],
    },
  },
}
```

The rate is head-based and ranges from `0` through `1`; the documented default is `1`. `persist: false` exports without retaining the trace in the Cloudflare dashboard. Cloudflare's current docs describe traces and logs as the supported OTel signals; metrics export is not supported. Sources: [Traces: enablement, sampling, limits](https://developers.cloudflare.com/workers/observability/traces/), [Exporting OpenTelemetry data](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/).

Alchemy exposes this deployment metadata through `WorkerProps.observability`, including `traces.enabled`, `headSamplingRate`, and `persist`: `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts:222-225,635-643,1567-1597`. The underlying installed Cloudflare API schema additionally exposes `propagationPolicy` and encodes it as `propagation_policy`: `node_modules/@distilled.cloud/cloudflare/src/services/workers.ts:400-440,442-475`.

**Interpretation:** Cloudflare's tracing API is a collection/annotation mechanism. The runtime does not give the Worker a writable OTLP exporter, queue, flush API, destination handle, or export failure result. Cloudflare collects the events and later persists/exports them according to Worker/account configuration.

### Propagation and `traceparent`

Cloudflare now propagates traces automatically across same-account Worker-to-Worker service bindings and Durable Object calls, producing one Cloudflare trace. Source: [Automatic tracing across DO and Worker subrequests](https://developers.cloudflare.com/changelog/post/2026-05-07-automatic-tracing-across-do-and-worker-subrequests/).

The Workers API metadata has `traces.propagation_policy` values `authenticated` (default) and `accept`, described as controls for inbound `traceparent`/`tracestate` headers. Source: [Cloudflare Scripts API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/), and local schema cited above. This is a configuration/API surface, not a runtime method for reading or creating a span context.

The current tracing limitations page still says trace IDs are **not propagated to services outside Cloudflare** and that automatic W3C propagation to external services is planned. Therefore:

- internal Cloudflare subrequests: automatic propagation is verified;
- external HTTP services and Effect's OTLP exporter: do not assume a shared trace ID;
- inbound `traceparent` acceptance depends on the account/runtime propagation feature and configured policy; the official docs do not expose it to application code as a span-context object.

Source: [Known tracing limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/).

### Limits and failure behavior

Verified current constraints:

- tracing is open beta and span/attribute names may change;
- non-I/O spans may report `0 ms` because Workers does not update time continuously;
- custom attributes are scalar only and set one at a time;
- no manual parent wiring, span IDs, outcomes, or external trace-context API;
- trace events count toward observability quotas/pricing; the traces page documents Workers Free as 200,000 events/day with three-day retention and Workers Paid as ten million events/month plus additional-event pricing, while the export page gives a different export-specific table. This documentation discrepancy is unresolved and should not be hard-coded into application policy;
- no public per-trace custom-span count limit was found in the cited official pages.

`enterSpan` itself is safe on synchronous and asynchronous success/failure: it ends on settlement. `startActiveSpan` requires adapter-owned cleanup on success, failure, cancellation, and stream close. `waitUntil` can extend HTTP invocation work for up to 30 seconds after response; Durable Objects remain active during normal request/RPC/I/O handling and use `DurableObjectState.waitUntil` for explicit background work. Source: [Context API](https://developers.cloudflare.com/workers/runtime-apis/context/).

## Local `workerd` support

Alchemy's local Worker mode explicitly runs in `workerd` by default (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts:800-812`). Its local provider materializes DO bindings as local workerd namespaces (`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts:313-347,1031-1077`).

The installed binary is `workerd@1.20260704.1` (`node_modules/workerd/package.json:1-21`; platform binary package `@cloudflare/workerd-darwin-arm64:1.20260704.1`). A direct local smoke test served a module importing `cloudflare:workers` and observed:

```text
workerd 2026-07-04
{ "enterSpan":"function", "startActiveSpan":"function", "span":"function", "isTraced":false }
```

This verifies that the installed local runtime exposes both current custom-span methods. The bare test had no observability destination/configuration, so `isTraced: false` is expected; it did not prove dashboard/OTLP delivery from local workerd. The local types are newer than the binary, so release/version pinning and an integration test should remain part of any implementation.

## Effect v4 fit

Effect's low-level tracer is explicitly pluggable:

- `Tracer.span(options)` receives name, parent, annotations, links, start time, span kind, root flag, and sampling decision and must return a `Tracer.Span`: `repos/effect/packages/effect/src/Tracer.ts:20-42`;
- `Tracer.Span` requires identity, parent, attributes, links, status, `end(endTime, exit)`, `attribute`, `event`, and `addLinks`: `repos/effect/packages/effect/src/Tracer.ts:292-365`;
- `Tracer.make` constructs a custom tracer and `Tracer.Tracer` is the replaceable context service: `repos/effect/packages/effect/src/Tracer.ts:400-419,547-590`;
- `Effect.withTracer`, `Effect.withTracerEnabled`, `Effect.withTracerTiming`, `Effect.withSpan`, `Effect.annotateCurrentSpan`, `Effect.currentSpan`, and `Effect.currentParentSpan` are public APIs: `repos/effect/packages/effect/src/Effect.ts:7961-8014,8085-8139,8411-8463`;
- `Layer.span` creates scoped parent spans and `Layer.parentSpan` supplies an existing span: `repos/effect/packages/effect/src/Layer.ts:2425-2565`.

Effect creates spans synchronously during fiber evaluation, applies inherited/options attributes, and ends them from scope finalization or effect exit: `repos/effect/packages/effect/src/internal/effect.ts:5660-5722,5730-5745,5813-5849`. Fiber tracing can also provide a custom `Tracer.context` hook around primitive evaluation: `repos/effect/packages/effect/src/internal/effect.ts:640-655,709-729`. That hook does not solve Cloudflare's missing “activate this existing span” operation.

### Exact technical feasibility

A `CloudflareEffectTracer` can:

1. call `tracing.startActiveSpan(name, callback)` in `Tracer.span` and retain the callback's Cloudflare `Span` reference;
2. return an Effect `Tracer.Span` wrapper containing the Effect parent/tree, status, links, and a local attribute map;
3. copy only string/number/boolean attributes to Cloudflare;
4. map `Effect` end/failure to `cloudflareSpan.end()` and optionally safe scalar attributes such as `effect.outcome`;
5. set Effect `sampled` from Cloudflare `span.isTraced` and skip expensive attribute conversion when false;
6. make `end` idempotent and close it from Effect's request scope.

That is **technically possible**, including manual lifecycle and safe no-op fallback. It is **not semantically complete**: when a nested Effect span is allocated, the previous Cloudflare span is no longer active because the `startActiveSpan` callback has returned. Cloudflare therefore cannot use Effect's `parent` field to parent the nested runtime span. The adapter can retain the correct Effect tree locally, but Cloudflare will generally see custom spans as siblings under the currently active request/platform span. There is no supported API to repair this with a parent span ID.

## Alchemy composition-root findings

Alchemy already has the right seam for an application-owned tracer/exporter:

- `Telemetry.layer(exporter)` registers a custom telemetry Layer during Worker/DO initialization; a plain `Layer.succeed` is intentionally insufficient because event context is assembled later: `repos/alchemy/packages/alchemy/src/Telemetry.ts:420-451`;
- `buildEventTelemetry` builds the telemetry Layer into each event's request scope and degrades a failed build to an empty context with a warning: `repos/alchemy/packages/alchemy/src/Telemetry.ts:661-704`;
- `WorkerBridge` builds event telemetry, runs the Effect, and closes the per-request scope through `ctx.waitUntil`: `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerBridge.ts:88-145`;
- `DurableObjectBridge` does the same per DO call and closes the call scope through the DO state's context: `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectBridge.ts:124-176`;
- the existing `Telemetry.layerOtlp` path binds OTLP configuration at the root and ships Effect spans/logs/metrics over OTLP JSON, flushing at request scope close: `repos/alchemy/packages/alchemy/src/Telemetry.ts:609-671`;
- Alchemy's own tests demonstrate both the built-in OTLP binding layer and a custom `Tracer`/telemetry layer on Effect-native Workers: `repos/alchemy/packages/alchemy/test/Cloudflare/Workers/Telemetry.test.ts:54-155`, `fixtures/otel-custom-worker.ts:1-55`.

Alchemy's `WorkerExecutionContext` exposes raw `ExecutionContext` only as an interop field and models `waitUntil` as a runtime-colored application service: `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts:64-116`. DO code similarly receives a narrow `DurableObjectState` service with raw state and `waitUntil`, not a tracing service: `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObjectState.ts:11-30,64-85`. This supports keeping Cloudflare imports at the entrypoint/adapter boundary.

## Concrete adapter designs

### Design 1 — recommended: Effect OTLP tracer plus Cloudflare native platform tracing

At each Worker and DO composition root:

1. enable `observability.traces.enabled` and configure Cloudflare destinations/persistence for automatic platform traces;
2. provide `Alchemy.Telemetry.layerOtlp(...)` or `Alchemy.Telemetry.layer(customEffectTracerLayer)` through `Telemetry.layer(...)`;
3. let application code use ordinary `Effect.withSpan`, `Effect.annotateCurrentSpan`, and `Effect` service layers;
4. treat Cloudflare's trace as the platform/edge trace and Effect OTLP as the application trace.

This gives correct Effect parentage, attributes, links, statuses, and request-scope flush behavior. It does not claim the two streams are one trace; Cloudflare's external propagation limitation makes that link unavailable today. This is the safest production design when application-owned Effect spans matter more than showing them as Cloudflare custom spans.

### Design 2 — optional best-effort `CloudflareEffectTracer`

Expose an application-owned factory such as `CloudflareEffectTracing.layer()` from a platform adapter package. At the root, feature-detect `cloudflare:workers` and provide a per-event `Layer.succeed(Tracer.Tracer, ...)` through `Telemetry.layer(...)`. Do not pass `Env`, `ExecutionContext`, `DurableObjectState`, or binding names into application services.

Contract and policy:

- lifecycle: `startActiveSpan` at allocation; `end` exactly once from Effect scope/exit;
- attributes: copy only scalar values; redact/drop objects, secrets, and unsupported arrays;
- parent context: preserve Effect parent relationships in the Effect wrapper, but document Cloudflare hierarchy as best effort because manual parent wiring is unavailable;
- sampling: use Cloudflare `isTraced`; skip costly conversion when false; never disable application work because tracing is unavailable;
- failures: missing `cloudflare:workers`, unavailable methods, disabled tracing, or Cloudflare span errors become a no-op/Effect-native fallback and must not fail business Effects;
- scope: construct or select the adapter at Worker request and DO-call composition roots, not at isolate initialization; never retain request-coupled Cloudflare span objects across invocations;
- background/stream work: make the owner explicit, call `span.end()` on completion, rejection, cancellation, and stream close, and do not rely on request-destruction backstops.

This design is useful if Cloudflare dashboard visibility for coarse application operations is worth accepting sibling-span topology. It should not replace Alchemy's OTLP Effect tracer when exact nested spans are required.

### Design 3 — coarse root wrapper / annotation capability

If only request-level Cloudflare visibility is needed, keep the application on Effect's normal tracer and have the Worker/DO entrypoint wrap the complete handler promise with one Cloudflare `tracing.enterSpan` span. Expose an application-owned, scalar-only annotation port rather than raw Cloudflare `Span`. A root adapter can annotate route, operation, and safe correlation fields without leaking Cloudflare runtime types inward. This is the lowest-risk Cloudflare-native integration and avoids pretending that Effect child spans can be manually attached.

## Unresolved questions and follow-up checks

1. Cloudflare's public API schema exposes `propagation_policy`, while the tracing limitations page still says external W3C propagation is future work. Confirm account entitlement, compatibility date, and authenticated trace-token behavior before relying on inbound `traceparent`.
2. Cloudflare's traces and OTel-export pricing tables currently disagree; obtain the account-specific current pricing/limits before setting sampling policy.
3. The installed local workerd exposes both span methods, but the smoke test did not configure a local trace sink. Add a focused Alchemy local integration test before depending on local custom-span recording/export behavior.
4. If Cloudflare later adds public span context and manual parent activation, revisit Design 2; that is the missing capability needed for a faithful one-to-one Effect tracer.

## Primary sources

- Cloudflare: [Traces](https://developers.cloudflare.com/workers/observability/traces/)
- Cloudflare: [Custom spans](https://developers.cloudflare.com/workers/observability/traces/custom-spans/)
- Cloudflare: [Spans and attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/)
- Cloudflare: [Known limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/)
- Cloudflare: [Exporting OpenTelemetry data](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/)
- Cloudflare: [Context API](https://developers.cloudflare.com/workers/runtime-apis/context/)
- Cloudflare: [Scripts API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)
- Cloudflare: [Automatic tracing across DO and Worker subrequests](https://developers.cloudflare.com/changelog/post/2026-05-07-automatic-tracing-across-do-and-worker-subrequests/)
- Cloudflare: [Custom spans changelog](https://developers.cloudflare.com/changelog/post/2026-06-16-custom-spans/)
- Cloudflare: [`startActiveSpan` changelog](https://developers.cloudflare.com/changelog/post/2026-07-28-start-active-span/)
- Effect: local vendored `repos/effect/packages/effect/src/Tracer.ts`, `Effect.ts`, `Layer.ts`, `internal/effect.ts`
- Alchemy: local vendored `repos/alchemy/packages/alchemy/src/Telemetry.ts`, `Cloudflare/Workers/Worker.ts`, `WorkerBridge.ts`, `DurableObjectBridge.ts`, `DurableObjectState.ts`, `LocalWorkerProvider.ts`
- Local API/type definitions: `node_modules/@cloudflare/workers-types/index.d.ts`, `node_modules/@distilled.cloud/cloudflare/src/services/workers.ts`; local runtime `node_modules/workerd/bin/workerd` (`workerd 2026-07-04`).
