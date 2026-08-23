import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { parseOtlpTraceData } from "./otlp-trace-data.ts";
import { sanitizeOverseerOtlpHttpTraceData } from "./overseer-http-trace-policy.ts";

it.effect("retains only approved HTTP metadata in persisted Overseer spans", () =>
  Effect.gen(function* () {
    const traceData = yield* parseOtlpTraceData({
      resourceSpans: [
        {
          resource: { attributes: [], droppedAttributesCount: 0 },
          scopeSpans: [
            {
              scope: { name: "http" },
              spans: [
                {
                  traceId: "0123456789abcdef0123456789abcdef",
                  spanId: "0123456789abcdef",
                  name: "http.server POST",
                  kind: 2,
                  startTimeUnixNano: "1000000",
                  endTimeUnixNano: "2000000",
                  attributes: [
                    {
                      key: "url.full",
                      value: {
                        stringValue:
                          "https://api.overseer.mulroy.ai/workspaces/workspace_123?email=private@example.com",
                      },
                    },
                    { key: "url.query", value: { stringValue: "email=private@example.com" } },
                    { key: "client.address", value: { stringValue: "192.0.2.1" } },
                    { key: "user_agent.original", value: { stringValue: "private-agent" } },
                    {
                      key: "http.request.header.content-type",
                      value: { stringValue: "application/json" },
                    },
                    {
                      key: "http.request.header.cf-access-authenticated-user-email",
                      value: { stringValue: "operator@example.com" },
                    },
                    {
                      key: "http.request.header.cf-connecting-ip",
                      value: { stringValue: "192.0.2.1" },
                    },
                    {
                      key: "http.response.header.x-overseer-request-id",
                      value: { stringValue: "request_123" },
                    },
                    {
                      key: "http.response.header.set-cookie",
                      value: { stringValue: "session=secret" },
                    },
                    { key: "http.response.status_code", value: { intValue: 201 } },
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

    const sanitized = sanitizeOverseerOtlpHttpTraceData(traceData);
    const attributes = sanitized.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.attributes ?? [];

    assert.deepStrictEqual(
      attributes.map((attribute) => attribute.key),
      [
        "url.full",
        "http.request.header.content-type",
        "http.request.header.cf-access-authenticated-user-email",
        "http.response.header.x-overseer-request-id",
        "http.response.status_code",
      ],
    );
    assert.strictEqual(
      attributes[0]?.value.stringValue,
      "https://api.overseer.mulroy.ai/workspaces/workspace_123",
    );
  }),
);
