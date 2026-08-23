import { SqliteMigrator } from "@effect/sql-sqlite-do";
import {
  OtlpTraceData,
  type OtlpTraceData as OtlpTraceDataValue,
  type TestTraceId,
} from "@overseer/test-trace-protocol";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlError } from "effect/unstable/sql";

/** Test-run trace persistence operations reported by the Durable Object database. */
export const TestRunTraceDatabaseOperation = Schema.Literals(["ingestOtlpTraces", "findTestTrace"]);

/** Name of one failed test-run trace persistence operation. */
export type TestRunTraceDatabaseOperation = typeof TestRunTraceDatabaseOperation.Type;

/** Expected failure to persist or reconstruct collected test trace data. */
export class TestRunTraceDatabaseError extends Schema.TaggedError<TestRunTraceDatabaseError>()(
  "TestRunTraceDatabaseError",
  {
    operation: TestRunTraceDatabaseOperation,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** Persistence operations owned by one test-run trace Durable Object. */
export interface ITestRunTraceDatabase {
  /** Idempotently persist every span contained in one parsed OTLP trace export. */
  readonly ingestOtlpTraces: (
    traceData: OtlpTraceDataValue,
  ) => Effect.Effect<void, TestRunTraceDatabaseError>;
  /** Reconstruct the currently retained OTLP snapshot when its trace is known. */
  readonly findTestTrace: (
    traceId: TestTraceId,
  ) => Effect.Effect<Option.Option<OtlpTraceDataValue>, TestRunTraceDatabaseError>;
}

/** Provides test-run trace persistence without exposing Durable Object storage. */
export class TestRunTraceDatabase extends Context.Service<
  TestRunTraceDatabase,
  ITestRunTraceDatabase
>()("@overseer/TestRunTraceDatabase") {}

const StoredTraceSpanRow = Schema.Struct({ trace_data_json: Schema.String });
type EncodedStoredTraceSpanRow = typeof StoredTraceSpanRow.Encoded;
const parseStoredTraceSpanRows = Schema.decodeUnknownEffect(Schema.Array(StoredTraceSpanRow));
const StoredTraceDataJson = Schema.fromJsonString(OtlpTraceData);
const parseStoredTraceDataJson = Schema.decodeUnknownEffect(StoredTraceDataJson);
const encodeStoredTraceDataJson = Schema.encodeEffect(StoredTraceDataJson);

const initialTestRunTraceMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE test_trace_spans (
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      trace_data_json TEXT NOT NULL,
      PRIMARY KEY (trace_id, span_id)
    )
  `;
});

const testRunTraceMigrationLoader = SqliteMigrator.fromRecord({
  "1_create_test_trace_spans": initialTestRunTraceMigration,
});

const testRunTraceDatabaseError =
  (operation: TestRunTraceDatabaseOperation) =>
  (cause: unknown): TestRunTraceDatabaseError =>
    new TestRunTraceDatabaseError({
      operation,
      message: `Test-run trace database failed during ${operation}`,
      cause,
    });

type OtlpResourceSpanValue = OtlpTraceDataValue["resourceSpans"][number];
type OtlpScopeSpanValue = OtlpResourceSpanValue["scopeSpans"][number];
type OtlpSpanValue = OtlpScopeSpanValue["spans"][number];

const singleSpanTraceData = (
  resourceSpan: OtlpResourceSpanValue,
  scopeSpan: OtlpScopeSpanValue,
  span: OtlpSpanValue,
): OtlpTraceDataValue => ({
  resourceSpans: [
    {
      resource: resourceSpan.resource,
      scopeSpans: [
        {
          scope: scopeSpan.scope,
          spans: [span],
          schemaUrl: scopeSpan.schemaUrl,
        },
      ],
      schemaUrl: resourceSpan.schemaUrl,
    },
  ],
});

/** Constructs Durable Object SQLite persistence after bundled migrations complete. */
export const makeTestRunTraceDatabase: Effect.Effect<
  TestRunTraceDatabase["Service"],
  SqliteMigrator.MigrationError | SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  yield* SqliteMigrator.run({
    loader: testRunTraceMigrationLoader,
    table: "schema_migrations",
  });
  const sql = yield* SqlClient.SqlClient;

  const ingestOtlpTraces = Effect.fn("TestRunTraceDatabase.ingestOtlpTraces")(
    function* (traceData: OtlpTraceDataValue) {
      const writes = [];
      for (const resourceSpan of traceData.resourceSpans) {
        for (const scopeSpan of resourceSpan.scopeSpans) {
          for (const span of scopeSpan.spans) {
            writes.push({
              traceId: span.traceId,
              spanId: span.spanId,
              traceDataJson: yield* encodeStoredTraceDataJson(
                singleSpanTraceData(resourceSpan, scopeSpan, span),
              ),
            });
          }
        }
      }

      yield* sql.withTransaction(
        Effect.forEach(
          writes,
          ({ spanId, traceDataJson, traceId }) =>
            sql`
              INSERT INTO test_trace_spans (trace_id, span_id, trace_data_json)
              VALUES (${traceId}, ${spanId}, ${traceDataJson})
              ON CONFLICT (trace_id, span_id) DO UPDATE SET
                trace_data_json = excluded.trace_data_json
            `,
          { discard: true },
        ),
      );
    },
    Effect.catchTags({
      SchemaError: (cause) => Effect.fail(testRunTraceDatabaseError("ingestOtlpTraces")(cause)),
      SqlError: (cause) => Effect.fail(testRunTraceDatabaseError("ingestOtlpTraces")(cause)),
    }),
  );

  const findTestTrace = Effect.fn("TestRunTraceDatabase.findTestTrace")(
    function* (traceId: TestTraceId) {
      const rows = yield* sql<EncodedStoredTraceSpanRow>`
        SELECT trace_data_json
        FROM test_trace_spans
        WHERE trace_id = ${traceId}
        ORDER BY span_id
      `;
      const storedRows = yield* parseStoredTraceSpanRows(rows);
      if (storedRows.length === 0) return Option.none<OtlpTraceDataValue>();

      const traceData = yield* Effect.forEach(storedRows, (row) =>
        parseStoredTraceDataJson(row.trace_data_json),
      );
      return Option.some<OtlpTraceDataValue>({
        resourceSpans: traceData.flatMap((entry) => entry.resourceSpans),
      });
    },
    Effect.catchTags({
      SchemaError: (cause) => Effect.fail(testRunTraceDatabaseError("findTestTrace")(cause)),
      SqlError: (cause) => Effect.fail(testRunTraceDatabaseError("findTestTrace")(cause)),
    }),
  );

  return TestRunTraceDatabase.of({ ingestOtlpTraces, findTestTrace });
});

/** Provides test-run trace persistence while preserving its SQL requirement. */
export const testRunTraceDatabaseLayerWithoutDependencies = Layer.effect(
  TestRunTraceDatabase,
  makeTestRunTraceDatabase,
);
