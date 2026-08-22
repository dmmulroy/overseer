import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { OverseerEmailAllowlistAccessPolicyResource } from "./src/overseer-email-allowlist-access-policy.ts";
import { OverseerEmailOneTimePinIdentityProviderLookup } from "./src/overseer-email-one-time-pin-identity-provider-lookup.ts";
import { OverseerSharedInfrastructureStack } from "./src/overseer-shared-infrastructure-stack.ts";
import { OverseerTraceCollectorAccessPolicyResource } from "./src/overseer-trace-collector-access-policy.ts";
import { OverseerTraceCollectorServiceTokenResource } from "./src/overseer-trace-collector-service-token.ts";

/** Deploys account-wide Cloudflare resources shared across independently managed Overseer apps. */
export default OverseerSharedInfrastructureStack.make(
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const emailAllowlistAccessPolicy = yield* OverseerEmailAllowlistAccessPolicyResource;
    const traceCollectorAccessPolicy = yield* OverseerTraceCollectorAccessPolicyResource;
    const traceCollectorServiceToken = yield* OverseerTraceCollectorServiceTokenResource;

    return {
      emailAllowlistAccessPolicyId: emailAllowlistAccessPolicy.policyId,
      emailOneTimePinIdentityProviderId:
        OverseerEmailOneTimePinIdentityProviderLookup.identityProviderId.as<string>(),
      traceCollectorAccessClientId: traceCollectorServiceToken.clientId,
      traceCollectorAccessClientSecret: traceCollectorServiceToken.clientSecret,
      traceCollectorAccessPolicyId: traceCollectorAccessPolicy.policyId,
    };
  }),
);
