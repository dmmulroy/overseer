import { SqliteClient } from "@effect/sql-sqlite-do";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { workspaceDatabaseLayerWithoutDependencies } from "./workspace-database.ts";
import { workspaceHttpHandlersLayer } from "./workspace-http-handlers.ts";
import { WorkspaceHttpApi } from "./workspace-http-api.ts";

const workspaceHttpPlatformLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("Workspace HTTP file responses are not supported"),
  fileWebResponse: () => Effect.die("Workspace HTTP web file responses are not supported"),
});

/** Alchemy Durable Object that owns one Workspace and exposes its versioned HTTP API. */
export class WorkspaceServer extends Cloudflare.DurableObject<WorkspaceServer>()(
  "WorkspaceServer",
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
        Layer.provide(FileSystem.layerNoop({})),
        Layer.provide(Etag.layer),
        Layer.provide(workspaceHttpPlatformLayer),
        Layer.provide(Path.layer),
      );

      const fetch = yield* HttpRouter.toHttpEffect(workspaceHttpLayer);
      return { fetch };
    }).pipe(Effect.orDie);
  }),
) {}
