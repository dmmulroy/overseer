import { Schema } from "effect";
import { Ulid } from "./ulid.ts";
import { Workspace } from "./workspace.ts";

/** Stable Project identity composed of the `project_` prefix and a canonical ULID. */
export const ProjectId = Schema.TemplateLiteral(["project_", Ulid]).pipe(Schema.brand("ProjectId"));

/** Stable Project identity. */
export type ProjectId = typeof ProjectId.Type;

/** Nonblank, single-line Project display name containing at most 200 characters. */
export const ProjectName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
  Schema.isPattern(/\S/u),
  Schema.isPattern(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u),
).pipe(Schema.brand("ProjectName"));

/** Validated Project display name. */
export type ProjectName = typeof ProjectName.Type;

/** Lifecycle state retained by a Project server. */
export const ProjectState = Schema.Literals(["active", "archived"]);

/** Project lifecycle state. */
export type ProjectState = typeof ProjectState.Type;

/** Project domain entity owned by one Workspace. */
export const Project = Schema.Struct({
  id: ProjectId,
  workspaceId: Workspace.fields.id,
  name: ProjectName,
  state: ProjectState,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

/** Parsed Project domain entity. */
export interface Project extends Schema.Schema.Type<typeof Project> {}
