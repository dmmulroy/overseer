/** Identifies the Alchemy Stack that exclusively owns Overseer shared Cloudflare resources. */
export const OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME = "OverseerSharedInfrastructure";

/** Identifies the production stage containing account-wide Overseer shared infrastructure. */
export const OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE = "production";

/** Identifies the shared Cloudflare Queue that carries encoded Overseer events. */
export const OVERSEER_EVENT_QUEUE_LOGICAL_ID = "EventQueue";

/** Identifies the reusable Cloudflare Access policy for the configured email address. */
export const OVERSEER_EMAIL_ALLOWLIST_ACCESS_POLICY_LOGICAL_ID =
  "OverseerEmailAllowlistAccessPolicy";
