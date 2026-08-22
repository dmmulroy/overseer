import * as Cloudflare from "alchemy/Cloudflare";

import { OVERSEER_TRACE_COLLECTOR_SERVICE_TOKEN_LOGICAL_ID } from "./overseer-shared-infrastructure-identifiers.ts";

/** Creates the service token used by Overseer runtimes to send telemetry to the trace collector. */
export const OverseerTraceCollectorServiceTokenResource = Cloudflare.Access.ServiceToken(
  OVERSEER_TRACE_COLLECTOR_SERVICE_TOKEN_LOGICAL_ID,
  {
    duration: "2160h",
    name: "Overseer trace collector",
  },
);
