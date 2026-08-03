import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Layer, Option, Path, Ref } from "effect";
import { Etag, HttpPlatform } from "effect/unstable/http";
import { HttpApiTest } from "effect/unstable/httpapi";
import {
  ArchiveWorkspaceError,
  CreateWorkspaceError,
  GetWorkspaceError,
  RenameWorkspaceError,
  UnarchiveWorkspaceError,
  Workspace,
  WorkspaceId,
  WorkspaceName,
  type WorkspaceState,
} from "../../domain/workspace.ts";
import { WorkspaceDatabase } from "./workspace-database.ts";
import { workspaceHttpHandlersLayer } from "./workspace-http-handlers.ts";
import { WorkspaceHttpApi } from "./workspace-http-api.ts";

const firstWorkspaceId = WorkspaceId.make("workspace_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const secondWorkspaceId = WorkspaceId.make("workspace_01ARZ3NDEKTSV4RRFFQ69G5FAW");
const initialName = WorkspaceName.make("Platform Engineering");
const renamedName = WorkspaceName.make("Runtime Engineering");
const createdAt = DateTime.makeUnsafe("2026-08-03T12:00:00.000Z");
const updatedAt = DateTime.makeUnsafe("2026-08-03T12:01:00.000Z");

const workspaceHttpPlatformTestLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("Workspace HTTP test file responses are not supported"),
  fileWebResponse: () => Effect.die("Workspace HTTP test web file responses are not supported"),
});

const workspaceDatabaseTestLayer = Layer.effect(
  WorkspaceDatabase,
  Effect.gen(function* () {
    const storedWorkspace = yield* Ref.make<Option.Option<Workspace>>(Option.none());

    const updateWorkspace = Effect.fn("WorkspaceDatabase.Test.updateWorkspace")(function* (input: {
      readonly name: Workspace["name"];
      readonly state: WorkspaceState;
    }) {
      const current = yield* Ref.get(storedWorkspace);
      if (Option.isNone(current)) {
        return Option.none<Workspace>();
      }
      const updated = Workspace.make({
        ...current.value,
        name: input.name,
        state: input.state,
        updatedAt,
      });
      yield* Ref.set(storedWorkspace, Option.some(updated));
      return Option.some(updated);
    });

    return WorkspaceDatabase.of({
      createWorkspace: Effect.fn("WorkspaceDatabase.Test.createWorkspace")(function* (input) {
        const current = yield* Ref.get(storedWorkspace);
        if (Option.isSome(current)) {
          return current.value.id === input.id
            ? current.value
            : yield* Effect.fail(new CreateWorkspaceError({ reason: "workspace_id_mismatch" }));
        }
        const workspace = Workspace.make({
          id: input.id,
          name: input.name,
          state: "active",
          createdAt,
          updatedAt: createdAt,
        });
        yield* Ref.set(storedWorkspace, Option.some(workspace));
        return workspace;
      }),
      getWorkspace: Ref.get(storedWorkspace),
      renameWorkspace: Effect.fn("WorkspaceDatabase.Test.renameWorkspace")(function* (name) {
        const current = yield* Ref.get(storedWorkspace);
        const renamed = yield* updateWorkspace({
          name,
          state: Option.isSome(current) ? current.value.state : "active",
        });
        return yield* Effect.fromOption(
          renamed,
          () => new RenameWorkspaceError({ reason: "workspace_not_found" }),
        );
      }),
      archiveWorkspace: Effect.gen(function* () {
        const current = yield* Ref.get(storedWorkspace);
        const archived = yield* updateWorkspace({
          name: Option.isSome(current) ? current.value.name : initialName,
          state: "archived",
        });
        return yield* Effect.fromOption(
          archived,
          () => new ArchiveWorkspaceError({ reason: "workspace_not_found" }),
        );
      }),
      unarchiveWorkspace: Effect.gen(function* () {
        const current = yield* Ref.get(storedWorkspace);
        const active = yield* updateWorkspace({
          name: Option.isSome(current) ? current.value.name : initialName,
          state: "active",
        });
        return yield* Effect.fromOption(
          active,
          () => new UnarchiveWorkspaceError({ reason: "workspace_not_found" }),
        );
      }),
    });
  }),
);

const workspaceHttpTestLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Etag.layer,
  workspaceHttpPlatformTestLayer,
  Path.layer,
);

const workspaceHttpHandlersTestLayer = workspaceHttpHandlersLayer.pipe(
  Layer.provide(workspaceDatabaseTestLayer),
);

const makeWorkspaceHttpTestClient = HttpApiTest.groups(WorkspaceHttpApi, ["workspace"]).pipe(
  Effect.provide(workspaceHttpHandlersTestLayer),
);

describe("Workspace HTTP API", () => {
  it.effect("creates, reads, renames, archives, and unarchives one Workspace", () =>
    Effect.gen(function* () {
      const client = yield* makeWorkspaceHttpTestClient;
      const created = yield* client.workspace.createWorkspace({
        payload: { id: firstWorkspaceId, name: initialName },
      });
      const read = yield* client.workspace.getWorkspace();
      const renamed = yield* client.workspace.renameWorkspace({
        payload: { name: renamedName },
      });
      const archived = yield* client.workspace.archiveWorkspace();
      const active = yield* client.workspace.unarchiveWorkspace();

      expect(created.id).toBe(firstWorkspaceId);
      expect(read).toEqual(created);
      expect(renamed.name).toBe(renamedName);
      expect(archived.state).toBe("archived");
      expect(active.state).toBe("active");
    }).pipe(Effect.provide(workspaceHttpTestLayer)),
  );

  it.effect("returns typed failures for operations before initialization", () =>
    Effect.gen(function* () {
      const client = yield* makeWorkspaceHttpTestClient;
      const getError = yield* client.workspace.getWorkspace().pipe(Effect.flip);
      const renameError = yield* client.workspace
        .renameWorkspace({ payload: { name: renamedName } })
        .pipe(Effect.flip);
      const archiveError = yield* client.workspace.archiveWorkspace().pipe(Effect.flip);
      const unarchiveError = yield* client.workspace.unarchiveWorkspace().pipe(Effect.flip);

      expect(getError).toEqual(new GetWorkspaceError({ reason: "workspace_not_found" }));
      expect(renameError).toEqual(new RenameWorkspaceError({ reason: "workspace_not_found" }));
      expect(archiveError).toEqual(new ArchiveWorkspaceError({ reason: "workspace_not_found" }));
      expect(unarchiveError).toEqual(
        new UnarchiveWorkspaceError({ reason: "workspace_not_found" }),
      );
    }).pipe(Effect.provide(workspaceHttpTestLayer)),
  );

  it.effect("keeps initialization idempotent and rejects a different identity", () =>
    Effect.gen(function* () {
      const client = yield* makeWorkspaceHttpTestClient;
      const created = yield* client.workspace.createWorkspace({
        payload: { id: firstWorkspaceId, name: initialName },
      });
      const repeated = yield* client.workspace.createWorkspace({
        payload: { id: firstWorkspaceId, name: renamedName },
      });
      const mismatch = yield* client.workspace
        .createWorkspace({
          payload: { id: secondWorkspaceId, name: initialName },
        })
        .pipe(Effect.flip);

      expect(repeated).toEqual(created);
      expect(mismatch).toEqual(new CreateWorkspaceError({ reason: "workspace_id_mismatch" }));
    }).pipe(Effect.provide(workspaceHttpTestLayer)),
  );
});
