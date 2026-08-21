import { Effect, Schema } from "effect";
import type { OtlpResource, OtlpTracer } from "effect/unstable/observability";

const OtlpAnyValue: Schema.Codec<OtlpResource.AnyValue> = Schema.suspend(() =>
  Schema.Struct({
    stringValue: Schema.optionalKey(Schema.NullOr(Schema.String)),
    boolValue: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    intValue: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
    doubleValue: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    arrayValue: Schema.optionalKey(
      Schema.Struct({ values: Schema.mutable(Schema.Array(OtlpAnyValue)) }),
    ),
    kvlistValue: Schema.optionalKey(
      Schema.Struct({
        values: Schema.mutable(
          Schema.Array(Schema.Struct({ key: Schema.String, value: OtlpAnyValue })),
        ),
      }),
    ),
    bytesValue: Schema.optionalKey(Schema.Uint8Array),
  }),
);

const OtlpKeyValue = Schema.Struct({
  key: Schema.String,
  value: OtlpAnyValue,
});

const OtlpEvent = Schema.Struct({
  attributes: Schema.mutable(Schema.Array(OtlpKeyValue)),
  name: Schema.String,
  timeUnixNano: Schema.String,
  droppedAttributesCount: Schema.Number,
});

const OtlpLink = Schema.Struct({
  attributes: Schema.mutable(Schema.Array(OtlpKeyValue)),
  spanId: Schema.String,
  traceId: Schema.String,
  droppedAttributesCount: Schema.Number,
});

const OtlpStatus = Schema.Struct({
  code: Schema.Literals([0, 1, 2]),
  message: Schema.optionalKey(Schema.String),
});

const OtlpSpan = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.UndefinedOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(undefined), { encodingStrategy: "omit" }),
  ),
  name: Schema.String,
  kind: Schema.Number,
  startTimeUnixNano: Schema.String,
  endTimeUnixNano: Schema.String,
  attributes: Schema.mutable(Schema.Array(OtlpKeyValue)),
  droppedAttributesCount: Schema.Number,
  events: Schema.mutable(Schema.Array(OtlpEvent)),
  droppedEventsCount: Schema.Number,
  status: OtlpStatus,
  links: Schema.mutable(Schema.Array(OtlpLink)),
  droppedLinksCount: Schema.Number,
});

const OtlpScopeSpan = Schema.Struct({
  scope: Schema.Struct({ name: Schema.String }),
  spans: Schema.mutable(Schema.Array(OtlpSpan)),
  schemaUrl: Schema.optional(Schema.String),
});

const OtlpResourceSpan = Schema.Struct({
  resource: Schema.Struct({
    attributes: Schema.mutable(Schema.Array(OtlpKeyValue)),
    droppedAttributesCount: Schema.Number,
  }),
  scopeSpans: Schema.mutable(Schema.Array(OtlpScopeSpan)),
  schemaUrl: Schema.optional(Schema.String),
});

/** Runtime parser for the OTLP JSON trace representation emitted by Effect. */
export const OtlpTraceData = Schema.Struct({
  resourceSpans: Schema.mutable(Schema.Array(OtlpResourceSpan)),
}) satisfies Schema.Schema<OtlpTracer.TraceData>;

/** Parse an untrusted OTLP JSON value into Effect's trace data model. */
export const parseOtlpTraceData = Schema.decodeUnknownEffect(OtlpTraceData);
