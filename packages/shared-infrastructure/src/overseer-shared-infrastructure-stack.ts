import * as Alchemy from "alchemy";
import type { Redacted } from "effect";

import { OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME } from "./overseer-shared-infrastructure-identifiers.ts";

/** Provides typed outputs from the independently deployed Overseer shared infrastructure Stack. */
export class OverseerSharedInfrastructureStack extends Alchemy.Stack<
  OverseerSharedInfrastructureStack,
  {
    /** Policy owned by this Stack and referenced by independently deployed Access applications. */
    readonly emailAllowlistAccessPolicyId: string;
    /** Existing account-level identity provider observed without lifecycle ownership. */
    readonly emailOneTimePinIdentityProviderId: string;
    /** Service-token policy referenced by Production and Preview collector Access applications. */
    readonly traceCollectorAccessPolicyId: string;
    /** Client ID sent by Overseer runtimes to the Access-protected trace collector. */
    readonly traceCollectorAccessClientId: string;
    /** Optional redacted service-token secret retained for authenticated trace exports. */
    readonly traceCollectorAccessClientSecret: Redacted.Redacted<string> | undefined;
  }
>()(OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME) {}
