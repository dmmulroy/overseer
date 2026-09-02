import { TestRunId, TestStage, TestTraceId } from "../../../src/overseer-e2e-trace-identity.ts";
import { Context, Effect, Exit, Layer, Option, Redacted, Ref, Schema, Tracer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";
import type { OverseerE2eAxiomDeployment } from "./overseer-e2e-axiom-deployment.ts";

/** Identity and span metadata attached to one E2E test execution trace. */
export interface TestExecutionTraceInput {
  /** Test run retained as a searchable Axiom resource attribute. */
  readonly runId: TestRunId;
  /** Isolated infrastructure stage retained as a searchable Axiom resource attribute. */
  readonly stage: TestStage;
  /** Stable test name used for the execution root span. */
  readonly spanName: string;
}

/** Product-test outcome and distributed trace identity captured for one execution. */
export interface TracedTestExecution<A, E> {
  /** Original test Effect exit, preserved independently from trace export. */
  readonly testExit: Exit.Exit<A, E>;
  /** Generated identity shared by the root and every propagated descendant span. */
  readonly traceId: TestTraceId;
}

/** Runs product tests under exported execution root spans. */
export interface ITestExecutionTracing {
  /** Runs one test Effect and flushes its completed spans before returning. */
  readonly traceTestExecution: <A, E, R>(
    input: TestExecutionTraceInput,
    productEffect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<TracedTestExecution<A, E>, never, Exclude<R, Tracer.ParentSpan>>;
}

/** Provides authority to create and export E2E test execution traces. */
export class TestExecutionTracing extends Context.Service<
  TestExecutionTracing,
  ITestExecutionTracing
>()("@overseer/test/TestExecutionTracing") {}

const ExportedTestTraceId = Schema.String.pipe(Schema.decodeTo(TestTraceId));
const refineExportedTestTraceId = Schema.decodeEffect(ExportedTestTraceId);

/** Constructs test execution tracing with the configured Axiom OTLP destination. */
export const makeTestExecutionTracing = (
  deployment: OverseerE2eAxiomDeployment,
): Effect.Effect<TestExecutionTracing["Service"], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;

    const traceTestExecution: ITestExecutionTracing["traceTestExecution"] = Effect.fn(
      "TestExecutionTracing.traceTestExecution",
    )(function* (input, productEffect) {
      const tracerLayer = OtlpTracer.layer({
        url: deployment.export.otlpEndpoint.href,
        resource: {
          serviceName: "overseer-e2e-harness",
          attributes: {
            "overseer.test.run_id": input.runId,
            "overseer.test.stage": input.stage,
          },
        },
        headers: {
          Authorization: `Bearer ${Redacted.value(deployment.export.ingestToken)}`,
          "X-Axiom-Dataset": deployment.datasetName,
        },
      }).pipe(
        Layer.provide(OtlpSerialization.layerJson),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
      );

      return yield* Effect.gen(function* () {
        const traceIdRef = yield* Ref.make(Option.none<TestTraceId>());
        const testExit = yield* Effect.gen(function* () {
          const span = yield* Tracer.ParentSpan;
          const traceId = yield* refineExportedTestTraceId(span.traceId).pipe(Effect.orDie);
          yield* Ref.set(traceIdRef, Option.some(traceId));
          return yield* productEffect;
        }).pipe(Effect.withSpan(input.spanName, { root: true }), Effect.exit);
        const traceId = Option.getOrThrowWith(
          yield* Ref.get(traceIdRef),
          () => new Error("Test execution tracing root span identity was not captured."),
        );

        const flusher = yield* OtlpExporter.Flusher;
        yield* flusher.flush.pipe(Effect.timeoutOption("10 seconds"));

        return {
          testExit,
          traceId,
        };
      }).pipe(Effect.provide(tracerLayer));
    });

    return TestExecutionTracing.of({ traceTestExecution });
  });

/** Provides test execution tracing while preserving its HTTP transport requirement. */
export const testExecutionTracingLayerWithoutDependencies = (
  deployment: OverseerE2eAxiomDeployment,
): Layer.Layer<TestExecutionTracing, never, HttpClient.HttpClient> =>
  Layer.effect(TestExecutionTracing, makeTestExecutionTracing(deployment));

/** Provides Axiom-backed test execution tracing with the production HTTP transport. */
export const testExecutionTracingLayer = (
  deployment: OverseerE2eAxiomDeployment,
): Layer.Layer<TestExecutionTracing> =>
  testExecutionTracingLayerWithoutDependencies(deployment).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
