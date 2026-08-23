import { TestRunId, TestTraceId, TestTraceNotFoundError } from "@overseer/test-trace-protocol";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import {
  resolveTestTraceCollectorDeployment,
  waitForTestTraceCollectorDeployment,
} from "./test-trace-collector-deployment.ts";

it.effect(
  "resolves the production test trace collector connection without exposing its secret",
  () =>
    Effect.gen(function* () {
      const secret = Redacted.make("trace-collector-secret");
      const deployment = yield* resolveTestTraceCollectorDeployment(
        "trace-collector-client-id",
        secret,
      );

      assert.strictEqual(deployment.url.href, "https://ttc.mulroy.cloud/");
      assert.strictEqual(deployment.access.clientId, "trace-collector-client-id");
      assert.strictEqual(deployment.access.clientSecret, secret);
    }),
);

it.effect("rejects a test trace collector connection without a fresh Access secret", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      resolveTestTraceCollectorDeployment("trace-collector-client-id", undefined),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("verifies the test trace collector through its authenticated not-found contract", () =>
  Effect.gen(function* () {
    const deployment = yield* resolveTestTraceCollectorDeployment(
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

    yield* waitForTestTraceCollectorDeployment(deployment, testRunId).pipe(
      Effect.provide(Layer.succeed(HttpClient.HttpClient, recordingHttpClient)),
    );

    assert.strictEqual(yield* Ref.get(observedRequests), 1);
  }),
);
