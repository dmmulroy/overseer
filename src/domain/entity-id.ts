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
