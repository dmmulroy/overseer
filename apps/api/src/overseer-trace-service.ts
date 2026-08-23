import { Context, Effect, Option, Schema, Tracer } from "effect";

/** Logical Overseer runtime services identified in distributed test traces. */
export const OverseerTraceServiceName = Schema.Literals([
  "overseer-api-worker",
  "overseer-workspace-durable-object",
  "overseer-bookkeeper-durable-object",
]);

/** Parsed logical service name attached to one Overseer HTTP server span. */
export type OverseerTraceServiceName = typeof OverseerTraceServiceName.Type;

/** Attach a logical service name to the current Overseer HTTP server span. */
export const withOverseerTraceServiceName = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  serviceName: OverseerTraceServiceName,
): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => {
    const parentSpan = Context.getOption(fiber.context, Tracer.ParentSpan);
    if (Option.isSome(parentSpan) && parentSpan.value._tag === "Span") {
      parentSpan.value.attribute("service.name", serviceName);
    }
    return effect;
  });
