import { Effect } from "effect";
import { overseerHttpHeaderPolicyLayer } from "./overseer-http-header-policy.ts";
import {
  type OverseerTraceServiceName,
  withOverseerTraceServiceName,
} from "./overseer-trace-service.ts";

/** Apply Overseer header disclosure and logical service identity to one HTTP request Effect. */
export const withOverseerHttpObservability = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  serviceName: OverseerTraceServiceName,
): Effect.Effect<A, E, R> =>
  withOverseerTraceServiceName(
    effect.pipe(Effect.provide(overseerHttpHeaderPolicyLayer)),
    serviceName,
  );
