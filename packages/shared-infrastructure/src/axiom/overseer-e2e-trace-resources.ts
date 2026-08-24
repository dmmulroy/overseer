import * as Axiom from "alchemy/Axiom";

import {
  OVERSEER_E2E_TRACE_DATASET_NAME,
  OVERSEER_E2E_TRACE_INGEST_TOKEN_LOGICAL_ID,
  OVERSEER_E2E_TRACE_QUERY_TOKEN_LOGICAL_ID,
  OVERSEER_E2E_TRACES_DATASET_LOGICAL_ID,
} from "./overseer-axiom-identifiers.ts";

/** Persistent Axiom dataset that stores distributed Overseer E2E traces. */
export const OverseerE2eTracesDatasetResource = Axiom.Dataset(
  OVERSEER_E2E_TRACES_DATASET_LOGICAL_ID,
  {
    name: OVERSEER_E2E_TRACE_DATASET_NAME,
    kind: "otel:traces:v1",
    description: "Distributed traces retained as Overseer E2E execution evidence",
    retentionDays: 30,
    useRetentionPeriod: true,
  },
);

/** Least-privilege Axiom token that can only ingest Overseer E2E traces. */
export const OverseerE2eTraceIngestTokenResource = Axiom.ApiToken(
  OVERSEER_E2E_TRACE_INGEST_TOKEN_LOGICAL_ID,
  {
    name: "overseer-e2e-trace-ingest",
    description: "OTLP trace ingestion for Overseer E2E runtimes",
    datasetCapabilities: {
      [OVERSEER_E2E_TRACE_DATASET_NAME]: { ingest: ["create"] },
    },
  },
);

/** Least-privilege Axiom token that can only query retained Overseer E2E traces. */
export const OverseerE2eTraceQueryTokenResource = Axiom.ApiToken(
  OVERSEER_E2E_TRACE_QUERY_TOKEN_LOGICAL_ID,
  {
    name: "overseer-e2e-trace-query",
    description: "Trace queries for Overseer E2E acceptance and inspection",
    datasetCapabilities: {
      [OVERSEER_E2E_TRACE_DATASET_NAME]: { query: ["read"] },
    },
  },
);
