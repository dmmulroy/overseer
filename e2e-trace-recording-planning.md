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

- **Execution trace** — the trace data retained for one `TestExecution`. Whether this must be exactly one OpenTelemetry trace is unresolved.
- **Trace document** — a versioned, serialized representation of completed spans suitable for evidence persistence.
- **Trace recorder** — the candidate owner of execution-scoped span collection, final flush, serialization, and attachment. Whether this should be a service or part of an existing evidence primitive is unresolved.
- **Trace projection** — searchable metadata stored outside the trace document. The first slice may not need one.

## Current model to test

```text
TestRun
  TestExecution
    assertions
    artifacts
      possible versioned execution trace document
```

The key modeling question is whether an execution trace is completely represented as an ordinary execution artifact, or whether retrieval requires an additional indexed projection. This scratchpad must not add run-level artifact ownership.

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

- Is the trace document stored through the existing content-addressed execution artifact path?
- What versioned schema, media type, and artifact name identify it?
- Is one document per execution sufficient initially?
- Is execution-level correlation sufficient, or must assertions/requests link to individual spans?
- Which, if any, fields need SQLite projections for historical lookup?

### 6. Source redaction configuration

Do not design a trace-sanitizer abstraction for the initial system. Sensitive values remain wrapped in Effect `Redacted` values, and sensitive HTTP header names must be added to Effect's runtime redaction configuration before tracing is enabled. Initial trace instrumentation must not deliberately annotate request/response bodies or unwrapped secrets.

No credential or authorization material may enter the serialized trace document. If source redaction proves insufficient in practice, trace-document sanitization can be designed later from a concrete failure.

## Selected primitive direction

Use one execution-scoped `TestExecutionTrace` capability to wrap the product test in an Effect root span, coordinate OTLP flushing and collector completion, encode the resulting trace document, and attach it as ordinary execution evidence. The capability composes Effect's existing `OtlpTracer` and `OtlpExporter.Flusher`; Overseer does not define its own exporter or flusher interface.

A standalone, persistently deployed trace-collector application receives standard OTLP from the harness and application runtimes. It routes each test run to one Durable Object, which partitions retained spans by trace ID and returns trace snapshots. The collector does not initially own a trace-finalization state machine. Completeness coordination remains a later `TestExecutionTrace` concern, while the immutable trace document copied into the existing `TestExecution` artifact path remains the evidence record.

Do not add an in-memory capture adapter or a temporary harness-only recording path. Both local-workerd and deployed E2E runs cross process boundaries, so the first implementation slice must exercise the real OTLP path.

## Candidate first vertical slice

Not approved. The narrowest non-throwaway experiment is:

1. Start one root span for one focused local-workerd `TestExecution` with an execution-scoped harness `OtlpTracer`.
2. Export the harness span through the real run-scoped OTLP collector boundary.
3. Finalize a versioned trace document on both pass and deliberate failure.
4. Persist it as a `TestExecution` artifact through the existing evidence interface.
5. Retrieve and decode it from SQLite plus the content-addressed blob store.

This proves the real export and evidence path while intentionally deferring Worker/Durable Object instrumentation, remote flush coordination, trace indexing, and infrastructure lifecycle spans.

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

### No initial trace-sanitizer abstraction

The initial design relies on source-level safety: Effect `Redacted` values for sensitive data and Effect's HTTP header redaction configuration for sensitive header names. Trace-document sanitization, an attribute allowlist, and a standalone sanitizer service are out of scope until a concrete need appears.

### OTLP is the only capture path

Do not build an in-memory trace adapter. The harness uses one execution-scoped Effect `OtlpTracer`; application exporters are scoped to their Worker or Durable Object runtimes; and a run-scoped collector partitions all received spans by trace ID. This applies to both local-workerd and deployed E2E targets.

### The collector is standalone persistent infrastructure

Deploy the OTLP ingress Worker and its Durable Object namespace as a dedicated application under `apps/`, with an independently managed Alchemy Stack. Do not bundle or tear down collector infrastructure with each Overseer E2E stage. Address one Durable Object per `TestRun`; retain ingested trace spans for later retrieval while still attaching an immutable trace document to the owning `TestExecution` evidence.

### Initial collector scope excludes finalization, authentication, and configuration design

The first collector implementation persists idempotent spans and returns current trace snapshots. It does not add a persisted collecting/finalized state machine, late-span policy, authentication abstraction, or configuration system. Add those only when the E2E integration establishes a concrete requirement. Do not mistake the immutable execution evidence artifact for mutable collector storage.

Before implementation, this section must settle:

- first trace boundary;
- owning primitive;
- propagation scope;
- correlation IDs;
- export and flush lifecycle;
- persistence representation and artifact ownership;
- required source redaction configuration;
- exact first failing test and vertical slice.
