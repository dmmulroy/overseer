import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** Maximum number of Workspaces accepted and returned by one page request. */
export const WorkspacePageLimit = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
).pipe(Schema.brand("WorkspacePageLimit"));

/** Maximum number of Workspaces accepted and returned by one page request. */
export type WorkspacePageLimit = typeof WorkspacePageLimit.Type;

/** Parse a decimal query value into a branded Workspace page limit. */
export const WorkspacePageLimitFromString = Schema.NumberFromString.pipe(
  Schema.decodeTo(WorkspacePageLimit, SchemaTransformation.passthrough()),
);

/** Opaque keyset cursor for one Workspace collection page. */
export const WorkspaceCursor = Schema.String.pipe(Schema.brand("WorkspaceCursor"));

/** Opaque keyset cursor for one Workspace collection page. */
export type WorkspaceCursor = typeof WorkspaceCursor.Type;
