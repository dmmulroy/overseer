import * as Axiom from "alchemy/Axiom";

import {
  OVERSEER_PRODUCTION_TRACE_DATASET_NAME,
  OVERSEER_PRODUCTION_TRACE_INGEST_TOKEN_LOGICAL_ID,
  OVERSEER_PRODUCTION_TRACE_QUERY_TOKEN_LOGICAL_ID,
  OVERSEER_PRODUCTION_TRACES_DATASET_LOGICAL_ID,
} from "./overseer-axiom-identifiers.ts";

/** Persistent Axiom dataset that stores distributed Overseer production traces. */
export const OverseerProductionTracesDatasetResource = Axiom.Dataset(
  OVERSEER_PRODUCTION_TRACES_DATASET_LOGICAL_ID,
  {
    name: OVERSEER_PRODUCTION_TRACE_DATASET_NAME,
    kind: "otel:traces:v1",
    description: "Distributed traces retained for the Overseer production API",
    retentionDays: 30,
    useRetentionPeriod: true,
  },
);

/** Least-privilege Axiom token that can only ingest Overseer production traces. */
export const OverseerProductionTraceIngestTokenResource = Axiom.ApiToken(
  OVERSEER_PRODUCTION_TRACE_INGEST_TOKEN_LOGICAL_ID,
  {
    name: "overseer-production-trace-ingest",
    description: "OTLP trace ingestion for the Overseer production API",
    datasetCapabilities: {
      [OVERSEER_PRODUCTION_TRACE_DATASET_NAME]: { ingest: ["create"] },
    },
  },
);

/** Least-privilege Axiom token that can only query retained Overseer production traces. */
export const OverseerProductionTraceQueryTokenResource = Axiom.ApiToken(
  OVERSEER_PRODUCTION_TRACE_QUERY_TOKEN_LOGICAL_ID,
  {
    name: "overseer-production-trace-query",
    description: "Trace queries for Overseer production diagnostics",
    datasetCapabilities: {
      [OVERSEER_PRODUCTION_TRACE_DATASET_NAME]: { query: ["read"] },
    },
  },
);
