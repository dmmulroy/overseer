import * as Cloudflare from "alchemy/Cloudflare";

import {
  OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME,
  OVERSEER_TRACE_COLLECTOR_ACCESS_POLICY_LOGICAL_ID,
} from "./overseer-shared-infrastructure-identifiers.ts";

/** References the shared collector service-token policy without transferring ownership. */
export const OverseerTraceCollectorAccessPolicyReference = Cloudflare.Access.Policy.ref(
  OVERSEER_TRACE_COLLECTOR_ACCESS_POLICY_LOGICAL_ID,
  {
    stack: OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME,
    stage: OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  },
);
