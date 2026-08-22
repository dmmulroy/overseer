import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { TestRunTraceDatabase } from "./test-run-trace-database.ts";
import { TestRunTraceHttpApi } from "./test-run-trace-http-api.ts";

/** Internal Durable Object HTTP handlers backed by test-run trace persistence. */
export const testRunTraceHttpHandlersLayer = HttpApiBuilder.group(
  TestRunTraceHttpApi,
  "testRunTrace",
  (handlers) =>
    Effect.gen(function* () {
      const database = yield* TestRunTraceDatabase;

      return handlers
        .handle("ingestOtlpTraces", ({ payload }) =>
          database.ingestOtlpTraces(payload).pipe(Effect.orDie),
        )
        .handle("findTestTrace", ({ params }) =>
          database.findTestTrace(params.traceId).pipe(Effect.orDie),
        );
    }),
);
