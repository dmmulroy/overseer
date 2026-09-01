import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { GetWorkspaceError } from "../../domain/workspace.ts";
import { WorkspaceDatabase } from "./workspace-database.ts";
import { WorkspaceHttpApi } from "./workspace-http-api.ts";

/** Workspace HTTP handlers backed directly by the current Durable Object database. */
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
            const workspace = yield* database.getWorkspace();
            return yield* Effect.fromOption(
              workspace,
              () => new GetWorkspaceError({ reason: "workspace_not_found" }),
            );
          }),
        )
        .handle("renameWorkspace", ({ payload }) => database.renameWorkspace(payload.name))
        .handle("archiveWorkspace", () => database.archiveWorkspace())
        .handle("unarchiveWorkspace", () => database.unarchiveWorkspace());
    }),
);
