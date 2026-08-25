import { SqliteClient } from "@effect/sql-sqlite-do";
import * as Cloudflare from "alchemy/Cloudflare";
import type { HttpEffect } from "alchemy/Http";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  BookkeeperDatabase,
  bookkeeperDatabaseLayerWithoutDependencies,
} from "./bookkeeper-database.ts";
import { withOverseerHttpObservability } from "../../overseer-http-observability.ts";
import { overseerHttpSpanNameLayer } from "../../overseer-http-span-names.ts";
import { durableObjectBaseHttpServerLayer } from "../durable-object-base-http-server-layer.ts";
import {
  BookkeeperHttpApi,
  RegisterIssueError,
  RegisterProjectError,
  RegisterWorkspaceError,
} from "./bookkeeper-http-api.ts";

/** Bookkeeper HTTP handlers that delegate parsed requests to Bookkeeper persistence. */
export const bookkeeperHttpHandlersLayer = HttpApiBuilder.group(
  BookkeeperHttpApi,
  "bookkeeper",
  (handlers) =>
    Effect.gen(function* () {
      const database = yield* BookkeeperDatabase;

      return handlers
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
        .handle("getCounts", () => database.getCounts());
    }),
);

interface BookkeeperServerContract {
  readonly fetch: HttpEffect;
}

/** Singleton Durable Object namespace for Bookkeeper registration and directory operations. */
export class BookkeeperServer extends Cloudflare.DurableObject<
  BookkeeperServer,
  BookkeeperServerContract
>()("BookkeeperServer") {}

/** Hosts the Bookkeeper Durable Object implementation in the current Worker. */
const bookkeeperServerLayer: Layer.Layer<BookkeeperServer, never, Cloudflare.Worker> =
  BookkeeperServer.make<never>(
    Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;
      const bookkeeperDatabaseLayer = bookkeeperDatabaseLayerWithoutDependencies.pipe(
        Layer.provide(SqliteClient.layer({ storage: state.raw.storage })),
      );
      const bookkeeperHandlersLayer = bookkeeperHttpHandlersLayer.pipe(
        Layer.provide(bookkeeperDatabaseLayer),
      );

      return Effect.gen(function* () {
        const httpLayer = HttpApiBuilder.layer(BookkeeperHttpApi).pipe(
          Layer.provide(bookkeeperHandlersLayer),
          Layer.provide(durableObjectBaseHttpServerLayer),
        );
        const fetch = yield* HttpRouter.toHttpEffect(httpLayer);
        return {
          fetch: withOverseerHttpObservability(fetch, "bookkeeper-durable-object"),
        };
      }).pipe(Effect.orDie);
    }),
  ).pipe(Layer.provideMerge(overseerHttpSpanNameLayer));

export default bookkeeperServerLayer;
