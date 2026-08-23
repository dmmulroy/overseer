import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  encodeOtlpTraceDataJson,
  parseOtlpTraceData,
  parseOtlpTraceDataJson,
} from "./otlp-trace-data.ts";

it.effect("preserves an OTLP child span parent through JSON persistence", () =>
  Effect.gen(function* () {
    const parsed = yield* parseOtlpTraceData({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "overseer-e2e-harness" } }],
            droppedAttributesCount: 0,
          },
          scopeSpans: [
            {
              scope: { name: "overseer-e2e-harness" },
              spans: [
                {
                  traceId: "0123456789abcdef0123456789abcdef",
                  spanId: "0123456789abcdef",
                  parentSpanId: "fedcba9876543210",
                  name: "overseer.test.execution",
                  kind: 1,
                  startTimeUnixNano: "1000000",
                  endTimeUnixNano: "2000000",
                  attributes: [
                    {
                      key: "overseer.test.tags",
                      value: {
                        arrayValue: {
                          values: [{ stringValue: "local" }, { stringValue: "workspace" }],
                        },
                      },
                    },
                  ],
                  droppedAttributesCount: 0,
                  events: [],
                  droppedEventsCount: 0,
                  status: { code: 1 },
                  links: [],
                  droppedLinksCount: 0,
                },
              ],
            },
          ],
        },
      ],
    });

    assert.deepStrictEqual(
      parsed.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.parentSpanId,
      "fedcba9876543210",
    );
    assert.strictEqual(
      Object.hasOwn(parsed.resourceSpans[0]?.scopeSpans[0]?.spans[0] ?? {}, "parentSpanId"),
      true,
    );
    const json = yield* encodeOtlpTraceDataJson(parsed);
    const restored = yield* parseOtlpTraceDataJson(json);
    assert.deepStrictEqual(restored, parsed);
  }),
);

it.effect("rejects OTLP spans whose trace identity cannot be retrieved", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      parseOtlpTraceData({
        resourceSpans: [
          {
            resource: { attributes: [], droppedAttributesCount: 0 },
            scopeSpans: [
              {
                scope: { name: "invalid-trace-test" },
                spans: [
                  {
                    traceId: "not-a-trace-id",
                    spanId: "0123456789abcdef",
                    name: "invalid trace",
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
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);
