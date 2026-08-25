import { Effect } from "effect";
import { overseerHttpSpanNameLayer } from "./overseer-http-span-names.ts";
import {
  type OverseerTraceRuntimeComponent,
  withOverseerTraceRuntimeComponent,
} from "./overseer-trace-runtime-component.ts";

/** Applies the hosted runtime component and normalized HTTP span names to one request Effect. */
export const withOverseerHttpObservability = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  component: OverseerTraceRuntimeComponent,
): Effect.Effect<A, E, R> =>
  withOverseerTraceRuntimeComponent(effect, component).pipe(
    Effect.provide(overseerHttpSpanNameLayer),
  );
