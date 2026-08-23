import * as Cloudflare from "alchemy/Cloudflare";

import {
  OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME,
  OVERSEER_TRACE_COLLECTOR_SERVICE_TOKEN_LOGICAL_ID,
} from "./overseer-shared-infrastructure-identifiers.ts";

/** References the shared trace collector service token without transferring ownership. */
export const OverseerTraceCollectorServiceTokenReference = Cloudflare.Access.ServiceToken.ref(
  OVERSEER_TRACE_COLLECTOR_SERVICE_TOKEN_LOGICAL_ID,
  {
    stack: OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME,
    stage: OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  },
);
