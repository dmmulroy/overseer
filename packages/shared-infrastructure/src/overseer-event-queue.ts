import * as Cloudflare from "alchemy/Cloudflare";

import {
  OVERSEER_EVENT_QUEUE_LOGICAL_ID,
  OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME,
} from "./overseer-shared-infrastructure-identifiers.ts";

/** Creates the shared at-least-once queue that carries encoded Overseer events. */
export const OverseerEventQueueResource = Cloudflare.Queues.Queue(OVERSEER_EVENT_QUEUE_LOGICAL_ID, {
  name: "overseer-event-queue",
});

/** References the production event queue without transferring its lifecycle ownership. */
export const OverseerEventQueueReference = Cloudflare.Queues.Queue.ref(
  OVERSEER_EVENT_QUEUE_LOGICAL_ID,
  {
    stack: OVERSEER_SHARED_INFRASTRUCTURE_STACK_NAME,
    stage: OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  },
);
