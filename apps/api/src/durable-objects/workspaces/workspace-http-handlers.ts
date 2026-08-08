import { DateTime, Effect, Option, Semaphore } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  ArchiveWorkspaceError,
  CreateWorkspaceError,
  GetWorkspaceError,
  RenameWorkspaceError,
  UnarchiveWorkspaceError,
  type Workspace,
} from "../../domain/workspace.ts";
import { BookkeeperClient } from "../bookkeeper/bookkeeper-client.ts";
import type { BookkeeperWorkspace } from "../bookkeeper/bookkeeper-http-api.ts";
import { WorkspaceDatabase } from "./workspace-database.ts";
import { WorkspaceHttpApi } from "./workspace-http-api.ts";

const bookkeeperProjection = (
  workspace: Pick<Workspace, "id" | "createdAt" | "updatedAt">,
): BookkeeperWorkspace => ({
  id: workspace.id,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
  deletedAt: Option.none(),
});

/** Workspace HTTP handlers that coordinate Bookkeeper before local persistence mutations. */
export const workspaceHttpHandlersLayer = HttpApiBuilder.group(
  WorkspaceHttpApi,
  "workspace",
  (handlers) =>
    Effect.gen(function* () {
      const bookkeeper = yield* BookkeeperClient;
      const database = yield* WorkspaceDatabase;
      // A Bookkeeper request may suspend this Durable Object, so serialize the non-atomic
      // Bookkeeper-first protocols to preserve mutation order within this Workspace instance.
      const workspaceMutationMutex = Semaphore.makeUnsafe(1);

      return handlers
        .handle("createWorkspace", ({ payload }) =>
          workspaceMutationMutex.withPermit(
            Effect.gen(function* () {
              const existing = yield* database.getWorkspace().pipe(
                Effect.mapError(
                  (error) =>
                    new CreateWorkspaceError({
                      reason:
                        error.reason === "stored_workspace_invalid"
                          ? "stored_workspace_invalid"
                          : "database_unavailable",
                    }),
                ),
              );

              if (Option.isSome(existing) && existing.value.id !== payload.id) {
                return yield* new CreateWorkspaceError({ reason: "workspace_id_mismatch" });
              }

              const bookkeeperNow = yield* DateTime.now;
              const intendedWorkspace = Option.match(existing, {
                onNone: () => ({
                  id: payload.id,
                  createdAt: bookkeeperNow,
                  updatedAt: bookkeeperNow,
                }),
                onSome: (workspace) => ({ ...workspace, updatedAt: bookkeeperNow }),
              });
              yield* bookkeeper
                .registerWorkspace(bookkeeperProjection(intendedWorkspace))
                .pipe(
                  Effect.mapError(
                    () => new CreateWorkspaceError({ reason: "workspace_registration_failed" }),
                  ),
                );

              return yield* database.createWorkspace(payload);
            }),
          ),
        )
        .handle("getWorkspace", () =>
          Effect.gen(function* () {
            const workspace = yield* database.getWorkspace();
            return yield* Effect.fromOption(
              workspace,
              () => new GetWorkspaceError({ reason: "workspace_not_found" }),
            );
          }),
        )
        .handle("renameWorkspace", ({ payload }) =>
          workspaceMutationMutex.withPermit(
            Effect.gen(function* () {
              const workspace = yield* database.getWorkspace().pipe(
                Effect.mapError(
                  (error) =>
                    new RenameWorkspaceError({
                      reason:
                        error.reason === "stored_workspace_invalid"
                          ? "stored_workspace_invalid"
                          : "database_unavailable",
                    }),
                ),
                Effect.flatMap(
                  Option.match({
                    onNone: () =>
                      Effect.fail(new RenameWorkspaceError({ reason: "workspace_not_found" })),
                    onSome: Effect.succeed,
                  }),
                ),
              );
              yield* bookkeeper
                .registerWorkspace(
                  bookkeeperProjection({ ...workspace, updatedAt: yield* DateTime.now }),
                )
                .pipe(
                  Effect.mapError(
                    () => new RenameWorkspaceError({ reason: "workspace_registration_failed" }),
                  ),
                );

              return yield* database.renameWorkspace(payload.name);
            }),
          ),
        )
        .handle("archiveWorkspace", () =>
          workspaceMutationMutex.withPermit(
            Effect.gen(function* () {
              const workspace = yield* database.getWorkspace().pipe(
                Effect.mapError(
                  (error) =>
                    new ArchiveWorkspaceError({
                      reason:
                        error.reason === "stored_workspace_invalid"
                          ? "stored_workspace_invalid"
                          : "database_unavailable",
                    }),
                ),
                Effect.flatMap(
                  Option.match({
                    onNone: () =>
                      Effect.fail(new ArchiveWorkspaceError({ reason: "workspace_not_found" })),
                    onSome: Effect.succeed,
                  }),
                ),
              );
              yield* bookkeeper
                .registerWorkspace(
                  bookkeeperProjection({ ...workspace, updatedAt: yield* DateTime.now }),
                )
                .pipe(
                  Effect.mapError(
                    () => new ArchiveWorkspaceError({ reason: "workspace_registration_failed" }),
                  ),
                );

              return yield* database.archiveWorkspace();
            }),
          ),
        )
        .handle("unarchiveWorkspace", () =>
          workspaceMutationMutex.withPermit(
            Effect.gen(function* () {
              const workspace = yield* database.getWorkspace().pipe(
                Effect.mapError(
                  (error) =>
                    new UnarchiveWorkspaceError({
                      reason:
                        error.reason === "stored_workspace_invalid"
                          ? "stored_workspace_invalid"
                          : "database_unavailable",
                    }),
                ),
                Effect.flatMap(
                  Option.match({
                    onNone: () =>
                      Effect.fail(new UnarchiveWorkspaceError({ reason: "workspace_not_found" })),
                    onSome: Effect.succeed,
                  }),
                ),
              );
              yield* bookkeeper
                .registerWorkspace(
                  bookkeeperProjection({ ...workspace, updatedAt: yield* DateTime.now }),
                )
                .pipe(
                  Effect.mapError(
                    () => new UnarchiveWorkspaceError({ reason: "workspace_registration_failed" }),
                  ),
                );

              return yield* database.unarchiveWorkspace();
            }),
          ),
        );
    }),
);
