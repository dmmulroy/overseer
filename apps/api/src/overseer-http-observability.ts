import { Effect } from "effect";
import {
  type OverseerTraceRuntimeComponent,
  withOverseerTraceRuntimeComponent,
} from "./overseer-trace-runtime-component.ts";

/** Applies the hosted Overseer runtime component identity to one HTTP request Effect. */
export const withOverseerHttpObservability = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  component: OverseerTraceRuntimeComponent,
): Effect.Effect<A, E, R> => withOverseerTraceRuntimeComponent(effect, component);
