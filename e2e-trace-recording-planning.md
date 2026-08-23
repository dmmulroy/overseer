# E2E Trace Recording Planning

This is a collaborative design scratchpad for retaining Effect OpenTelemetry traces as end-to-end test evidence. Nothing here is settled until it is recorded under **Decisions**. Production implementation must not begin until the first boundary and vertical slice are agreed.

Existing contracts remain owned by:

- [`docs/evidence-assertion-recording-spec.md`](docs/evidence-assertion-recording-spec.md) for evidence, assertions, and artifact ownership;
- [`docs/testing.md`](docs/testing.md) for E2E targets and harness lifecycle;
- [`docs/coding-standards.md`](docs/coding-standards.md) for engineering and observability rules.

Effect's pinned tracing APIs and runtime semantics are documented in [`docs/research/effect-v4-opentelemetry-tracing.md`](docs/research/effect-v4-opentelemetry-tracing.md).

## Fixed constraints

- An artifact belongs to a `TestExecution`, never directly to a `TestRun`.
- Use Effect's pinned OpenTelemetry integration rather than introducing an unrelated tracing API.
- Historical passed and failed executions must be diagnosable without rerunning the test.
- Credentials, authorization headers, secrets, and unapproved personal data must not be persisted.
- Prefer a small, deep primitive with explicit lifecycle behavior over a broad trace framework.

## Working vocabulary

These terms are candidates until agreed:

- **Execution trace** — the one OpenTelemetry trace correlated with a `TestExecution`.
- **Trace reference** — the trace ID and exact Access-protected TTC lookup URL retained by a finished `TestExecution`.
- **Trace collector** — the persistent TTC service that receives standard OTLP and remains the canonical trace store.

## Current model to test

```text
TestRun
  TestExecution
    assertions
    artifacts
    trace
      trace ID
      TTC lookup URL
```

The execution trace is first-class execution evidence stored by reference. TTC remains the canonical trace store, and consumers query it lazily by the exact Access-protected URL retained on the execution. This scratchpad must not add run-level trace ownership.

## Design questions

### 1. First trace boundary

Choose the first boundary before choosing an exporter:

- **Harness-local:** spans created inside the Node E2E harness only.
- **Public API:** harness spans plus context propagated into the Worker.
- **End-to-end distributed:** context propagated through the Worker and relevant Durable Objects.

Also decide whether deployment, readiness, and teardown are outside all `TestExecution`s, independently recorded infrastructure work, or part of a later model.

### 2. Cardinality and ownership

- Does one `TestExecution` own exactly one root span and one trace ID?
- Can an execution legitimately reference multiple traces?
- Does the existing evidence recorder own trace attachment, or does an execution-scoped trace recorder compose with it?
- What does a skipped execution retain when no span starts?

### 3. Context and correlation

Decide which values are safe span attributes and which are indexed for lookup:

- `TestRunId`
- `TestExecutionId`
- `TestId`
- target
- stage
- request ID

For a deployed boundary, establish how W3C trace context crosses the schema-derived HTTP client, Cloudflare Access, Worker, Workspace Durable Object, and Bookkeeper Durable Object.

### 4. Collection lifecycle

- How is collection isolated when executions overlap?
- Which Effect/OpenTelemetry resource owns exporter acquisition and shutdown?
- When is force-flush required?
- How are completed spans retained after success, expected failure, defect, timeout, or interruption?
- What happens when trace serialization or persistence itself fails?

### 5. Persistence and retrieval

- TTC stores the standard OTLP trace and accepts late spans from Cloudflare `waitUntil` exports.
- A finished execution stores one trace ID and exact TTC lookup URL.
- Trace consumers authenticate to TTC and retrieve the current snapshot lazily.
- Execution-level correlation is sufficient initially; assertions and requests do not store individual span references.

### 6. HTTP trace disclosure policy

Sensitive values remain wrapped in Effect `Redacted` values, and sensitive HTTP header names are added to Effect's runtime redaction configuration before tracing is enabled. Initial trace instrumentation does not deliberately annotate request/response bodies or unwrapped secrets.

Effect exposes a client header filter but no equivalent server header filter. TTC therefore reapplies the shared request/response header allowlist before persistence, removes raw query, user-agent, and client-address attributes, and strips query and credential components from full URLs. `cf-access-authenticated-user-email` is explicitly approved for trace diagnostics; credentials and other personal request metadata are not.

## Selected primitive direction

Use the `TestTraceCollector` service to wrap each test Effect in an execution root span, flush the harness exporter, and retain the generated trace ID plus exact TTC lookup URL as first-class execution evidence. The service composes Effect's existing `OtlpTracer` and `OtlpExporter.Flusher`; Overseer does not define its own exporter or flusher interface.

A standalone, persistently deployed trace-collector application receives standard OTLP from the harness and application runtimes. It routes each test run to one Durable Object, which partitions retained spans by trace ID and returns current trace snapshots. TTC remains the canonical trace store. Consumers query lazily, allowing Worker and Durable Object spans scheduled through Cloudflare `waitUntil` to arrive after the product response without adding trace-finalization semantics to the test lifecycle.

Do not add an in-memory capture adapter or a temporary harness-only recording path. Both local-workerd and deployed E2E runs cross process boundaries, so the first implementation slice must exercise the real OTLP path.

## First vertical slice

Approved. The narrowest non-throwaway integration is:

1. Start one root span for each `TestExecution` with an execution-scoped harness `OtlpTracer`.
2. Export the harness span through the real run-scoped OTLP collector boundary.
3. Preserve the test Effect exit independently from trace export.
4. Persist `Completed` evidence containing the generated trace ID and exact TTC lookup URL on the finished execution.
5. Retrieve the eventually complete trace lazily from TTC.
6. Run one explicit after-run acceptance check that requires all logical Overseer services to appear in one TTC trace without asserting incidental span topology.

This proves the real export and correlation path without duplicating TTC data in the evidence artifact store or coordinating remote Cloudflare `waitUntil` completion in the test lifecycle.

## Grounded findings from Effect research

- A structured `Effect.withSpan` root finalizes on every Effect exit; bare `makeSpan` does not own finalization.
- A per-execution `Tracer.Tracer` provision is a viable harness-local collection boundary.
- The lightweight `OtlpTracer` sends batches to an OTLP endpoint but does not expose an in-memory recorder and has best-effort disable/drop behavior.
- The official `InMemorySpanExporter` route requires adding `@effect/opentelemetry` and compatible OpenTelemetry SDK packages; they are not currently installed.
- Default HTTP tracing captures full URLs, raw query strings, and almost all headers. The Cloudflare Access secret header is not redacted by default.
- Logs and rendered failure messages/stacks are also retained as span events.
- Effect HTTP propagates W3C `traceparent` and B3, but not W3C `tracestate` or baggage.
- An execution can contain multiple trace IDs unless the harness enforces a single-root rule.

## Research needed before deciding

- [x] Inspect the APIs actually available in pinned `effect@4.0.0-beta.107`, the exact vendored `@effect/opentelemetry`, and the currently installed package set.
- [ ] Map `OverseerTestHarness` success, failure, timeout, interruption, and finalization paths.
- Map execution evidence recording and local artifact persistence ownership.
- Determine whether the installed exporter/provider model can safely isolate concurrent executions.
- Draw context propagation for local and deployed requests.
- Compare the three primitive shapes above using concrete lifecycle failure scenarios.

## Decisions

### Trace evidence is a first-class execution sibling backed by TTC

`TestExecution.trace` owns the trace identity and exact Access-protected TTC lookup URL. TTC remains the canonical trace store; automatic trace data is not duplicated in the author-attached `TestExecution.artifacts` collection.

### TTC enforces the shared HTTP trace disclosure policy

Source-level safety uses Effect `Redacted` values, client header filtering, and HTTP header redaction. Because Effect's server tracer records broader request metadata without a server-side filter, TTC also applies the shared HTTP attribute allowlist before persistence. This is a persistence-boundary policy, not a standalone sanitizer service.

### OTLP is the only capture path

Do not build an in-memory trace adapter. The harness uses one execution-scoped Effect `OtlpTracer`; application exporters are scoped to their Worker or Durable Object runtimes; and a run-scoped collector partitions all received spans by trace ID. This applies to both local-workerd and deployed E2E targets.

### The collector is standalone persistent infrastructure

Deploy the OTLP ingress Worker and its Durable Object namespace as a dedicated application under `apps/`, with an independently managed Alchemy Stack. Do not bundle or tear down collector infrastructure with each Overseer E2E stage. Address one Durable Object per `TestRun`; retain ingested trace spans for lazy retrieval through the URL stored on the owning `TestExecution`.

### Initial collector scope excludes finalization and configuration design

The first collector implementation persists idempotent spans and returns current trace snapshots. It does not add a persisted collecting/finalized state machine, late-span policy, or configuration system. Add those only when the E2E integration establishes a concrete requirement. Lazy retrieval intentionally exposes the collector's current eventually complete snapshot.

Shared infrastructure owns one service token and a `non_identity` policy for Overseer runtimes; deployed collectors reference that policy without owning the credential. Production is Access-protected at `ttc.mulroy.cloud` with `workers.dev` disabled. Preview is Access-protected at its stage-specific `workers.dev` hostname. Local development remains local and does not provision Access.

The initial harness-local integration settles:

- first trace boundary;
- owning primitive;
- propagation scope;
- correlation IDs;
- export and flush lifecycle;
- trace-reference persistence and TTC ownership;
- required source redaction configuration;
- exact first failing test and vertical slice.
