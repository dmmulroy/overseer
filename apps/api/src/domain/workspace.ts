import { Effect, Schema } from "effect";
import { generateUlid, Ulid } from "./ulid.ts";

/** Workspace identity composed of the `workspace_` prefix and a canonical ULID. */
export const WorkspaceId = Schema.TemplateLiteral(["workspace_", Ulid]).pipe(
  Schema.brand("WorkspaceId"),
  Schema.annotateEncoded({
    description: "Stable Workspace identity returned by the create Workspace operation.",
    examples: ["workspace_01KZGWRATYFXD8QCG7QTKG5C3S"],
  }),
);

/** A validated Workspace identity. */
export type WorkspaceId = typeof WorkspaceId.Type;

/** Generate a Workspace identity from the active Effect clock and random services. */
export const generateWorkspaceId: Effect.Effect<WorkspaceId> = generateUlid.pipe(
  Effect.map((ulid) => WorkspaceId.make(`workspace_${ulid}`)),
  Effect.withSpan("WorkspaceId.generate"),
);

/** Nonblank, single-line Workspace display name containing at most 200 characters. */
export const WorkspaceName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
  Schema.isPattern(/\S/u),
  Schema.isPattern(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u),
).pipe(
  Schema.brand("WorkspaceName"),
  Schema.annotateEncoded({
    description: "Human-readable Workspace display name.",
    examples: ["Product Engineering"],
  }),
);

/** A validated Workspace display name. */
export type WorkspaceName = typeof WorkspaceName.Type;

/** Persistent lifecycle state of a Workspace. */
export const WorkspaceState = Schema.Literals(["active", "archived"]);

/** Active or archived Workspace lifecycle state. */
export type WorkspaceState = typeof WorkspaceState.Type;

/** Canonical Workspace entity returned by persistence and HTTP boundaries. */
export const Workspace = Schema.Struct({
  id: WorkspaceId,
  name: WorkspaceName,
  state: WorkspaceState,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

/** A Workspace hosted by the Durable Object keyed by its identity. */
export type Workspace = typeof Workspace.Type;

const CreateWorkspaceFailureReason = Schema.Literals([
  "workspace_id_mismatch",
  "database_unavailable",
  "stored_workspace_invalid",
]);

/** Classified failure while initializing a Workspace. */
export class CreateWorkspaceError extends Schema.TaggedError<CreateWorkspaceError>()(
  "CreateWorkspaceError",
  { reason: CreateWorkspaceFailureReason },
) {
  /** Searchable safe explanation of the Workspace creation failure. */
  override get message(): string {
    switch (this.reason) {
      case "workspace_id_mismatch":
        return "Workspace creation rejected because this Durable Object already owns another identity";
      case "database_unavailable":
        return "Workspace creation failed because the Workspace database is unavailable";
      case "stored_workspace_invalid":
        return "Workspace creation failed because the stored Workspace is invalid";
    }
  }
}

const GetWorkspaceFailureReason = Schema.Literals([
  "workspace_not_found",
  "database_unavailable",
  "stored_workspace_invalid",
]);

/** Classified failure while reading a Workspace. */
export class GetWorkspaceError extends Schema.TaggedError<GetWorkspaceError>()(
  "GetWorkspaceError",
  { reason: GetWorkspaceFailureReason },
) {
  /** Searchable safe explanation of the Workspace read failure. */
  override get message(): string {
    switch (this.reason) {
      case "workspace_not_found":
        return "Workspace read failed because the Workspace has not been initialized";
      case "database_unavailable":
        return "Workspace read failed because the Workspace database is unavailable";
      case "stored_workspace_invalid":
        return "Workspace read failed because the stored Workspace is invalid";
    }
  }
}

const RenameWorkspaceFailureReason = Schema.Literals([
  "workspace_not_found",
  "database_unavailable",
  "stored_workspace_invalid",
]);

/** Classified failure while renaming a Workspace. */
export class RenameWorkspaceError extends Schema.TaggedError<RenameWorkspaceError>()(
  "RenameWorkspaceError",
  { reason: RenameWorkspaceFailureReason },
) {
  /** Searchable safe explanation of the Workspace rename failure. */
  override get message(): string {
    switch (this.reason) {
      case "workspace_not_found":
        return "Workspace rename failed because the Workspace has not been initialized";
      case "database_unavailable":
        return "Workspace rename failed because the Workspace database is unavailable";
      case "stored_workspace_invalid":
        return "Workspace rename failed because the stored Workspace is invalid";
    }
  }
}

const ArchiveWorkspaceFailureReason = Schema.Literals([
  "workspace_not_found",
  "database_unavailable",
  "stored_workspace_invalid",
]);

/** Classified failure while archiving a Workspace. */
export class ArchiveWorkspaceError extends Schema.TaggedError<ArchiveWorkspaceError>()(
  "ArchiveWorkspaceError",
  { reason: ArchiveWorkspaceFailureReason },
) {
  /** Searchable safe explanation of the Workspace archive failure. */
  override get message(): string {
    switch (this.reason) {
      case "workspace_not_found":
        return "Workspace archive failed because the Workspace has not been initialized";
      case "database_unavailable":
        return "Workspace archive failed because the Workspace database is unavailable";
      case "stored_workspace_invalid":
        return "Workspace archive failed because the stored Workspace is invalid";
    }
  }
}

const UnarchiveWorkspaceFailureReason = Schema.Literals([
  "workspace_not_found",
  "database_unavailable",
  "stored_workspace_invalid",
]);

/** Classified failure while unarchiving a Workspace. */
export class UnarchiveWorkspaceError extends Schema.TaggedError<UnarchiveWorkspaceError>()(
  "UnarchiveWorkspaceError",
  { reason: UnarchiveWorkspaceFailureReason },
) {
  /** Searchable safe explanation of the Workspace unarchive failure. */
  override get message(): string {
    switch (this.reason) {
      case "workspace_not_found":
        return "Workspace unarchive failed because the Workspace has not been initialized";
      case "database_unavailable":
        return "Workspace unarchive failed because the Workspace database is unavailable";
      case "stored_workspace_invalid":
        return "Workspace unarchive failed because the stored Workspace is invalid";
    }
  }
}
