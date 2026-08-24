import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import type { EncodedOverseerEvent } from "./overseer-event.ts";
import { encodeOverseerEvent, parseOverseerEvent } from "./overseer-event.ts";

const encodedWorkspaceRenameEvent = {
  envelopeVersion: 1,
  eventId: "event_01KZGWRATYFXD8QCG7QTKG5C3S",
  source: "overseer.workspace-durable-object",
  type: "workspace.rename.v1",
  timestamp: 1_787_562_456_123,
  actor: {
    kind: "agent",
    agentId: "agent-codex-01",
  },
  metadata: {
    origin: {
      kind: "http",
      requestId: "request_01KZGWMQ4054AXZGW9RR1VJ3JM",
    },
  },
  payload: {
    workspace: {
      workspaceId: "workspace_01KZGWRATYFXD8QCG7QTKG5C3S",
      name: "Platform Engineering",
      state: "active",
      createdAt: "2026-08-24T12:00:00.000Z",
      updatedAt: "2026-08-24T12:27:36.123Z",
      entityVersion: 4,
    },
    previousName: "Product Engineering",
  },
} satisfies EncodedOverseerEvent;

it.effect("round trips a versioned event with Unix-millisecond source time", () =>
  Effect.gen(function* () {
    const parsed = yield* parseOverseerEvent(encodedWorkspaceRenameEvent);
    const encoded = yield* encodeOverseerEvent(parsed);

    assert.deepStrictEqual(encoded, encodedWorkspaceRenameEvent);
  }),
);

it.effect("rejects a payload that disagrees with the versioned event type", () =>
  Effect.gen(function* () {
    yield* parseOverseerEvent({
      ...encodedWorkspaceRenameEvent,
      payload: {
        project: {
          projectId: "project_01KZGWRATYFXD8QCG7QTKG5C3S",
          workspaceId: "workspace_01KZGWRATYFXD8QCG7QTKG5C3S",
          name: "Event ingestion",
          state: "active",
          createdAt: "2026-08-24T12:00:00.000Z",
          updatedAt: "2026-08-24T12:27:36.123Z",
          entityVersion: 1,
        },
      },
    }).pipe(Effect.flip);
  }),
);
