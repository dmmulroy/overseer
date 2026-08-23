import { type OtlpTraceData, TestRunId } from "@overseer/test-trace-protocol";
import { Effect, Option, Schedule, Schema } from "effect";
import type { CompletedTestExecutionTraceEvidence } from "./evidence/test-execution-trace-ref.ts";
import type { OverseerTestHarness } from "./overseer-test-harness.ts";
import { TestTraceCollector } from "./test-trace-collector.ts";

const expectedOverseerTraceServiceNames = new Set([
  "overseer-e2e-harness",
  "overseer-api-worker",
  "overseer-workspace-durable-object",
  "overseer-bookkeeper-durable-object",
]);

/** Expected failure when TTC never exposes all logical Overseer services in one test trace. */
export class OverseerTraceServicesIncompleteError extends Schema.TaggedError<OverseerTraceServicesIncompleteError>()(
  "OverseerTraceServicesIncompleteError",
  {
    operation: Schema.Literal("waitForOverseerTraceServices"),
    message: Schema.String,
    testRunId: TestRunId,
    candidateCount: Schema.Natural,
  },
) {}

const traceServiceNames = (traceData: OtlpTraceData): ReadonlySet<string> => {
  const serviceNames = new Set<string>();
  for (const resourceSpan of traceData.resourceSpans) {
    for (const attribute of resourceSpan.resource.attributes) {
      const serviceName = attribute.value.stringValue;
      if (attribute.key === "service.name" && serviceName !== undefined && serviceName !== null) {
        serviceNames.add(serviceName);
      }
    }
  }
  return serviceNames;
};

const hasExpectedOverseerTraceServices = (traceData: OtlpTraceData): boolean => {
  const observedServiceNames = traceServiceNames(traceData);
  return [...expectedOverseerTraceServiceNames].every((serviceName) =>
    observedServiceNames.has(serviceName),
  );
};

const waitForOverseerTraceServices = Effect.fn(
  "OverseerTracingAcceptance.waitForOverseerTraceServices",
)(function* (testRunId: TestRunId, traces: ReadonlyArray<CompletedTestExecutionTraceEvidence>) {
  const collector = yield* TestTraceCollector;
  const findCompleteTrace = Effect.gen(function* () {
    const snapshots = yield* Effect.forEach(traces, (trace) =>
      collector.getTrace(testRunId, trace.traceId).pipe(Effect.option),
    );
    if (snapshots.some(Option.exists(hasExpectedOverseerTraceServices))) return;

    return yield* Effect.fail(
      new OverseerTraceServicesIncompleteError({
        operation: "waitForOverseerTraceServices",
        message:
          "TTC did not expose the E2E harness, API Worker, Workspace Durable Object, and Bookkeeper Durable Object services in one trace before the acceptance deadline.",
        testRunId,
        candidateCount: traces.length,
      }),
    );
  });

  yield* findCompleteTrace.pipe(
    Effect.retry({ schedule: Schedule.spaced("500 millis"), times: 60 }),
  );
});

/** Register the explicit TTC service-presence acceptance check for an Overseer E2E run. */
export const registerOverseerTracingAcceptance = (harness: OverseerTestHarness): void => {
  harness.afterRun(({ run }) => {
    const completedTraces = run.tests.flatMap((test) =>
      test.executions.flatMap((execution) =>
        execution._tag === "Finished" ? [execution.trace] : [],
      ),
    );
    return waitForOverseerTraceServices(run.id, completedTraces);
  });
};
