import { TestTraceId } from "../../../src/overseer-e2e-trace-identity.ts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { OverseerE2eAxiomDeployment } from "./overseer-e2e-axiom-deployment.ts";
import { AxiomTraceQuery, axiomTraceQueryLayerWithoutDependencies } from "./axiom-trace-query.ts";

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

const projectedAxiomResponse = {
  tables: [
    {
      fields: [
        { name: "traceId", type: "string" },
        { name: "spanId", type: "string" },
        { name: "parentSpanId", type: "string" },
        { name: "spanName", type: "string" },
        { name: "spanKind", type: "string" },
        { name: "serviceName", type: "string" },
        { name: "runtimeComponent", type: "string" },
      ],
      columns: [
        ["0123456789abcdef0123456789abcdef"],
        ["0123456789abcdef"],
        [null],
        ["test execution"],
        ["internal"],
        ["overseer-e2e-harness"],
        ["api-worker"],
      ],
    },
  ],
};

it.effect("queries retained Axiom spans with the query-only E2E credential", () =>
  Effect.gen(function* () {
    const traceId = TestTraceId.make("0123456789abcdef0123456789abcdef");
    const recordingHttpClient = HttpClient.make((request, url) => {
      assert.strictEqual(url.href, "https://api.axiom.co/v1/datasets/_apl?format=tabular");
      assert.strictEqual(request.headers.authorization, "Bearer axiom-query-token");
      assert.notStrictEqual(request.headers.authorization, "Bearer axiom-ingest-token");
      assert.strictEqual(request.body._tag, "Uint8Array");
      if (request.body._tag === "Uint8Array") {
        const requestBody = new TextDecoder().decode(request.body.body);
        assert.isTrue(requestBody.includes("overseer-e2e-traces"));
        assert.isTrue(requestBody.includes(traceId));
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(projectedAxiomResponse), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    });

    const spans = yield* Effect.gen(function* () {
      const axiomTraceQuery = yield* AxiomTraceQuery;
      return yield* axiomTraceQuery.queryAxiomTraceSpans(traceId);
    }).pipe(
      Effect.provide(axiomTraceQueryLayerWithoutDependencies(axiomDeployment)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, recordingHttpClient)),
    );

    assert.strictEqual(spans.length, 1);
    const span = Option.getOrThrow(Option.fromUndefinedOr(spans[0]));
    assert.strictEqual(span.traceId, traceId);
    assert.strictEqual(span.spanId, "0123456789abcdef");
    assert.isTrue(Option.isNone(span.parentSpanId));
    assert.strictEqual(span.serviceName, "overseer-e2e-harness");
    assert.deepStrictEqual(Option.getOrThrow(span.runtimeComponent), "api-worker");
  }),
);

it.effect("classifies unsuccessful Axiom query requests", () =>
  Effect.gen(function* () {
    const traceId = TestTraceId.make("0123456789abcdef0123456789abcdef");
    const unauthorizedHttpClient = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 401 }))),
    );

    const error = yield* Effect.gen(function* () {
      const axiomTraceQuery = yield* AxiomTraceQuery;
      return yield* axiomTraceQuery.queryAxiomTraceSpans(traceId);
    }).pipe(
      Effect.provide(axiomTraceQueryLayerWithoutDependencies(axiomDeployment)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, unauthorizedHttpClient)),
      Effect.flip,
    );

    assert.strictEqual(error.reason, "RequestFailed");
    assert.include(error.message, "query credential");
  }),
);

it.effect("classifies invalid Axiom query responses", () =>
  Effect.gen(function* () {
    const traceId = TestTraceId.make("0123456789abcdef0123456789abcdef");
    const invalidResponseHttpClient = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ tables: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    const error = yield* Effect.gen(function* () {
      const axiomTraceQuery = yield* AxiomTraceQuery;
      return yield* axiomTraceQuery.queryAxiomTraceSpans(traceId);
    }).pipe(
      Effect.provide(axiomTraceQueryLayerWithoutDependencies(axiomDeployment)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, invalidResponseHttpClient)),
      Effect.flip,
    );

    assert.strictEqual(error.reason, "ResponseInvalid");
    assert.include(error.message, "schema compatibility");
  }),
);
