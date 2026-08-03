import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Ref } from "effect";
import { Etag, HttpPlatform, HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { WorkspaceId } from "../../domain/workspace.ts";
import { makeWorkspaceClient } from "./workspace-client.ts";
import { WorkspaceDatabase } from "./workspace-database.ts";
import { workspaceHttpHandlersLayer } from "./workspace-http-handlers.ts";
import { WorkspaceHttpApi } from "./workspace-http-api.ts";

const workspaceId = WorkspaceId.make("workspace_01ARZ3NDEKTSV4RRFFQ69G5FAV");

const workspaceHttpPlatformTestLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("Workspace client test file responses are not supported"),
  fileWebResponse: () => Effect.die("Workspace client test web file responses are not supported"),
});

const workspaceClientHttpLayer = HttpApiBuilder.layer(WorkspaceHttpApi).pipe(
  Layer.provide(
    workspaceHttpHandlersLayer.pipe(
      Layer.provide(
        Layer.mock(WorkspaceDatabase, {
          getWorkspace: Effect.succeed(Option.none()),
        }),
      ),
    ),
  ),
  Layer.provide(FileSystem.layerNoop({})),
  Layer.provide(Etag.layer),
  Layer.provide(workspaceHttpPlatformTestLayer),
  Layer.provide(Path.layer),
);

it.effect("uses the Workspace identity as the Durable Object name and maps absence", () =>
  Effect.gen(function* () {
    const requestedNames = yield* Ref.make<ReadonlyArray<string>>([]);
    const workspaceHttpHandler = yield* HttpRouter.toHttpEffect(workspaceClientHttpLayer);
    const workspaceServerNamespace = {
      getByName: (name: string) => ({
        fetch: (request: HttpServerRequest.HttpServerRequest) =>
          Ref.update(requestedNames, (names) => [...names, name]).pipe(
            Effect.andThen(
              workspaceHttpHandler.pipe(
                Effect.provideService(HttpServerRequest.HttpServerRequest, request),
                Effect.scoped,
              ),
            ),
          ),
      }),
    };
    const workspaceClient = yield* makeWorkspaceClient(workspaceServerNamespace);

    const workspace = yield* workspaceClient.getWorkspace(workspaceId);

    expect(workspace).toEqual(Option.none());
    expect(yield* Ref.get(requestedNames)).toEqual([workspaceId]);
  }),
);
