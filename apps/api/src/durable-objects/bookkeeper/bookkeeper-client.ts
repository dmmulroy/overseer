import * as Cloudflare from "alchemy/Cloudflare";
import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";
import { Context, Effect, Layer, Option } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import type { IssueId } from "../../domain/issue.ts";
import type { ProjectId } from "../../domain/project.ts";
import type { WorkspaceId } from "../../domain/workspace.ts";
import type { PaginationPage, PaginationRequest } from "../../pagination.ts";
import {
  BOOKKEEPER_ID,
  type BookkeeperCounts,
  BookkeeperHttpApi,
  type BookkeeperIssue,
  type BookkeeperProject,
  type BookkeeperWorkspace,
  DeleteIssueError,
  DeleteProjectError,
  DeleteWorkspaceError,
  GetBookkeeperCountsError,
  GetIssueError,
  GetProjectError,
  GetWorkspaceError,
  ListIssuesError,
  ListProjectsError,
  ListWorkspacesError,
  RegisterIssueError,
  RegisterProjectError,
  RegisterWorkspaceError,
} from "./bookkeeper-http-api.ts";
import bookkeeperServerLayer, { BookkeeperServer } from "./bookkeeper-server.ts";

/** Application-facing operations for the singleton Bookkeeper directory. */
export interface IBookkeeperClient {
  /** List live Workspaces in stable identity order. */
  readonly listWorkspaces: (
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperWorkspace>, ListWorkspacesError>;
  /** Read a Workspace projection, including a tombstone when present. */
  readonly getWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Option.Option<BookkeeperWorkspace>, GetWorkspaceError>;
  /** Idempotently register or refresh one Workspace projection. */
  readonly registerWorkspace: (
    workspace: BookkeeperWorkspace,
  ) => Effect.Effect<BookkeeperWorkspace, RegisterWorkspaceError>;
  /** Idempotently tombstone one childless Workspace projection. */
  readonly deleteWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<BookkeeperWorkspace, DeleteWorkspaceError>;
  /** List live Projects owned by one Workspace. */
  readonly listProjects: (
    workspaceId: WorkspaceId,
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperProject>, ListProjectsError>;
  /** Read a Project projection, including a tombstone when present. */
  readonly getProject: (
    id: ProjectId,
  ) => Effect.Effect<Option.Option<BookkeeperProject>, GetProjectError>;
  /** Idempotently register or refresh one Project projection. */
  readonly registerProject: (
    project: BookkeeperProject,
  ) => Effect.Effect<BookkeeperProject, RegisterProjectError>;
  /** Idempotently tombstone one childless Project projection. */
  readonly deleteProject: (id: ProjectId) => Effect.Effect<BookkeeperProject, DeleteProjectError>;
  /** List live Issues owned by one Project. */
  readonly listIssues: (
    projectId: ProjectId,
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperIssue>, ListIssuesError>;
  /** Read an Issue projection, including a tombstone when present. */
  readonly getIssue: (id: IssueId) => Effect.Effect<Option.Option<BookkeeperIssue>, GetIssueError>;
  /** Idempotently register or refresh one Issue projection. */
  readonly registerIssue: (
    issue: BookkeeperIssue,
  ) => Effect.Effect<BookkeeperIssue, RegisterIssueError>;
  /** Idempotently tombstone one Issue projection. */
  readonly deleteIssue: (id: IssueId) => Effect.Effect<BookkeeperIssue, DeleteIssueError>;
  /** Count all live indexed entities without enumerating their collections. */
  readonly getCounts: () => Effect.Effect<BookkeeperCounts, GetBookkeeperCountsError>;
}

/** Provides the application-owned Bookkeeper HTTP client capability. */
export class BookkeeperClient extends Context.Service<BookkeeperClient, IBookkeeperClient>()(
  "@overseer/BookkeeperClient",
) {}

/** Construct the Bookkeeper client while preserving its Durable Object namespace requirement. */
export const makeBookkeeperClient: Effect.Effect<
  BookkeeperClient["Service"],
  never,
  Cloudflare.Worker | BookkeeperServer
> = Effect.gen(function* () {
  const namespace = yield* BookkeeperServer;
  const bookkeeperHttpClient = yield* makeExecutionMemo(
    Effect.suspend(() =>
      HttpApiClient.makeWith(BookkeeperHttpApi, {
        baseUrl: "http://bookkeeper.internal",
        httpClient: Cloudflare.toHttpClient(namespace.getByName(BOOKKEEPER_ID)),
      }),
    ),
  );

  const listWorkspaces = Effect.fn("BookkeeperClient.listWorkspaces")(
    function* (request: PaginationRequest) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.listWorkspaces({ query: request });
    },
    Effect.catchTags({
      ListWorkspacesError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new ListWorkspacesError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to list Workspaces",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new ListWorkspacesError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to list Workspaces",
          }),
        ),
    }),
  );

  const getWorkspace = Effect.fn("BookkeeperClient.getWorkspace")(
    function* (id: WorkspaceId) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.getWorkspace({ params: { workspaceId: id } });
    },
    Effect.catchTags({
      GetWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new GetWorkspaceError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to get Workspace",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new GetWorkspaceError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to get Workspace",
          }),
        ),
    }),
  );

  const registerWorkspace = Effect.fn("BookkeeperClient.registerWorkspace")(
    function* (workspace: BookkeeperWorkspace) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.registerWorkspace({
        params: { workspaceId: workspace.id },
        payload: workspace,
      });
    },
    Effect.catchTags({
      RegisterWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new RegisterWorkspaceError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to register Workspace",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new RegisterWorkspaceError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to register Workspace",
          }),
        ),
    }),
  );

  const deleteWorkspace = Effect.fn("BookkeeperClient.deleteWorkspace")(
    function* (id: WorkspaceId) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.deleteWorkspace({ params: { workspaceId: id } });
    },
    Effect.catchTags({
      DeleteWorkspaceError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new DeleteWorkspaceError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to delete Workspace",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new DeleteWorkspaceError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to delete Workspace",
          }),
        ),
    }),
  );

  const listProjects = Effect.fn("BookkeeperClient.listProjects")(
    function* (workspaceId: WorkspaceId, request: PaginationRequest) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.listProjects({
        query: { workspaceId, cursor: request.cursor, limit: request.limit },
      });
    },
    Effect.catchTags({
      ListProjectsError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new ListProjectsError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to list Projects",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new ListProjectsError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to list Projects",
          }),
        ),
    }),
  );

  const getProject = Effect.fn("BookkeeperClient.getProject")(
    function* (id: ProjectId) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.getProject({ params: { projectId: id } });
    },
    Effect.catchTags({
      GetProjectError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new GetProjectError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to get Project",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new GetProjectError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to get Project",
          }),
        ),
    }),
  );

  const registerProject = Effect.fn("BookkeeperClient.registerProject")(
    function* (project: BookkeeperProject) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.registerProject({
        params: { projectId: project.id },
        payload: project,
      });
    },
    Effect.catchTags({
      RegisterProjectError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new RegisterProjectError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to register Project",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new RegisterProjectError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to register Project",
          }),
        ),
    }),
  );

  const deleteProject = Effect.fn("BookkeeperClient.deleteProject")(
    function* (id: ProjectId) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.deleteProject({ params: { projectId: id } });
    },
    Effect.catchTags({
      DeleteProjectError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new DeleteProjectError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to delete Project",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new DeleteProjectError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to delete Project",
          }),
        ),
    }),
  );

  const listIssues = Effect.fn("BookkeeperClient.listIssues")(
    function* (projectId: ProjectId, request: PaginationRequest) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.listIssues({
        query: { projectId, cursor: request.cursor, limit: request.limit },
      });
    },
    Effect.catchTags({
      ListIssuesError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new ListIssuesError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to list Issues",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new ListIssuesError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to list Issues",
          }),
        ),
    }),
  );

  const getIssue = Effect.fn("BookkeeperClient.getIssue")(
    function* (id: IssueId) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.getIssue({ params: { issueId: id } });
    },
    Effect.catchTags({
      GetIssueError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new GetIssueError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to get Issue",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new GetIssueError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to get Issue",
          }),
        ),
    }),
  );

  const registerIssue = Effect.fn("BookkeeperClient.registerIssue")(
    function* (issue: BookkeeperIssue) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.registerIssue({
        params: { issueId: issue.id },
        payload: issue,
      });
    },
    Effect.catchTags({
      RegisterIssueError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new RegisterIssueError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to register Issue",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new RegisterIssueError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to register Issue",
          }),
        ),
    }),
  );

  const deleteIssue = Effect.fn("BookkeeperClient.deleteIssue")(
    function* (id: IssueId) {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.deleteIssue({ params: { issueId: id } });
    },
    Effect.catchTags({
      DeleteIssueError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new DeleteIssueError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to delete Issue",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new DeleteIssueError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to delete Issue",
          }),
        ),
    }),
  );

  const getCounts = Effect.fn("BookkeeperClient.getCounts")(
    function* () {
      const client = yield* bookkeeperHttpClient;
      return yield* client.bookkeeper.getCounts();
    },
    Effect.catchTags({
      GetBookkeeperCountsError: (error) => Effect.fail(error),
      SchemaError: () =>
        Effect.fail(
          new GetBookkeeperCountsError({
            reason: "StoredDataInvalid",
            message: "Bookkeeper client failed to count live entities",
          }),
        ),
      HttpClientError: () =>
        Effect.fail(
          new GetBookkeeperCountsError({
            reason: "PersistenceFailed",
            message: "Bookkeeper client failed to count live entities",
          }),
        ),
    }),
  );

  return BookkeeperClient.of({
    listWorkspaces,
    getWorkspace,
    registerWorkspace,
    deleteWorkspace,
    listProjects,
    getProject,
    registerProject,
    deleteProject,
    listIssues,
    getIssue,
    registerIssue,
    deleteIssue,
    getCounts,
  });
});

/** Provides the Bookkeeper client while leaving Durable Object binding selection visible. */
export const bookkeeperClientLayerWithoutDependencies = Layer.effect(
  BookkeeperClient,
  makeBookkeeperClient,
);

/** Provides the Bookkeeper client and hosts its Durable Object implementation. */
export const bookkeeperClientLayer = bookkeeperClientLayerWithoutDependencies.pipe(
  Layer.provide(bookkeeperServerLayer),
);
