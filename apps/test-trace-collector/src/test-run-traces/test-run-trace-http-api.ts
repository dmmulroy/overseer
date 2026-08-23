import { OtlpTraceData, TestTraceId } from "@overseer/test-trace-protocol";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

const TestTraceParams = Schema.Struct({ traceId: TestTraceId });

const ingestOtlpTracesEndpoint = HttpApiEndpoint.post("ingestOtlpTraces", "/traces", {
  payload: OtlpTraceData,
  success: Schema.Void,
});

const findTestTraceEndpoint = HttpApiEndpoint.get("findTestTrace", "/traces/:traceId", {
  params: TestTraceParams,
  success: Schema.OptionFromNullOr(OtlpTraceData),
});

/** Versioned internal HTTP endpoints served by one test-run trace Durable Object. */
export class TestRunTraceHttpApiGroup extends HttpApiGroup.make("testRunTrace")
  .add(ingestOtlpTracesEndpoint)
  .add(findTestTraceEndpoint) {}

/** Shared HTTP contract used by the test-run trace Durable Object server and client. */
export class TestRunTraceHttpApi extends HttpApi.make("TestRunTraceHttpApi")
  .add(TestRunTraceHttpApiGroup)
  .prefix("/v1") {}
