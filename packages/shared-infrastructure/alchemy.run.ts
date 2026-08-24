import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";

import {
  OverseerE2eTraceIngestTokenResource,
  OverseerE2eTraceQueryTokenResource,
  OverseerE2eTracesDatasetResource,
} from "./src/axiom/overseer-e2e-trace-resources.ts";
import { OverseerEmailAllowlistAccessPolicyResource } from "./src/overseer-email-allowlist-access-policy.ts";
import { OverseerEmailOneTimePinIdentityProviderLookup } from "./src/overseer-email-one-time-pin-identity-provider-lookup.ts";
import {
  OverseerProductionTraceIngestTokenResource,
  OverseerProductionTraceQueryTokenResource,
  OverseerProductionTracesDatasetResource,
} from "./src/axiom/overseer-production-trace-resources.ts";
import { OverseerSharedInfrastructureStack } from "./src/overseer-shared-infrastructure-stack.ts";

/** Deploys account-wide Cloudflare resources shared across independently managed Overseer apps. */
export default OverseerSharedInfrastructureStack.make(
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Axiom.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const axiomE2eTracesDataset = yield* OverseerE2eTracesDatasetResource;
    const axiomE2eTraceIngestToken = yield* OverseerE2eTraceIngestTokenResource;
    const axiomE2eTraceQueryToken = yield* OverseerE2eTraceQueryTokenResource;
    const axiomProductionTracesDataset = yield* OverseerProductionTracesDatasetResource;
    const axiomProductionTraceIngestToken = yield* OverseerProductionTraceIngestTokenResource;
    const axiomProductionTraceQueryToken = yield* OverseerProductionTraceQueryTokenResource;
    const emailAllowlistAccessPolicy = yield* OverseerEmailAllowlistAccessPolicyResource;

    return {
      axiomE2eTraceApiBaseUrl: axiomE2eTracesDataset.apiBaseUrl,
      axiomE2eTraceDatasetName: axiomE2eTracesDataset.name,
      axiomE2eTraceIngestToken: axiomE2eTraceIngestToken.token,
      axiomE2eTraceOtlpEndpoint: axiomE2eTracesDataset.otelTracesEndpoint,
      axiomE2eTraceQueryToken: axiomE2eTraceQueryToken.token,
      axiomProductionTraceApiBaseUrl: axiomProductionTracesDataset.apiBaseUrl,
      axiomProductionTraceDatasetName: axiomProductionTracesDataset.name,
      axiomProductionTraceIngestToken: axiomProductionTraceIngestToken.token,
      axiomProductionTraceOtlpEndpoint: axiomProductionTracesDataset.otelTracesEndpoint,
      axiomProductionTraceQueryToken: axiomProductionTraceQueryToken.token,
      emailAllowlistAccessPolicyId: emailAllowlistAccessPolicy.policyId,
      emailOneTimePinIdentityProviderId:
        OverseerEmailOneTimePinIdentityProviderLookup.identityProviderId.as<string>(),
    };
  }),
);
