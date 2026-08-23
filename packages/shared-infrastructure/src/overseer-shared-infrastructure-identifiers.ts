/** Identifies the Alchemy Stack that exclusively owns Overseer shared Cloudflare resources. */
export const OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME = "OverseerSharedInfrastructure";

/** Identifies the production stage containing account-wide Overseer shared infrastructure. */
export const OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE = "production";

/** Identifies the reusable Cloudflare Access policy for the configured email address. */
export const OVERSEER_EMAIL_ALLOWLIST_ACCESS_POLICY_LOGICAL_ID =
  "OverseerEmailAllowlistAccessPolicy";

/** Production hostname of the Access-protected test trace collector shared by E2E targets. */
export const OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN = "ttc.mulroy.cloud";

/** Identifies the service token used by Overseer runtimes to authenticate to the trace collector. */
export const OVERSEER_TRACE_COLLECTOR_SERVICE_TOKEN_LOGICAL_ID =
  "OverseerTraceCollectorServiceToken";

/** Identifies the reusable service-token policy protecting Production and Preview collectors. */
export const OVERSEER_TRACE_COLLECTOR_ACCESS_POLICY_LOGICAL_ID =
  "OverseerTraceCollectorAccessPolicy";
