import { TestRunId, TestTraceId, TestTraceNotFoundError } from "@overseer/test-trace-protocol";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { resolveTestTraceCollectorConnection } from "./test-trace-collector-deployment.ts";
import {
  TestTraceCollector,
  testTraceCollectorLayerFromConnection,
} from "./test-trace-collector.ts";

it.effect("verifies TTC readiness through its authenticated not-found contract", () =>
  Effect.gen(function* () {
    const connection = yield* resolveTestTraceCollectorConnection(
      "trace-collector-client-id",
      Redacted.make("trace-collector-secret"),
    );
    const testRunId = TestRunId.make("test-run_readiness");
    const traceId = TestTraceId.make("0123456789abcdef0123456789abcdef");
    const observedRequests = yield* Ref.make(0);
    const recordingHttpClient = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        yield* Ref.update(observedRequests, (count) => count + 1);
        assert.strictEqual(
          url.href,
          `https://ttc.mulroy.cloud/v1/test-runs/${testRunId}/traces/${traceId}`,
        );
        assert.strictEqual(request.headers["cf-access-client-id"], "trace-collector-client-id");
        assert.strictEqual(request.headers["cf-access-client-secret"], "trace-collector-secret");

        const error = new TestTraceNotFoundError({
          code: "test_trace_not_found",
          message: `Test trace ${traceId} was not found in test run ${testRunId}`,
          testRunId,
          traceId,
        });
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(Schema.encodeSync(TestTraceNotFoundError)(error)), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    yield* Effect.gen(function* () {
      const collector = yield* TestTraceCollector;
      yield* collector.checkReadiness(testRunId);
    }).pipe(
      Effect.provide(testTraceCollectorLayerFromConnection(connection)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, recordingHttpClient)),
    );

    assert.strictEqual(yield* Ref.get(observedRequests), 1);
  }),
);
