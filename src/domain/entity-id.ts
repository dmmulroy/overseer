import * as Schema from "effect/Schema";
import { Ulid } from "./ulid.ts";

/** Immutable, canonical identity for a Workspace. */
export const WorkspaceId = Schema.TemplateLiteral(["workspace_", Ulid]).pipe(
  Schema.brand("WorkspaceId"),
);

/** Immutable, canonical identity for a Workspace. */
export type WorkspaceId = typeof WorkspaceId.Type;

/** Prefix a ULID for use as a Workspace identity. */
export function makeWorkspaceId(ulid: Ulid): WorkspaceId {
  return WorkspaceId.make(`workspace_${ulid}`);
}

/** Immutable, canonical identity for a Project. */
export const ProjectId = Schema.TemplateLiteral(["project_", Ulid]).pipe(Schema.brand("ProjectId"));

/** Immutable, canonical identity for a Project. */
export type ProjectId = typeof ProjectId.Type;

/** Prefix a ULID for use as a Project identity. */
export function makeProjectId(ulid: Ulid): ProjectId {
  return ProjectId.make(`project_${ulid}`);
}

/** Immutable, canonical identity for an Issue. */
export const IssueId = Schema.TemplateLiteral(["issue_", Ulid]).pipe(Schema.brand("IssueId"));

/** Immutable, canonical identity for an Issue. */
export type IssueId = typeof IssueId.Type;

/** Prefix a ULID for use as an Issue identity. */
export function makeIssueId(ulid: Ulid): IssueId {
  return IssueId.make(`issue_${ulid}`);
}

/** Immutable identity for a structured Timeline event. */
export const TimelineEventId = Schema.TemplateLiteral(["event_", Ulid]).pipe(
  Schema.brand("TimelineEventId"),
);

/** Immutable identity for a structured Timeline event. */
export type TimelineEventId = typeof TimelineEventId.Type;

/** Prefix a ULID for use as a structured Timeline event identity. */
export function makeTimelineEventId(ulid: Ulid): TimelineEventId {
  return TimelineEventId.make(`event_${ulid}`);
}
