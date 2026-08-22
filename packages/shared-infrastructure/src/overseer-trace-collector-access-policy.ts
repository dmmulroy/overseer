import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { OVERSEER_TRACE_COLLECTOR_ACCESS_POLICY_LOGICAL_ID } from "./overseer-shared-infrastructure-identifiers.ts";
import { OverseerTraceCollectorServiceTokenResource } from "./overseer-trace-collector-service-token.ts";

/** Creates the reusable Cloudflare Access policy that admits only the Overseer service token. */
export const OverseerTraceCollectorAccessPolicyResource = Effect.gen(function* () {
  const serviceToken = yield* OverseerTraceCollectorServiceTokenResource;

  return yield* Cloudflare.Access.Policy(OVERSEER_TRACE_COLLECTOR_ACCESS_POLICY_LOGICAL_ID, {
    decision: "non_identity",
    include: [{ serviceToken: { tokenId: serviceToken.serviceTokenId } }],
    name: "Overseer trace collector service access",
  });
});
