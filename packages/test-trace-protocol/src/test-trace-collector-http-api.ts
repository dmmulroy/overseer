import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { OtlpTraceData } from "./otlp-trace-data.ts";
import {
  TestTraceCollectorUnavailableError,
  TestTraceNotFoundError,
} from "./test-trace-collector-error.ts";
import { TestRunId, TestTraceId } from "./test-trace-identity.ts";

const TestRunParams = Schema.Struct({ testRunId: TestRunId });
const TestTraceParams = Schema.Struct({ testRunId: TestRunId, traceId: TestTraceId });

const ingestOtlpTracesEndpoint = HttpApiEndpoint.post(
  "ingestOtlpTraces",
  "/test-runs/:testRunId/traces",
  {
    params: TestRunParams,
    payload: OtlpTraceData,
    success: Schema.Void,
    error: TestTraceCollectorUnavailableError,
  },
);

const getTestTraceEndpoint = HttpApiEndpoint.get(
  "getTestTrace",
  "/test-runs/:testRunId/traces/:traceId",
  {
    params: TestTraceParams,
    success: OtlpTraceData,
    error: [TestTraceNotFoundError, TestTraceCollectorUnavailableError],
  },
);

/** Public versioned OTLP ingestion and historical trace retrieval endpoints. */
export class TraceCollectorHttpApiGroup extends HttpApiGroup.make("traceCollector")
  .add(ingestOtlpTracesEndpoint)
  .add(getTestTraceEndpoint) {}

/** Public HTTP contract served by the standalone test trace collector Worker. */
export class TraceCollectorHttpApi extends HttpApi.make("TraceCollectorHttpApi")
  .add(TraceCollectorHttpApiGroup)
  .prefix("/v1") {}
