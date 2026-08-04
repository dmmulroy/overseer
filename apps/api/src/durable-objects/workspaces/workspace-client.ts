import * as Cloudflare from "alchemy/Cloudflare";
import { Context, Effect, Layer, Option } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import {
  ArchiveWorkspaceError,
  CreateWorkspaceError,
  GetWorkspaceError,
  RenameWorkspaceError,
  UnarchiveWorkspaceError,
  type Workspace,
  type WorkspaceId,
  type WorkspaceName,
  generateWorkspaceId,
} from "../../domain/workspace.ts";
import { WorkspaceHttpApi } from "./workspace-http-api.ts";
import { WorkspaceServer } from "./workspace-server.ts";

/** Application-facing operations for Workspace Durable Objects. */
export interface IWorkspaceClient {
  /** Read a Workspace, returning absence when its Durable Object is not initialized. */
  readonly getWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Option.Option<Workspace>, GetWorkspaceError>;

  /** Generate an identity and initialize its Workspace Durable Object. */
  readonly createWorkspace: (input: {
    readonly name: WorkspaceName;
  }) => Effect.Effect<Workspace, CreateWorkspaceError>;

  /** Replace a Workspace display name without exposing its Durable Object binding. */
  readonly renameWorkspace: (input: {
    readonly id: WorkspaceId;
    readonly name: WorkspaceName;
  }) => Effect.Effect<Workspace, RenameWorkspaceError>;

  /** Archive a Workspace without deleting its Durable Object or stored entity. */
  readonly archiveWorkspace: (id: WorkspaceId) => Effect.Effect<Workspace, ArchiveWorkspaceError>;

  /** Restore an archived Workspace to the active state. */
  readonly unarchiveWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Workspace, UnarchiveWorkspaceError>;
}

/** Application-owned client capability for Workspace Durable Objects. */
export class WorkspaceClient extends Context.Service<WorkspaceClient, IWorkspaceClient>()(
  "@overseer/WorkspaceClient",
) {}

/** Construct the Workspace client while preserving its Durable Object namespace requirement. */
export const makeWorkspaceClient: Effect.Effect<
  WorkspaceClient["Service"],
  never,
  Cloudflare.Worker
> = Effect.gen(function* () {
  const namespace = yield* WorkspaceServer;
  const httpClientForWorkspace = (id: WorkspaceId) =>
    HttpApiClient.makeWith(WorkspaceHttpApi, {
      baseUrl: "http://workspace.internal",
      httpClient: Cloudflare.toHttpClient(namespace.getByName(id)),
    });

  return WorkspaceClient.of({
    getWorkspace: Effect.fn("WorkspaceClient.getWorkspace")(function* (id) {
      const client = yield* httpClientForWorkspace(id);
      return yield* client.workspace.getWorkspace().pipe(
        Effect.map(Option.some),
        Effect.catchTag("GetWorkspaceError", (error) =>
          error.reason === "workspace_not_found"
            ? Effect.succeed(Option.none())
            : Effect.fail(error),
        ),
        Effect.catchTags({
          HttpClientError: () =>
            Effect.fail(new GetWorkspaceError({ reason: "database_unavailable" })),
          SchemaError: () =>
            Effect.fail(new GetWorkspaceError({ reason: "stored_workspace_invalid" })),
        }),
      );
    }),

    createWorkspace: Effect.fn("WorkspaceClient.createWorkspace")(function* (input) {
      const id = yield* generateWorkspaceId;
      const client = yield* httpClientForWorkspace(id);
      return yield* client.workspace.createWorkspace({ payload: { id, name: input.name } }).pipe(
        Effect.catchTags({
          HttpClientError: () =>
            Effect.fail(new CreateWorkspaceError({ reason: "database_unavailable" })),
          SchemaError: () =>
            Effect.fail(new CreateWorkspaceError({ reason: "stored_workspace_invalid" })),
        }),
      );
    }),

    renameWorkspace: Effect.fn("WorkspaceClient.renameWorkspace")(function* (input) {
      const client = yield* httpClientForWorkspace(input.id);
      return yield* client.workspace.renameWorkspace({ payload: { name: input.name } }).pipe(
        Effect.catchTags({
          HttpClientError: () =>
            Effect.fail(new RenameWorkspaceError({ reason: "database_unavailable" })),
          SchemaError: () =>
            Effect.fail(new RenameWorkspaceError({ reason: "stored_workspace_invalid" })),
        }),
      );
    }),

    archiveWorkspace: Effect.fn("WorkspaceClient.archiveWorkspace")(function* (id) {
      const client = yield* httpClientForWorkspace(id);
      return yield* client.workspace.archiveWorkspace().pipe(
        Effect.catchTags({
          HttpClientError: () =>
            Effect.fail(new ArchiveWorkspaceError({ reason: "database_unavailable" })),
          SchemaError: () =>
            Effect.fail(new ArchiveWorkspaceError({ reason: "stored_workspace_invalid" })),
        }),
      );
    }),

    unarchiveWorkspace: Effect.fn("WorkspaceClient.unarchiveWorkspace")(function* (id) {
      const client = yield* httpClientForWorkspace(id);
      return yield* client.workspace.unarchiveWorkspace().pipe(
        Effect.catchTags({
          HttpClientError: () =>
            Effect.fail(new UnarchiveWorkspaceError({ reason: "database_unavailable" })),
          SchemaError: () =>
            Effect.fail(new UnarchiveWorkspaceError({ reason: "stored_workspace_invalid" })),
        }),
      );
    }),
  });
});

/** Provides the Workspace client while leaving Durable Object binding selection visible. */
export const workspaceClientLayerWithoutDependencies = Layer.effect(
  WorkspaceClient,
  makeWorkspaceClient,
);
