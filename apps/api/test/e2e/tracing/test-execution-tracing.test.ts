import { TestRunId, TestStage } from "../../../src/overseer-e2e-trace-identity.ts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Ref } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { OverseerE2eAxiomDeployment } from "./overseer-e2e-axiom-deployment.ts";
import {
  TestExecutionTracing,
  testExecutionTracingLayerWithoutDependencies,
} from "./test-execution-tracing.ts";

const axiomDeployment: OverseerE2eAxiomDeployment = {
  datasetName: "overseer-e2e-traces",
  export: {
    ingestToken: Redacted.make("axiom-ingest-token"),
    otlpEndpoint: new URL("https://api.axiom.co/v1/traces"),
  },
  query: {
    apiBaseUrl: new URL("https://api.axiom.co"),
    queryToken: Redacted.make("axiom-query-token"),
  },
};

it.effect("exports one completed test execution trace to the configured Axiom dataset", () =>
  Effect.gen(function* () {
    const observedRequests = yield* Ref.make(0);
    const recordingHttpClient = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        yield* Ref.update(observedRequests, (count) => count + 1);
        assert.strictEqual(url.href, "https://api.axiom.co/v1/traces");
        assert.strictEqual(request.headers.authorization, "Bearer axiom-ingest-token");
        assert.strictEqual(request.headers["x-axiom-dataset"], "overseer-e2e-traces");
        return HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }));
      }),
    );

    const tracedExecution = yield* Effect.gen(function* () {
      const tracing = yield* TestExecutionTracing;
      return yield* tracing.traceTestExecution(
        {
          runId: TestRunId.make("test-run_test-axiom-export"),
          stage: TestStage.make("test-axiom-export"),
          spanName: "exports one completed execution",
        },
        Effect.succeed("product-result"),
      );
    }).pipe(
      Effect.provide(testExecutionTracingLayerWithoutDependencies(axiomDeployment)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, recordingHttpClient)),
    );

    assert.strictEqual(tracedExecution.testExit._tag, "Success");
    if (tracedExecution.testExit._tag === "Success") {
      assert.strictEqual(tracedExecution.testExit.value, "product-result");
    }
    assert.match(tracedExecution.traceId, /^[0-9a-f]{32}$/);
    assert.strictEqual(yield* Ref.get(observedRequests), 1);
  }),
);
