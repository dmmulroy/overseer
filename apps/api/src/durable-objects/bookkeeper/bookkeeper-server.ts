import { SqliteClient } from "@effect/sql-sqlite-do";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  BookkeeperDatabase,
  bookkeeperDatabaseLayerWithoutDependencies,
  type IBookkeeperDatabase,
} from "./bookkeeper-database.ts";
import {
  BookkeeperHttpApi,
  RegisterIssueError,
  RegisterProjectError,
  RegisterWorkspaceError,
} from "./bookkeeper-http-api.ts";

const bookkeeperHttpPlatformLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("Bookkeeper HTTP file responses are not supported"),
  fileWebResponse: () => Effect.die("Bookkeeper HTTP file responses are not supported"),
});

/** Build Bookkeeper HTTP handlers around one already-initialized database capability. */
export const makeBookkeeperHttpHandlersLayer = (database: IBookkeeperDatabase) =>
  HttpApiBuilder.group(BookkeeperHttpApi, "bookkeeper", (handlers) =>
    handlers
      .handle("listWorkspaces", ({ query }) => database.listWorkspaces(query))
      .handle("getWorkspace", ({ params }) => database.getWorkspace(params.workspaceId))
      .handle("registerWorkspace", ({ params, payload }) => {
        if (params.workspaceId !== payload.id) {
          return Effect.fail(
            new RegisterWorkspaceError({
              reason: "IdentityMismatch",
              message: "Bookkeeper Workspace path and payload identities must match",
            }),
          );
        }
        return database.registerWorkspace(payload);
      })
      .handle("deleteWorkspace", ({ params }) => database.deleteWorkspace(params.workspaceId))
      .handle("listProjects", ({ query }) => database.listProjects(query.workspaceId, query))
      .handle("getProject", ({ params }) => database.getProject(params.projectId))
      .handle("registerProject", ({ params, payload }) => {
        if (params.projectId !== payload.id) {
          return Effect.fail(
            new RegisterProjectError({
              reason: "IdentityMismatch",
              message: "Bookkeeper Project path and payload identities must match",
            }),
          );
        }
        return database.registerProject(payload);
      })
      .handle("deleteProject", ({ params }) => database.deleteProject(params.projectId))
      .handle("listIssues", ({ query }) => database.listIssues(query.projectId, query))
      .handle("getIssue", ({ params }) => database.getIssue(params.issueId))
      .handle("registerIssue", ({ params, payload }) => {
        if (params.issueId !== payload.id) {
          return Effect.fail(
            new RegisterIssueError({
              reason: "IdentityMismatch",
              message: "Bookkeeper Issue path and payload identities must match",
            }),
          );
        }
        return database.registerIssue(payload);
      })
      .handle("deleteIssue", ({ params }) => database.deleteIssue(params.issueId))
      .handle("getCounts", () => database.getCounts),
  );

/** Singleton Durable Object HTTP server for Bookkeeper registration and directory operations. */
export class BookkeeperServer extends Cloudflare.DurableObject<BookkeeperServer>()(
  "BookkeeperServer",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const bookkeeperDatabaseLayer = bookkeeperDatabaseLayerWithoutDependencies.pipe(
      Layer.provide(SqliteClient.layer({ storage: state.raw.storage })),
    );

    return Effect.gen(function* () {
      const database = yield* BookkeeperDatabase;
      const httpLayer = HttpApiBuilder.layer(BookkeeperHttpApi).pipe(
        Layer.provide(makeBookkeeperHttpHandlersLayer(database)),
        Layer.provide([
          Etag.layer,
          FileSystem.layerNoop({}),
          bookkeeperHttpPlatformLayer,
          Path.layer,
        ]),
      );
      const fetch = yield* HttpRouter.toHttpEffect(httpLayer);
      return { fetch };
    }).pipe(Effect.provide(bookkeeperDatabaseLayer), Effect.orDie);
  }),
) {}
