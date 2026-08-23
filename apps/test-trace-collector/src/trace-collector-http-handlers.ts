import { TestTraceNotFoundError, TraceCollectorHttpApi } from "@overseer/test-trace-protocol";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { TestRunTraceClient } from "./test-run-traces/test-run-trace-client.ts";

/** Public trace collector HTTP handlers that delegate to test-run Durable Objects. */
export const traceCollectorHttpHandlersLayer = HttpApiBuilder.group(
  TraceCollectorHttpApi,
  "traceCollector",
  (handlers) =>
    Effect.gen(function* () {
      const testRunTraces = yield* TestRunTraceClient;

      return handlers
        .handle("ingestOtlpTraces", ({ params, payload }) =>
          testRunTraces.ingestOtlpTraces(params.testRunId, payload),
        )
        .handle("getTestTrace", ({ params }) =>
          testRunTraces.findTestTrace(params.testRunId, params.traceId).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new TestTraceNotFoundError({
                      code: "test_trace_not_found",
                      message: `Test trace ${params.traceId} was not found in test run ${params.testRunId}`,
                      testRunId: params.testRunId,
                      traceId: params.traceId,
                    }),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          ),
        );
    }),
);
