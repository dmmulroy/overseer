import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { TestRunTraceClient } from "./test-run-traces/test-run-trace-client.ts";
import { TraceCollectorHttpApi } from "./trace-collector-http-api.ts";

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
          testRunTraces.getTestTrace(params.testRunId, params.traceId),
        );
    }),
);
