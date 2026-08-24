import { Schema } from "effect";
import { Workspace } from "../domain/workspace.ts";
import { OverseerEventEnvelopeFields } from "./event-envelope.ts";
import { EntityEventVersion } from "./event-identity.ts";

/** Workspace fields recorded in version-one event history. */
export const WorkspaceEventSnapshotV1 = Schema.Struct({
  workspaceId: Workspace.fields.id,
  name: Workspace.fields.name,
  state: Workspace.fields.state,
  createdAt: Workspace.fields.createdAt,
  updatedAt: Workspace.fields.updatedAt,
  entityVersion: EntityEventVersion,
});

/** Parsed Workspace snapshot recorded in version-one events. */
export type WorkspaceEventSnapshotV1 = typeof WorkspaceEventSnapshotV1.Type;

/** Records the initial creation of a Workspace. */
export const WorkspaceCreateEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.create.v1"),
  payload: Schema.Struct({ workspace: WorkspaceEventSnapshotV1 }),
});

/** Records an actual change to a Workspace display name. */
export const WorkspaceRenameEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.rename.v1"),
  payload: Schema.Struct({
    workspace: WorkspaceEventSnapshotV1,
    previousName: Workspace.fields.name,
  }),
});

/** Records an active-to-archived Workspace transition. */
export const WorkspaceArchiveEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.archive.v1"),
  payload: Schema.Struct({ workspace: WorkspaceEventSnapshotV1 }),
});

/** Records an archived-to-active Workspace transition. */
export const WorkspaceUnarchiveEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.unarchive.v1"),
  payload: Schema.Struct({ workspace: WorkspaceEventSnapshotV1 }),
});

/** Records deletion while preserving the final Workspace snapshot. */
export const WorkspaceDeleteEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.tag("workspace.delete.v1"),
  payload: Schema.Struct({ workspace: WorkspaceEventSnapshotV1 }),
});
