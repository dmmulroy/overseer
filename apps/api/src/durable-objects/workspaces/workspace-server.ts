import { SqliteClient } from "@effect/sql-sqlite-do";
import * as Cloudflare from "alchemy/Cloudflare";
import type { HttpEffect } from "alchemy/Http";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { BookkeeperClient, bookkeeperClientLayer } from "../bookkeeper/bookkeeper-client.ts";
import { durableObjectBaseHttpServerLayer } from "../durable-object-base-http-server-layer.ts";
import { workspaceDatabaseLayerWithoutDependencies } from "./workspace-database.ts";
import { workspaceHttpHandlersLayer } from "./workspace-http-handlers.ts";
import { withOverseerHttpObservability } from "../../overseer-http-observability.ts";
import { overseerHttpSpanNameLayer } from "../../overseer-http-span-names.ts";
import { WorkspaceHttpApi } from "./workspace-http-api.ts";

interface WorkspaceServerContract {
  readonly fetch: HttpEffect;
}

/** Durable Object namespace that owns one Workspace and exposes its versioned HTTP API. */
export class WorkspaceServer extends Cloudflare.DurableObject<
  WorkspaceServer,
  WorkspaceServerContract
>()("WorkspaceServer") {}

/** Hosts the Workspace Durable Object while preserving its Bookkeeper client requirement. */
export const workspaceServerLayerWithoutDependencies: Layer.Layer<
  WorkspaceServer,
  never,
  Cloudflare.Worker | BookkeeperClient
> = WorkspaceServer.make<BookkeeperClient>(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const bookkeeperClient = yield* BookkeeperClient;

    const workspaceDatabaseLayer = workspaceDatabaseLayerWithoutDependencies.pipe(
      Layer.provide(SqliteClient.layer({ storage: state.raw.storage })),
    );
    const workspaceHandlersLayer = workspaceHttpHandlersLayer.pipe(
      Layer.provide(workspaceDatabaseLayer),
      Layer.provide(Layer.succeed(BookkeeperClient, bookkeeperClient)),
    );

    return Effect.gen(function* () {
      const workspaceHttpLayer = HttpApiBuilder.layer(WorkspaceHttpApi).pipe(
        Layer.provide(workspaceHandlersLayer),
        Layer.provide(durableObjectBaseHttpServerLayer),
      );

      const fetch = yield* HttpRouter.toHttpEffect(workspaceHttpLayer);
      return {
        fetch: withOverseerHttpObservability(fetch, "workspace-durable-object"),
      };
    }).pipe(Effect.orDie);
  }),
);

/** Hosts the Workspace Durable Object with its production Bookkeeper client. */
const workspaceServerLayer = workspaceServerLayerWithoutDependencies.pipe(
  Layer.provide(bookkeeperClientLayer),
  Layer.provideMerge(overseerHttpSpanNameLayer),
);

export default workspaceServerLayer;
