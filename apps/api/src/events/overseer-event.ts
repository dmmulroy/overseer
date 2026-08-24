import { Schema } from "effect";
import {
  ProjectArchiveEventV1,
  ProjectCreateEventV1,
  ProjectDeleteEventV1,
  ProjectRenameEventV1,
  ProjectUnarchiveEventV1,
} from "./project-event.ts";
import {
  WorkspaceArchiveEventV1,
  WorkspaceCreateEventV1,
  WorkspaceDeleteEventV1,
  WorkspaceRenameEventV1,
  WorkspaceUnarchiveEventV1,
} from "./workspace-event.ts";

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

/** JSON-compatible event representation sent to durable ingestion. */
export type EncodedOverseerEvent = typeof OverseerEvent.Encoded;

/** Encode a parsed event for a durable ingestion boundary. */
export const encodeOverseerEvent = Schema.encodeEffect(OverseerEvent);

/** Parse an event received from serialized storage or transport. */
export const parseOverseerEvent = Schema.decodeUnknownEffect(OverseerEvent);
