import { OverseerEventQueueReference } from "@overseer/shared-infrastructure";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";
import { OverseerEventPublisher, PublishOverseerEventError } from "./event-publisher.ts";
import { serializeOverseerEvent } from "./overseer-event.ts";

/** Publishes Overseer events through the shared Cloudflare EventQueue binding. */
export const cloudflareEventQueuePublisherLayer = Layer.effect(
  OverseerEventPublisher,
  Effect.gen(function* () {
    const eventQueue = yield* OverseerEventQueueReference;
    const queueWriter = yield* Cloudflare.Queues.WriteQueue(eventQueue);

    return OverseerEventPublisher.of({
      publishOverseerEvent: Effect.fn("OverseerEventPublisher.publishOverseerEvent")(function* (
        event,
      ) {
        const serializedEvent = yield* serializeOverseerEvent(event).pipe(Effect.orDie);

        yield* queueWriter.send(serializedEvent, { contentType: "text" }).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.catchTag(
            "SendError",
            () =>
              new PublishOverseerEventError({
                eventId: event.eventId,
                reason: "ingestion_unavailable",
                serializedEvent,
              }),
          ),
        );
      }, Effect.withSpan("OverseerEventPublisher.publishOverseerEvent")),
    });
  }),
);
