import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import type { WorkspaceId } from "./domain/workspace.ts";
import {
  OverseerHttpApi,
  WorkspaceNotFoundApiError,
  WorkspaceOperationFailedApiError,
  WorkspaceServiceUnavailableApiError,
  type WorkspaceApiOperation,
} from "./overseer-http-api.ts";
import { CurrentRequestId } from "./request-id.ts";
import { OverseerSdk } from "./overseer-sdk/overseer-sdk.ts";

type ExistingWorkspaceApiOperation = Exclude<WorkspaceApiOperation, "create">;
type CreateWorkspaceApiError =
  | WorkspaceOperationFailedApiError
  | WorkspaceServiceUnavailableApiError;
type ExistingWorkspaceApiError =
  | WorkspaceNotFoundApiError
  | WorkspaceOperationFailedApiError
  | WorkspaceServiceUnavailableApiError;

const workspaceIdentityMessage = (workspaceId: Option.Option<WorkspaceId>): string =>
  Option.match(workspaceId, {
    onNone: () => "the requested Workspace",
    onSome: (id) => `Workspace ${id}`,
  });

const workspaceOperationLabel = (operation: WorkspaceApiOperation): string => {
  switch (operation) {
    case "create":
      return "creation";
    case "get":
      return "read";
    case "rename":
      return "rename";
    case "archive":
      return "archive";
    case "unarchive":
      return "unarchive";
  }
};

const failWorkspaceNotFound = (
  workspaceId: WorkspaceId,
  operation: ExistingWorkspaceApiOperation,
) =>
  Effect.gen(function* () {
    const requestId = yield* CurrentRequestId;
    return yield* new WorkspaceNotFoundApiError({
      code: "workspace_not_found",
      message: `Workspace not found: Workspace ${workspaceId} was not found. Check the Workspace ID and try again.`,
      requestId,
      retryable: false,
      details: { workspaceId, operation },
    });
  });

const failWorkspaceOperation = (
  operation: WorkspaceApiOperation,
  workspaceId: Option.Option<WorkspaceId>,
) =>
  Effect.gen(function* () {
    const requestId = yield* CurrentRequestId;
    const identity = workspaceIdentityMessage(workspaceId);
    return yield* new WorkspaceOperationFailedApiError({
      code: "workspace_operation_failed",
      message: `Workspace operation failed: ${identity} ${workspaceOperationLabel(operation)} could not be completed because Overseer encountered an internal consistency problem. Contact support with request ID ${requestId}.`,
      requestId,
      retryable: false,
      details: { workspaceId, operation },
    });
  });

const failWorkspaceServiceUnavailable = (
  operation: WorkspaceApiOperation,
  workspaceId: Option.Option<WorkspaceId>,
  retryable: boolean,
) =>
  Effect.gen(function* () {
    const requestId = yield* CurrentRequestId;
    const identity = workspaceIdentityMessage(workspaceId);
    const recovery = retryable
      ? "Retry the same operation."
      : `Do not retry this operation automatically; contact support with request ID ${requestId}.`;
    return yield* new WorkspaceServiceUnavailableApiError({
      code: "workspace_service_unavailable",
      message: `Workspace service unavailable: ${identity} ${workspaceOperationLabel(operation)} could not be completed because a required Overseer service is temporarily unavailable. ${recovery}`,
      requestId,
      retryable,
      details: { workspaceId, operation },
    });
  });

/** Root HTTP handlers that translate Overseer SDK results into the external API contract. */
export const overseerHttpHandlersLayer = HttpApiBuilder.group(
  OverseerHttpApi,
  "overseer",
  (handlers) =>
    Effect.gen(function* () {
      const overseer = yield* OverseerSdk;

      return handlers
        .handle("getApiIdentity", () => Effect.succeed("Overseer API"))
        .handle("createWorkspace", ({ payload }) =>
          overseer.workspace.createWorkspace(payload).pipe(
            Effect.catchTag(
              "CreateWorkspaceError",
              (error): Effect.Effect<never, CreateWorkspaceApiError, CurrentRequestId> => {
                switch (error.reason) {
                  case "workspace_id_mismatch":
                  case "workspace_registration_failed":
                  case "stored_workspace_invalid":
                    return failWorkspaceOperation("create", Option.none());
                  case "database_unavailable":
                    return failWorkspaceServiceUnavailable("create", Option.none(), false);
                }
              },
            ),
          ),
        )
        .handle("getWorkspace", ({ params }) =>
          overseer.workspace.getWorkspace(params.workspaceId).pipe(
            Effect.catchTag(
              "GetWorkspaceError",
              (error): Effect.Effect<never, ExistingWorkspaceApiError, CurrentRequestId> => {
                switch (error.reason) {
                  case "workspace_not_found":
                    return failWorkspaceNotFound(params.workspaceId, "get");
                  case "stored_workspace_invalid":
                    return failWorkspaceOperation("get", Option.some(params.workspaceId));
                  case "database_unavailable":
                    return failWorkspaceServiceUnavailable(
                      "get",
                      Option.some(params.workspaceId),
                      true,
                    );
                }
              },
            ),
            Effect.flatMap(
              Option.match({
                onNone: () => failWorkspaceNotFound(params.workspaceId, "get"),
                onSome: Effect.succeed,
              }),
            ),
          ),
        )
        .handle("renameWorkspace", ({ params, payload }) =>
          overseer.workspace.renameWorkspace({ id: params.workspaceId, name: payload.name }).pipe(
            Effect.catchTag(
              "RenameWorkspaceError",
              (error): Effect.Effect<never, ExistingWorkspaceApiError, CurrentRequestId> => {
                switch (error.reason) {
                  case "workspace_not_found":
                    return failWorkspaceNotFound(params.workspaceId, "rename");
                  case "workspace_registration_failed":
                  case "stored_workspace_invalid":
                    return failWorkspaceOperation("rename", Option.some(params.workspaceId));
                  case "database_unavailable":
                    return failWorkspaceServiceUnavailable(
                      "rename",
                      Option.some(params.workspaceId),
                      true,
                    );
                }
              },
            ),
          ),
        )
        .handle("archiveWorkspace", ({ params }) =>
          overseer.workspace.archiveWorkspace(params.workspaceId).pipe(
            Effect.catchTag(
              "ArchiveWorkspaceError",
              (error): Effect.Effect<never, ExistingWorkspaceApiError, CurrentRequestId> => {
                switch (error.reason) {
                  case "workspace_not_found":
                    return failWorkspaceNotFound(params.workspaceId, "archive");
                  case "workspace_registration_failed":
                  case "stored_workspace_invalid":
                    return failWorkspaceOperation("archive", Option.some(params.workspaceId));
                  case "database_unavailable":
                    return failWorkspaceServiceUnavailable(
                      "archive",
                      Option.some(params.workspaceId),
                      true,
                    );
                }
              },
            ),
          ),
        )
        .handle("unarchiveWorkspace", ({ params }) =>
          overseer.workspace.unarchiveWorkspace(params.workspaceId).pipe(
            Effect.catchTag(
              "UnarchiveWorkspaceError",
              (error): Effect.Effect<never, ExistingWorkspaceApiError, CurrentRequestId> => {
                switch (error.reason) {
                  case "workspace_not_found":
                    return failWorkspaceNotFound(params.workspaceId, "unarchive");
                  case "workspace_registration_failed":
                  case "stored_workspace_invalid":
                    return failWorkspaceOperation("unarchive", Option.some(params.workspaceId));
                  case "database_unavailable":
                    return failWorkspaceServiceUnavailable(
                      "unarchive",
                      Option.some(params.workspaceId),
                      true,
                    );
                }
              },
            ),
          ),
        );
    }),
);
