import { SqliteClient } from "@effect/sql-sqlite-do";
import * as Cloudflare from "alchemy/Cloudflare";
import type { HttpEffect } from "alchemy/Http";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
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
>()("WorkspaceServer", {
  // Preserve Workspace SQLite when the hosting API Worker moves to a new physical script name.
  transferredFrom: "OverseerApi",
}) {}

/** Hosts the Workspace Durable Object with its instance-local SQLite database. */
export const workspaceServerLayerWithoutDependencies: Layer.Layer<
  WorkspaceServer,
  never,
  Cloudflare.Worker
> = WorkspaceServer.make<never>(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    const workspaceDatabaseLayer = workspaceDatabaseLayerWithoutDependencies.pipe(
      Layer.provide(SqliteClient.layer({ storage: state.raw.storage })),
    );
    const workspaceHandlersLayer = workspaceHttpHandlersLayer.pipe(
      Layer.provide(workspaceDatabaseLayer),
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

/** Hosts the production Workspace Durable Object implementation. */
const workspaceServerLayer = workspaceServerLayerWithoutDependencies.pipe(
  Layer.provideMerge(overseerHttpSpanNameLayer),
);

export default workspaceServerLayer;
