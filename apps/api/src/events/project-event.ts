import { Schema } from "effect";
import { Project } from "../domain/project.ts";
import { OverseerEventEnvelopeFields } from "./event-envelope.ts";
import { EntityEventVersion } from "./event-identity.ts";

/** Project fields recorded in version-one event history. */
export const ProjectEventSnapshotV1 = Schema.Struct({
  projectId: Project.fields.id,
  workspaceId: Project.fields.workspaceId,
  name: Project.fields.name,
  state: Project.fields.state,
  createdAt: Project.fields.createdAt,
  updatedAt: Project.fields.updatedAt,
  entityVersion: EntityEventVersion,
});

/** Parsed Project snapshot recorded in version-one events. */
export type ProjectEventSnapshotV1 = typeof ProjectEventSnapshotV1.Type;

/** Records the initial creation of a Project. */
export const ProjectCreateEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.Literal("project.create.v1"),
  payload: Schema.Struct({ project: ProjectEventSnapshotV1 }),
});

/** Records an actual change to a Project display name. */
export const ProjectRenameEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.Literal("project.rename.v1"),
  payload: Schema.Struct({
    project: ProjectEventSnapshotV1,
    previousName: Project.fields.name,
  }),
});

/** Records an active-to-archived Project transition. */
export const ProjectArchiveEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.Literal("project.archive.v1"),
  payload: Schema.Struct({ project: ProjectEventSnapshotV1 }),
});

/** Records an archived-to-active Project transition. */
export const ProjectUnarchiveEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.Literal("project.unarchive.v1"),
  payload: Schema.Struct({ project: ProjectEventSnapshotV1 }),
});

/** Records deletion while preserving the final Project snapshot. */
export const ProjectDeleteEventV1 = Schema.Struct({
  ...OverseerEventEnvelopeFields.fields,
  type: Schema.Literal("project.delete.v1"),
  payload: Schema.Struct({ project: ProjectEventSnapshotV1 }),
});
