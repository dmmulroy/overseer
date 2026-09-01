import * as Alchemy from "alchemy";
import type { Redacted } from "effect";

import { OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME } from "./overseer-shared-infrastructure-identifiers.ts";

/** Provides typed outputs from the independently deployed Overseer shared infrastructure Stack. */
export class OverseerSharedInfrastructureStack extends Alchemy.Stack<
  OverseerSharedInfrastructureStack,
  {
    /** Axiom API root used by the E2E harness to query retained traces. */
    readonly axiomE2eTraceApiBaseUrl: string;
    /** Stable Axiom dataset receiving traces from every E2E runtime. */
    readonly axiomE2eTraceDatasetName: string;
    /** Redacted bearer token restricted to trace ingestion for E2E runtimes. */
    readonly axiomE2eTraceIngestToken: Redacted.Redacted<string>;
    /** Signal-specific Axiom OTLP HTTP endpoint receiving E2E traces. */
    readonly axiomE2eTraceOtlpEndpoint: string;
    /** Redacted bearer token restricted to E2E trace queries. */
    readonly axiomE2eTraceQueryToken: Redacted.Redacted<string>;
    /** Axiom API root used by production diagnostics to query retained traces. */
    readonly axiomProductionTraceApiBaseUrl: string;
    /** Stable Axiom dataset receiving traces from the production API runtime. */
    readonly axiomProductionTraceDatasetName: string;
    /** Redacted bearer token restricted to production trace ingestion. */
    readonly axiomProductionTraceIngestToken: Redacted.Redacted<string>;
    /** Signal-specific Axiom OTLP HTTP endpoint receiving production traces. */
    readonly axiomProductionTraceOtlpEndpoint: string;
    /** Redacted bearer token restricted to production trace queries. */
    readonly axiomProductionTraceQueryToken: Redacted.Redacted<string>;
    /** Policy owned by this Stack and referenced by independently deployed Access applications. */
    readonly emailAllowlistAccessPolicyId: string;
    /** Existing account-level identity provider observed without lifecycle ownership. */
    readonly emailOneTimePinIdentityProviderId: string;
    /** Retained R2 bucket storing raw events and curated entity projections. */
    readonly eventDataBucketName: string;
    /** Iceberg REST catalog endpoint for the Overseer event data lake. */
    readonly eventDataCatalogUri: string;
    /** Cloudflare-generated R2 Data Catalog warehouse queried by analytics clients. */
    readonly eventDataWarehouseName: string;
    /** Stable Cloudflare identity of the shared Overseer event queue. */
    readonly eventQueueId: string;
    /** Physical Cloudflare name of the shared Overseer event queue. */
    readonly eventQueueName: string;
    /** Cloudflare Pipelines stream receiving encoded Overseer events. */
    readonly eventStreamId: string;
  }
>()(OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME) {}
