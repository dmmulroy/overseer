import { SqliteClient } from "@effect/sql-sqlite-node";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import type { OtlpTraceData } from "../otlp-trace-data.ts";
import { TestSpanId, TestTraceId } from "../test-trace-identity.ts";
import {
  TestRunTraceDatabase,
  testRunTraceDatabaseLayerWithoutDependencies,
} from "./test-run-trace-database.ts";

type OtlpResourceSpanValue = OtlpTraceData["resourceSpans"][number];
type OtlpScopeSpanValue = OtlpResourceSpanValue["scopeSpans"][number];
type OtlpSpanValue = OtlpScopeSpanValue["spans"][number];

const makeOtlpSpan = (
  traceId: TestTraceId,
  spanId: TestSpanId,
  parentSpanId: TestSpanId | undefined,
  name: string,
): OtlpSpanValue => ({
  traceId,
  spanId,
  parentSpanId,
  name,
  kind: 1,
  startTimeUnixNano: "1000000",
  endTimeUnixNano: "2000000",
  attributes: [],
  droppedAttributesCount: 0,
  events: [],
  droppedEventsCount: 0,
  status: { code: 1 },
  links: [],
  droppedLinksCount: 0,
});

const makeOtlpTraceData = (spans: Array<OtlpSpanValue>): OtlpTraceData => ({
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: "trace-database-test" } }],
        droppedAttributesCount: 0,
      },
      scopeSpans: [{ scope: { name: "trace-database-test" }, spans }],
    },
  ],
});

const testRunTraceDatabaseTestLayer = testRunTraceDatabaseLayerWithoutDependencies.pipe(
  Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
);

it.effect("stores idempotent spans and reconstructs traces independently", () =>
  Effect.gen(function* () {
    const database = yield* TestRunTraceDatabase;
    const firstTraceId = TestTraceId.make("0123456789abcdef0123456789abcdef");
    const secondTraceId = TestTraceId.make("fedcba9876543210fedcba9876543210");
    const unknownTraceId = TestTraceId.make("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const firstRootSpanId = TestSpanId.make("0123456789abcdef");
    const firstChildSpanId = TestSpanId.make("1111111111111111");

    yield* database.ingestOtlpTraces(
      makeOtlpTraceData([
        makeOtlpSpan(firstTraceId, firstRootSpanId, undefined, "first root"),
        makeOtlpSpan(firstTraceId, firstChildSpanId, firstRootSpanId, "first child"),
        makeOtlpSpan(secondTraceId, TestSpanId.make("2222222222222222"), undefined, "second root"),
      ]),
    );
    yield* database.ingestOtlpTraces(
      makeOtlpTraceData([
        makeOtlpSpan(firstTraceId, firstChildSpanId, firstRootSpanId, "updated first child"),
      ]),
    );

    const firstTrace = Option.getOrThrow(yield* database.findTestTrace(firstTraceId));
    const firstTraceSpans = firstTrace.resourceSpans.flatMap((resourceSpan) =>
      resourceSpan.scopeSpans.flatMap((scopeSpan) => scopeSpan.spans),
    );
    const secondTrace = Option.getOrThrow(yield* database.findTestTrace(secondTraceId));
    const secondTraceSpans = secondTrace.resourceSpans.flatMap((resourceSpan) =>
      resourceSpan.scopeSpans.flatMap((scopeSpan) => scopeSpan.spans),
    );

    assert.strictEqual(firstTraceSpans.length, 2);
    assert.deepStrictEqual(firstTraceSpans.map((span) => span.name).sort(), [
      "first root",
      "updated first child",
    ]);
    assert.strictEqual(secondTraceSpans.length, 1);
    assert.strictEqual(secondTraceSpans[0]?.name, "second root");
    assert.isTrue(Option.isNone(yield* database.findTestTrace(unknownTraceId)));
  }).pipe(Effect.provide(testRunTraceDatabaseTestLayer)),
);
