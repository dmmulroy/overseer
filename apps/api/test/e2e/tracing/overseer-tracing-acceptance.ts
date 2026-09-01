import { TestRunId } from "../../../src/overseer-e2e-trace-identity.ts";
import { Effect, Option, Schedule, Schema } from "effect";
import type { CompletedTestExecutionTraceEvidence } from "../evidence/test-execution-trace-evidence.ts";
import type { OverseerTestHarness } from "../harness/overseer-test-harness.ts";
import { type AxiomTraceSpan, AxiomTraceQuery } from "./axiom-trace-query.ts";

const expectedOverseerTraceServiceNames = new Set(["overseer-e2e-harness", "overseer-api-worker"]);
const expectedOverseerTraceRuntimeComponents = new Set(["api-worker", "workspace-durable-object"]);

/** Expected failure when Axiom never exposes complete distributed E2E trace coverage. */
export class OverseerTraceCoverageIncompleteError extends Schema.TaggedError<OverseerTraceCoverageIncompleteError>()(
  "OverseerTraceCoverageIncompleteError",
  {
    operation: Schema.Literal("waitForOverseerTraceCoverage"),
    message: Schema.String,
    testRunId: TestRunId,
    candidateCount: Schema.Natural,
  },
) {}

const collectAxiomTraceServiceNames = (spans: ReadonlyArray<AxiomTraceSpan>): ReadonlySet<string> =>
  new Set(spans.map((span) => span.serviceName));

const collectAxiomRuntimeComponents = (spans: ReadonlyArray<AxiomTraceSpan>): ReadonlySet<string> =>
  new Set(spans.flatMap((span) => Option.toArray(span.runtimeComponent)));

const isAxiomClientSpan = (span: AxiomTraceSpan): boolean =>
  span.spanKind.toLowerCase() === "client" || span.spanKind.toLowerCase().endsWith("_client");

const isAxiomServerSpan = (span: AxiomTraceSpan): boolean =>
  span.spanKind.toLowerCase() === "server" || span.spanKind.toLowerCase().endsWith("_server");

const hasNormalizedOverseerHttpSpanName = (span: AxiomTraceSpan): boolean => {
  if (span.spanName.startsWith("http.client ")) {
    return /^http\.client [A-Z]+ \//.test(span.spanName);
  }
  if (span.spanName.startsWith("http.server ")) {
    return /^http\.server [A-Z]+ \//.test(span.spanName);
  }
  return true;
};

const hasCompleteAxiomTraceParentage = (spans: ReadonlyArray<AxiomTraceSpan>): boolean => {
  const spansById = new Map(spans.map((span) => [span.spanId, span]));
  const serverParentSpanIds = new Set(
    spans.flatMap((span) =>
      isAxiomServerSpan(span) && Option.isSome(span.parentSpanId) ? [span.parentSpanId.value] : [],
    ),
  );

  return spans.every((span) => {
    if (!hasNormalizedOverseerHttpSpanName(span)) return false;
    if (
      isAxiomClientSpan(span) &&
      span.spanName.startsWith("http.client ") &&
      !serverParentSpanIds.has(span.spanId)
    ) {
      return false;
    }
    if (Option.isNone(span.parentSpanId)) return true;

    const parent = spansById.get(span.parentSpanId.value);
    if (parent === undefined) return false;
    return !isAxiomServerSpan(span) || isAxiomClientSpan(parent);
  });
};

const hasExpectedOverseerTraceCoverage = (spans: ReadonlyArray<AxiomTraceSpan>): boolean => {
  const observedServiceNames = collectAxiomTraceServiceNames(spans);
  const observedRuntimeComponents = collectAxiomRuntimeComponents(spans);
  return (
    [...expectedOverseerTraceServiceNames].every((serviceName) =>
      observedServiceNames.has(serviceName),
    ) &&
    [...expectedOverseerTraceRuntimeComponents].every((component) =>
      observedRuntimeComponents.has(component),
    ) &&
    spans.some((span) => span.spanName.includes("/v1/workspaces/:workspaceId")) &&
    hasCompleteAxiomTraceParentage(spans)
  );
};

const waitForOverseerTraceCoverage = Effect.fn(
  "OverseerTracingAcceptance.waitForOverseerTraceCoverage",
)(function* (testRunId: TestRunId, traces: ReadonlyArray<CompletedTestExecutionTraceEvidence>) {
  const axiomTraceQuery = yield* AxiomTraceQuery;
  const findCompleteTrace = Effect.gen(function* () {
    const traceSpans = yield* Effect.forEach(traces, (trace) =>
      axiomTraceQuery.queryAxiomTraceSpans(trace.traceId),
    );
    const everyTraceHasCompleteParentage =
      traceSpans.every((spans) => spans.length > 0) &&
      traceSpans.every(hasCompleteAxiomTraceParentage);
    const oneTraceHasExpectedCoverage = traceSpans.some(hasExpectedOverseerTraceCoverage);
    if (everyTraceHasCompleteParentage && oneTraceHasExpectedCoverage) return;

    return yield* Effect.fail(
      new OverseerTraceCoverageIncompleteError({
        operation: "waitForOverseerTraceCoverage",
        message:
          "Axiom did not expose complete parent-linked Overseer E2E traces before the acceptance deadline. Verify trace export for the harness, API Worker, and Workspace Durable Object, then retry the E2E run.",
        testRunId,
        candidateCount: traces.length,
      }),
    );
  });

  yield* findCompleteTrace.pipe(
    Effect.retry({ schedule: Schedule.spaced("500 millis"), times: 60 }),
  );
});

/** Registers the explicit Axiom service and runtime-component acceptance check for an E2E run. */
export const registerOverseerTracingAcceptance = (harness: OverseerTestHarness): void => {
  harness.afterRun(({ run }) => {
    const completedTraces = run.tests.flatMap((test) =>
      test.executions.flatMap((execution) =>
        execution._tag === "Finished" ? [execution.trace] : [],
      ),
    );
    return waitForOverseerTraceCoverage(run.id, completedTraces);
  });
};
