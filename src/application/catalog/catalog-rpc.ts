import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { WorkspaceId } from "../../domain/entity-id.ts";
import {
  IdempotencyKey,
  IdempotencyPrincipal,
} from "../../domain/idempotency.ts";
import { WorkspaceCursor } from "../../domain/pagination.ts";
import {
  Workspace,
  WorkspaceName,
} from "../../domain/workspace.ts";

/** Canonical fingerprint of one idempotent request. */
export const IdempotencyFingerprint = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1_000),
).pipe(Schema.brand("IdempotencyFingerprint"));

/** Canonical fingerprint of one idempotent request. */
export type IdempotencyFingerprint = typeof IdempotencyFingerprint.Type;

/** Closed Catalog read protocol accepted by the Workspace Catalog object. */
export const CatalogRead = Schema.TaggedUnion({
  ListWorkspaces: {
    cursor: Schema.optionalKey(WorkspaceCursor),
    limit: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  },
  ReadWorkspace: { workspaceId: WorkspaceId },
});

/** Closed Catalog read protocol accepted by the Workspace Catalog object. */
export type CatalogRead = typeof CatalogRead.Type;

/** Closed Catalog command protocol accepted by the Workspace Catalog object. */
export const CatalogCommand = Schema.TaggedUnion({
  CreateWorkspace: {
    name: WorkspaceName,
    principalKey: IdempotencyPrincipal,
    idempotencyKey: IdempotencyKey,
  },
  RenameWorkspace: {
    workspaceId: WorkspaceId,
    name: WorkspaceName,
  },
});

/** Closed Catalog command protocol accepted by the Workspace Catalog object. */
export type CatalogCommand = typeof CatalogCommand.Type;

/** Plain schema-decodable outcome returned across the Catalog RPC boundary. */
export const CatalogOutcome = Schema.TaggedUnion({
  WorkspaceCollection: {
    workspaces: Schema.Array(Workspace),
    cursor: Schema.NullOr(WorkspaceCursor),
    nextCursor: Schema.NullOr(WorkspaceCursor),
    limit: Schema.Number,
  },
  CursorInvalid: {},
  WorkspaceFound: { workspace: Workspace },
  WorkspaceCreated: { workspace: Workspace, replayed: Schema.Boolean },
  WorkspaceRenamed: { workspace: Workspace },
  WorkspaceNotFound: {},
  IdempotencyKeyReused: {},
  CatalogProtocolInvalid: {},
  CatalogRecordCorrupt: {},
  CatalogStateUnavailable: {},
});

/** Plain schema-decodable outcome returned across the Catalog RPC boundary. */
export type CatalogOutcome = typeof CatalogOutcome.Type;

/** Binding-independent client for the singleton Catalog RPC seam. */
export type CatalogRpc = {
  readonly read: (request: CatalogRead) => Effect.Effect<CatalogOutcome>;
  readonly command: (request: CatalogCommand) => Effect.Effect<CatalogOutcome>;
};
