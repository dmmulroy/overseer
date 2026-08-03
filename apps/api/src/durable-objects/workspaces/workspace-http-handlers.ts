import { Effect } from "effect";
import { GetWorkspaceError } from "../../domain/workspace.ts";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { WorkspaceDatabase } from "./workspace-database.ts";
import { WorkspaceHttpApi } from "./workspace-http-api.ts";

/** Workspace HTTP handlers that delegate parsed requests to Workspace persistence. */
export const workspaceHttpHandlersLayer = HttpApiBuilder.group(
  WorkspaceHttpApi,
  "workspace",
  (handlers) =>
    Effect.gen(function* () {
      const database = yield* WorkspaceDatabase;

      return handlers
        .handle("createWorkspace", ({ payload }) => database.createWorkspace(payload))
        .handle("getWorkspace", () =>
          Effect.gen(function* () {
            const workspace = yield* database.getWorkspace;
            // Absence is ordinary for application clients, but this instance-scoped route requires initialization.
            return yield* Effect.fromOption(
              workspace,
              () => new GetWorkspaceError({ reason: "workspace_not_found" }),
            );
          }),
        )
        .handle("renameWorkspace", ({ payload }) => database.renameWorkspace(payload.name))
        .handle("archiveWorkspace", () => database.archiveWorkspace)
        .handle("unarchiveWorkspace", () => database.unarchiveWorkspace);
    }),
);
