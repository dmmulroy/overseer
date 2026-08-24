Below is the revised design with:

- Versioned event names such as `workspace.rename.v1`.
- An independently versioned envelope.
- Request provenance under `metadata`, not in every event or payload.
- Support for HTTP, cron, Durable Object alarm, and internal origins.
- A system actor for non-human operations.
- Full post-transition snapshots in event payloads.

# 1. Event naming and versioning

Use:

```text
<subject>.<action>.v<version>
```

Initial event types:

```text
workspace.create.v1
workspace.rename.v1
workspace.archive.v1
workspace.unarchive.v1
workspace.delete.v1

project.create.v1
project.rename.v1
project.archive.v1
project.unarchive.v1
project.delete.v1
```

The version suffix covers the complete contract for that event variant, including its payload.

If `workspace.rename.v1` later needs an incompatible payload:

```text
workspace.rename.v2
```

Both versions can remain in the union while consumers migrate.

The envelope has its own version because event-type versioning does not cover changes to shared metadata:

```ts
envelopeVersion: 1;
```

# 2. Event semantics

These names represent completed domain facts:

- `workspace.rename.v1` means the name actually changed.
- `workspace.archive.v1` means an active Workspace became archived.
- `workspace.unarchive.v1` means an archived Workspace became active.
- Repeating an idempotent operation without changing state does not emit another event.

Command attempts, failures, and no-ops would be separate operational or telemetry events rather than events.

# 3. Encoded event envelope

```ts
{
  envelopeVersion: 1,
  eventId: "event_...",
  source: "overseer.api",
  type: "workspace.rename.v1",
  timestamp: 1787562456123,
  actor: {
    kind: "agent",
    agentId: "agent-codex-01"
  },
  metadata: {
    origin: {
      kind: "http",
      requestId: "request_..."
    }
  },
  payload: {
    // Versioned, event-specific JSON
  }
}
```

Field meanings:

| Field             | Meaning                                                    |
| ----------------- | ---------------------------------------------------------- |
| `envelopeVersion` | Version of the common event envelope                       |
| `eventId`         | Globally unique event identity                             |
| `source`          | Overseer component that emitted the event                  |
| `type`            | Versioned event and payload discriminator                  |
| `timestamp`       | Source transition time, encoded as Unix epoch milliseconds |
| `actor`           | Human, agent, or system responsible for the operation      |
| `metadata`        | Trigger and transport provenance                           |
| `payload`         | Versioned domain-event data                                |

# 4. Shared envelope schemas

```ts
import { Effect, Schema } from "effect";

import { Actor } from "./actor.ts";
import { ProjectId, ProjectName, ProjectState } from "./project.ts";
import { Ulid } from "./ulid.ts";
import { WorkspaceId, WorkspaceName, WorkspaceState } from "./workspace.ts";
import { OverseerRequestId } from "../request-id.ts";

/** Globally unique identity assigned to one immutable Overseer event. */
export const OverseerEventId = Schema.TemplateLiteral(["event_", Ulid]).pipe(
  Schema.brand("OverseerEventId"),
);

/** Globally unique identity of an immutable Overseer event. */
export type OverseerEventId = typeof OverseerEventId.Type;

/** Version of the common encoded event envelope. */
export const OverseerEventEnvelopeVersion = Schema.Literal(1);

/** Overseer component that originally emitted an event. */
export const OverseerEventSource = Schema.Literals([
  "overseer.api",
  "overseer.workspace-durable-object",
  "overseer.project-durable-object",
]);

/** Known Overseer event producer. */
export type OverseerEventSource = typeof OverseerEventSource.Type;

/** Monotonically increasing version of one entity's event history. */
export const EntityEventVersion = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(
  Schema.brand("EntityEventVersion"),
);

/** Positive event version of one entity. */
export type EntityEventVersion = typeof EntityEventVersion.Type;
```

## Event IDs

Generation follows the existing ULID pattern:

```ts
/** Generate a globally unique Overseer event identity. */
export const generateOverseerEventId: Effect.Effect<OverseerEventId> = generateUlid.pipe(
  Effect.map((ulid) => OverseerEventId.make(`event_${ulid}`)),
  Effect.withSpan("OverseerEventId.generate"),
);
```

# 5. Actors

The current `Actor` union supports human and agent actors. It should gain a system variant for alarms, crons, and internal maintenance.

Conceptually:

```ts
const SystemActorId = Schema.Literals([
  "overseer-scheduler",
  "workspace-alarm",
  "project-alarm",
]);

const SystemActor = Schema.Struct({
  kind: Schema.tag("system"),
  systemId: SystemActorId,
});
```

Then the existing union becomes:

```ts
/** Immutable human, Agent, or system identity attributed to an Overseer operation. */
export const Actor = Schema.Union([HumanActor, AgentActor, SystemActor]).pipe(
  Schema.toTaggedUnion("kind"),
);
```

Examples:

```json
{
  "kind": "human",
  "subject": "8ca4f860-9f4f-4f3b-bf62-4524a30f5c11",
  "email": "alice@example.com"
}
```

```json
{
  "kind": "agent",
  "agentId": "agent-codex-01"
}
```

```json
{
  "kind": "system",
  "systemId": "workspace-alarm"
}
```

The actor identifies **who or what caused the operation**. The metadata origin identifies **how execution was triggered**.

# 6. Trigger metadata

Rather than making `requestId` a nullable top-level field, model execution provenance as a tagged union.

```ts
/** HTTP request that caused an event-producing operation. */
const HttpEventOrigin = Schema.Struct({
  kind: Schema.tag("http"),
  requestId: OverseerRequestId,
});

/** Named scheduled invocation that caused an event-producing operation. */
const CronEventOrigin = Schema.Struct({
  kind: Schema.tag("cron"),
  scheduleName: Schema.String,
});

/** Durable Object alarm that caused an event-producing operation. */
const DurableObjectAlarmEventOrigin = Schema.Struct({
  kind: Schema.tag("durable-object-alarm"),
  durableObjectId: Schema.String,
});

/** Internal operation without an external request or scheduled trigger. */
const InternalEventOrigin = Schema.Struct({
  kind: Schema.tag("internal"),
});

/** Execution trigger that caused an Overseer event. */
export const OverseerEventOrigin = Schema.Union([
  HttpEventOrigin,
  CronEventOrigin,
  DurableObjectAlarmEventOrigin,
  InternalEventOrigin,
]).pipe(Schema.toTaggedUnion("kind"));

/** Parsed execution trigger attached to an Overseer event. */
export type OverseerEventOrigin = typeof OverseerEventOrigin.Type;

/** Non-domain provenance attached to an Overseer event. */
export const OverseerEventMetadata = Schema.Struct({
  origin: OverseerEventOrigin,
});
```

This gives HTTP events a required request ID without requiring one for every event:

```json
{
  "origin": {
    "kind": "http",
    "requestId": "request_01KZGWMQ4054AXZGW9RR1VJ3JM"
  }
}
```

```json
{
  "origin": {
    "kind": "cron",
    "scheduleName": "archive-expired-workspaces"
  }
}
```

```json
{
  "origin": {
    "kind": "durable-object-alarm",
    "durableObjectId": "workspace_01KZGWRATYFXD8QCG7QTKG5C3S"
  }
}
```

Request provenance belongs in metadata, not the domain payload.

# 7. Common event metadata

```ts
/** Envelope fields shared by every versioned Overseer event. */
const OverseerEventEnvelopeFields = Schema.Struct({
  envelopeVersion: OverseerEventEnvelopeVersion,
  eventId: OverseerEventId,
  source: OverseerEventSource,

  /**
   * Decoded as DateTime.Utc and encoded as Unix epoch milliseconds.
   * This is source transition time, not stream-ingestion time.
   */
  timestamp: Schema.DateTimeUtcFromMillis,

  actor: Actor,
  metadata: OverseerEventMetadata,
});
```

The publisher does not generate `timestamp`; the domain operation supplies the time when the transition occurred. Retries must preserve it.

# 8. Event-owned snapshots

Events should own durable snapshot contracts rather than directly embedding the canonical `Workspace` and `Project` schemas. That prevents unrelated domain/API changes from silently changing historical event representations.

```ts
/** Workspace fields recorded in version-one events. */
export const WorkspaceEventSnapshotV1 = Schema.Struct({
  workspaceId: WorkspaceId,
  name: WorkspaceName,
  state: WorkspaceState,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  entityVersion: EntityEventVersion,
});

/** Workspace snapshot recorded in version-one events. */
export type WorkspaceEventSnapshotV1 = typeof WorkspaceEventSnapshotV1.Type;

/** Project fields recorded in version-one events. */
export const ProjectEventSnapshotV1 = Schema.Struct({
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  name: ProjectName,
  state: ProjectState,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  entityVersion: EntityEventVersion,
});

/** Project snapshot recorded in version-one events. */
export type ProjectEventSnapshotV1 = typeof ProjectEventSnapshotV1.Type;
```

`entityVersion` provides authoritative per-entity ordering. Neither timestamps nor event ULIDs should be used as a substitute.

# 9. Workspace event schemas

```ts
/** Records the initial creation of a Workspace. */
export const WorkspaceCreateEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.create.v1"),
  payload: Schema.Struct({
    workspace: WorkspaceEventSnapshotV1,
  }),
});

/** Records an actual change to a Workspace display name. */
export const WorkspaceRenameEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.rename.v1"),
  payload: Schema.Struct({
    workspace: WorkspaceEventSnapshotV1,
    previousName: WorkspaceName,
  }),
});

/** Records an active-to-archived Workspace transition. */
export const WorkspaceArchiveEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.archive.v1"),
  payload: Schema.Struct({
    workspace: WorkspaceEventSnapshotV1,
  }),
});

/** Records an archived-to-active Workspace transition. */
export const WorkspaceUnarchiveEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.unarchive.v1"),
  payload: Schema.Struct({
    workspace: WorkspaceEventSnapshotV1,
  }),
});

/** Records deletion while preserving the final Workspace snapshot. */
export const WorkspaceDeleteEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.delete.v1"),
  payload: Schema.Struct({
    workspace: WorkspaceEventSnapshotV1,
  }),
});
```

# 10. Project event schemas

```ts
/** Records the initial creation of a Project. */
export const ProjectCreateEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("project.create.v1"),
  payload: Schema.Struct({
    project: ProjectEventSnapshotV1,
  }),
});

/** Records an actual change to a Project display name. */
export const ProjectRenameEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("project.rename.v1"),
  payload: Schema.Struct({
    project: ProjectEventSnapshotV1,
    previousName: ProjectName,
  }),
});

/** Records an active-to-archived Project transition. */
export const ProjectArchiveEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("project.archive.v1"),
  payload: Schema.Struct({
    project: ProjectEventSnapshotV1,
  }),
});

/** Records an archived-to-active Project transition. */
export const ProjectUnarchiveEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("project.unarchive.v1"),
  payload: Schema.Struct({
    project: ProjectEventSnapshotV1,
  }),
});

/** Records deletion while preserving the final Project snapshot. */
export const ProjectDeleteEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("project.delete.v1"),
  payload: Schema.Struct({
    project: ProjectEventSnapshotV1,
  }),
});
```

# 11. Closed event union

```ts
/** Every versioned event currently published by Overseer. */
export const OverseerEvent = Schema.Union([
  WorkspaceCreateEventV1,
  WorkspaceRenameEventV1,
  WorkspaceArchiveEventV1,
  WorkspaceUnarchiveEventV1,
  WorkspaceDeleteEventV1,
  ProjectCreateEventV1,
  ProjectRenameEventV1,
  ProjectArchiveEventV1,
  ProjectUnarchiveEventV1,
  ProjectDeleteEventV1,
]).pipe(Schema.toTaggedUnion("type"));

/** Parsed event accepted by the Overseer event publisher. */
export type OverseerEvent = typeof OverseerEvent.Type;

/** JSON-compatible event sent to Cloudflare Pipelines. */
export type EncodedOverseerEvent = typeof OverseerEvent.Encoded;

/** Encode a parsed event for the Cloudflare stream boundary. */
export const encodeOverseerEvent = Schema.encodeEffect(OverseerEvent);

/** Parse a event received from serialized storage or transport. */
export const parseOverseerEvent = Schema.decodeUnknownEffect(OverseerEvent);
```

The complete event, rather than just `payload`, is the tagged union. That prevents mismatches such as:

```ts
{
  type: "workspace.rename.v1",
  payload: {
    project: ...
  }
}
```

# 12. Generic event publisher

```ts
/** Publishes parsed Overseer events to durable event ingestion. */
export interface IOverseerEventPublisher {
  /** Encode and durably publish one immutable event. */
  readonly publishOverseerEvent: (
    event: OverseerEvent,
  ) => Effect.Effect<void, PublishOverseerEventError>;
}

/** Provides the contextual Overseer event-publishing capability. */
export class OverseerEventPublisher extends Context.Service<
  OverseerEventPublisher,
  IOverseerEventPublisher
>()("@overseer/OverseerEventPublisher") {}
```

The publisher:

1. Accepts a parsed `OverseerEvent`.
2. Encodes it with `encodeOverseerEvent`.
3. Sends the encoded record to Cloudflare Pipelines.
4. Preserves `eventId` and `timestamp` across retries.
5. Returns a typed publication failure.

It should not invent domain facts or inspect payload variants.

# 13. Example encoded events

## HTTP Workspace rename

```json
{
  "envelopeVersion": 1,
  "eventId": "event_01KZGWRATYFXD8QCG7QTKG5C3S",
  "source": "overseer.workspace-durable-object",
  "type": "workspace.rename.v1",
  "timestamp": 1787562456123,
  "actor": {
    "kind": "agent",
    "agentId": "agent-codex-01"
  },
  "metadata": {
    "origin": {
      "kind": "http",
      "requestId": "request_01KZGWMQ4054AXZGW9RR1VJ3JM"
    }
  },
  "payload": {
    "workspace": {
      "workspaceId": "workspace_01KZGWRATYFXD8QCG7QTKG5C3S",
      "name": "Platform Engineering",
      "state": "active",
      "createdAt": "2026-08-24T12:00:00.000Z",
      "updatedAt": "2026-08-24T12:27:36.123Z",
      "entityVersion": 4
    },
    "previousName": "Product Engineering"
  }
}
```

## Alarm-driven Workspace archive

```json
{
  "envelopeVersion": 1,
  "eventId": "event_01KZH03XHFP93VWP9MCKM1ERMT",
  "source": "overseer.workspace-durable-object",
  "type": "workspace.archive.v1",
  "timestamp": 1787566000000,
  "actor": {
    "kind": "system",
    "systemId": "workspace-alarm"
  },
  "metadata": {
    "origin": {
      "kind": "durable-object-alarm",
      "durableObjectId": "workspace_01KZGWRATYFXD8QCG7QTKG5C3S"
    }
  },
  "payload": {
    "workspace": {
      "workspaceId": "workspace_01KZGWRATYFXD8QCG7QTKG5C3S",
      "name": "Platform Engineering",
      "state": "archived",
      "createdAt": "2026-08-24T12:00:00.000Z",
      "updatedAt": "2026-08-24T13:26:40.000Z",
      "entityVersion": 5
    }
  }
}
```

# 14. Reliability constraint

The final implementation must address the dual-write problem:

```text
persist entity transition
publish event
```

If persistence succeeds and publication fails, the state and event history diverge. A generic publisher alone cannot guarantee atomicity across Durable Object SQL and Cloudflare Pipelines.

The likely reliable design is:

```text
Durable Object transaction:
  1. update entity
  2. write encoded event to local outbox

Outbox delivery:
  3. publish event
  4. mark outbox entry delivered
```

The stable `eventId` makes retries safe to identify and reconcile. This reliability decision should be made before events become authoritative.
