import * as Cloudflare from "alchemy/Cloudflare";

import {
  OVERSEER_EMAIL_ALLOWLIST_ACCESS_POLICY_LOGICAL_ID,
  OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME,
} from "./overseer-shared-infrastructure-identifiers.ts";

/** References the production Cloudflare Access email allowlist without transferring ownership. */
export const OverseerEmailAllowlistAccessPolicyReference = Cloudflare.Access.Policy.ref(
  OVERSEER_EMAIL_ALLOWLIST_ACCESS_POLICY_LOGICAL_ID,
  {
    stack: OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME,
    stage: OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  },
);
