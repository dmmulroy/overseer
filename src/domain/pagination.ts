import * as Schema from "effect/Schema";

/** Opaque keyset cursor for one Workspace collection page. */
export const WorkspaceCursor = Schema.String.pipe(Schema.brand("WorkspaceCursor"));

/** Opaque keyset cursor for one Workspace collection page. */
export type WorkspaceCursor = typeof WorkspaceCursor.Type;
