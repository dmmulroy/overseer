import { Effect, Schema } from "effect";

/** Runtime components hosted by the single deployed Overseer API Worker service. */
export const OverseerTraceRuntimeComponent = Schema.Literals([
  "api-worker",
  "workspace-durable-object",
]);

/** Parsed runtime component attached to every span created while handling one event. */
export type OverseerTraceRuntimeComponent = typeof OverseerTraceRuntimeComponent.Type;

/** Annotate every span created by an Overseer runtime component without changing service identity. */
export const withOverseerTraceRuntimeComponent = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  component: OverseerTraceRuntimeComponent,
): Effect.Effect<A, E, R> =>
  effect.pipe(Effect.annotateSpans("overseer.runtime.component", component));
