import { TestSpanId, TestTraceId } from "../../../src/overseer-e2e-trace-identity.ts";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { OverseerTraceRuntimeComponent } from "../../../src/overseer-trace-runtime-component.ts";
import type { OverseerE2eAxiomDeployment } from "./overseer-e2e-axiom-deployment.ts";

/** Parsed Axiom fields required to verify one distributed E2E trace span. */
export const AxiomTraceSpan = Schema.Struct({
  traceId: TestTraceId,
  spanId: TestSpanId,
  parentSpanId: Schema.OptionFromNullOr(TestSpanId),
  spanName: Schema.String,
  spanKind: Schema.String,
  serviceName: Schema.String,
  runtimeComponent: Schema.OptionFromNullOr(OverseerTraceRuntimeComponent),
});

/** Parsed Axiom fields required by distributed trace acceptance. */
export type AxiomTraceSpan = typeof AxiomTraceSpan.Type;

const AxiomQueryField = <Name extends string>(name: Name) =>
  Schema.Struct({ name: Schema.Literal(name), type: Schema.String });

const AxiomTraceQueryResponse = Schema.Struct({
  tables: Schema.Tuple([
    Schema.Struct({
      fields: Schema.Tuple([
        AxiomQueryField("traceId"),
        AxiomQueryField("spanId"),
        AxiomQueryField("parentSpanId"),
        AxiomQueryField("spanName"),
        AxiomQueryField("spanKind"),
        AxiomQueryField("serviceName"),
        AxiomQueryField("runtimeComponent"),
      ]),
      columns: Schema.Tuple([
        Schema.Array(TestTraceId),
        Schema.Array(TestSpanId),
        Schema.Array(Schema.NullOr(TestSpanId)),
        Schema.Array(Schema.String),
        Schema.Array(Schema.String),
        Schema.Array(Schema.String),
        Schema.Array(Schema.NullOr(OverseerTraceRuntimeComponent)),
      ]),
    }),
  ]),
});

const AxiomTraceSpanCandidate = Schema.Struct({
  traceId: Schema.UndefinedOr(TestTraceId),
  spanId: Schema.UndefinedOr(TestSpanId),
  parentSpanId: Schema.UndefinedOr(Schema.NullOr(TestSpanId)),
  spanName: Schema.UndefinedOr(Schema.String),
  spanKind: Schema.UndefinedOr(Schema.String),
  serviceName: Schema.UndefinedOr(Schema.String),
  runtimeComponent: Schema.UndefinedOr(Schema.NullOr(OverseerTraceRuntimeComponent)),
}).pipe(Schema.decodeTo(AxiomTraceSpan));

const refineAxiomTraceSpanCandidate = Schema.decodeEffect(AxiomTraceSpanCandidate);
const parseAxiomTraceQueryResponse = HttpClientResponse.schemaBodyJson(AxiomTraceQueryResponse);

/** Failure to query or parse retained Axiom trace spans. */
export class AxiomTraceQueryError extends Schema.TaggedError<AxiomTraceQueryError>()(
  "AxiomTraceQueryError",
  {
    operation: Schema.Literal("queryAxiomTraceSpans"),
    reason: Schema.Literals(["RequestFailed", "ResponseInvalid"]),
    message: Schema.String,
    traceId: TestTraceId,
    cause: Schema.Defect(),
  },
) {}

/** Queries retained Axiom span rows needed by E2E trace acceptance. */
export interface IAxiomTraceQuery {
  /** Queries every retained span belonging to one distributed trace. */
  readonly queryAxiomTraceSpans: (
    traceId: TestTraceId,
  ) => Effect.Effect<ReadonlyArray<AxiomTraceSpan>, AxiomTraceQueryError>;
}

/** Provides query-only access to retained Overseer E2E traces in Axiom. */
export class AxiomTraceQuery extends Context.Service<AxiomTraceQuery, IAxiomTraceQuery>()(
  "@overseer/test/AxiomTraceQuery",
) {}

const makeAxiomTraceApl = (datasetName: string, traceId: TestTraceId): string => `['${datasetName}']
| where trace_id == '${traceId}'
| project traceId = trace_id,
          spanId = span_id,
          parentSpanId = parent_span_id,
          spanName = name,
          spanKind = kind,
          serviceName = ['service.name'],
          runtimeComponent = ['attributes.custom']['overseer.runtime.component']
| limit 10000`;

/** Constructs query-only access to retained Axiom E2E trace spans. */
export const makeAxiomTraceQuery = (
  deployment: OverseerE2eAxiomDeployment,
): Effect.Effect<AxiomTraceQuery["Service"], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const queryEndpoint = new URL("/v1/datasets/_apl?format=tabular", deployment.query.apiBaseUrl);

    const queryAxiomTraceSpans = Effect.fn("AxiomTraceQuery.queryAxiomTraceSpans")(function* (
      traceId: TestTraceId,
    ) {
      const request = yield* HttpClientRequest.post(queryEndpoint).pipe(
        HttpClientRequest.bearerToken(Redacted.value(deployment.query.queryToken)),
        HttpClientRequest.bodyJson({
          apl: makeAxiomTraceApl(deployment.datasetName, traceId),
          startTime: "now-1h",
          endTime: "now",
        }),
        Effect.mapError(
          (cause) =>
            new AxiomTraceQueryError({
              operation: "queryAxiomTraceSpans",
              reason: "RequestFailed",
              message: `Axiom E2E trace query request could not be created for trace ${traceId}. Verify the query configuration, then retry.`,
              traceId,
              cause,
            }),
        ),
      );
      const response = yield* HttpClient.filterStatusOk(httpClient)
        .execute(request)
        .pipe(
          Effect.mapError(
            (cause) =>
              new AxiomTraceQueryError({
                operation: "queryAxiomTraceSpans",
                reason: "RequestFailed",
                message: `Axiom E2E trace query failed for trace ${traceId}. Verify the retained dataset, query credential, and Axiom availability, then retry.`,
                traceId,
                cause,
              }),
          ),
        );
      const queryResponse = yield* parseAxiomTraceQueryResponse(response).pipe(
        Effect.mapError(
          (cause) =>
            new AxiomTraceQueryError({
              operation: "queryAxiomTraceSpans",
              reason: "ResponseInvalid",
              message: `Axiom returned an invalid E2E trace query response for trace ${traceId}. Inspect Axiom query schema compatibility before retrying.`,
              traceId,
              cause,
            }),
        ),
      );
      const [
        traceIds,
        spanIds,
        parentSpanIds,
        spanNames,
        spanKinds,
        serviceNames,
        runtimeComponents,
      ] = queryResponse.tables[0].columns;

      return yield* Effect.forEach(traceIds, (rowTraceId, index) => {
        const row = {
          traceId: rowTraceId,
          spanId: spanIds[index],
          parentSpanId: parentSpanIds[index],
          spanName: spanNames[index],
          spanKind: spanKinds[index],
          serviceName: serviceNames[index],
          runtimeComponent: runtimeComponents[index],
        };
        return refineAxiomTraceSpanCandidate(row);
      }).pipe(
        Effect.mapError(
          (cause) =>
            new AxiomTraceQueryError({
              operation: "queryAxiomTraceSpans",
              reason: "ResponseInvalid",
              message: `Axiom returned invalid E2E trace span rows for trace ${traceId}. Inspect Axiom query schema compatibility before retrying.`,
              traceId,
              cause,
            }),
        ),
      );
    });

    return AxiomTraceQuery.of({ queryAxiomTraceSpans });
  });

/** Provides Axiom trace queries while preserving their HTTP transport requirement. */
export const axiomTraceQueryLayerWithoutDependencies = (
  deployment: OverseerE2eAxiomDeployment,
): Layer.Layer<AxiomTraceQuery, never, HttpClient.HttpClient> =>
  Layer.effect(AxiomTraceQuery, makeAxiomTraceQuery(deployment));

/** Provides query-only Axiom trace access with the production HTTP transport. */
export const axiomTraceQueryLayer = (
  deployment: OverseerE2eAxiomDeployment,
): Layer.Layer<AxiomTraceQuery> =>
  axiomTraceQueryLayerWithoutDependencies(deployment).pipe(Layer.provide(FetchHttpClient.layer));
