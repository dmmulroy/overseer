import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vite-plus/test";
import { UlidGeneratorService } from "../../src/application/ulid-generator.ts";
import {
  IdempotencyFingerprint,
  layer as workspaceRegistryLayer,
  type RetainedWorkspaceCreation,
  WorkspaceRegistryLocalService,
  WorkspaceRegistryStateService,
} from "../../src/application/workspace-registry/workspace-registry.ts";
import { WorkspaceId } from "../../src/domain/entity-id.ts";
import { IdempotencyKey, IdempotencyScope } from "../../src/domain/idempotency.ts";
import { Ulid } from "../../src/domain/ulid.ts";
import {
  Workspace,
  WorkspaceName,
  WorkspaceTimestamp,
  type Workspace as WorkspaceType,
} from "../../src/domain/workspace.ts";

const fixedUlid = Ulid.make("01J00000000000000000000000");
const fixedWorkspaceId = WorkspaceId.make(`workspace_${fixedUlid}`);
const initialTimestamp = WorkspaceTimestamp.make("2024-01-01T00:00:00.000Z");

const fixedUlidLayer = Layer.succeed(
  UlidGeneratorService,
  UlidGeneratorService.of({
    next: Effect.fn("UlidGenerator.Fixed.next")(() => Effect.succeed(fixedUlid)),
  }),
);

function workspace(name: string): WorkspaceType {
  return Workspace.make({
    id: fixedWorkspaceId,
    name: WorkspaceName.make(name),
    lifecycle: "active",
    createdAt: initialTimestamp,
    updatedAt: initialTimestamp,
  });
}

function applicationHarness(
  options: {
    readonly retained?: Option.Option<RetainedWorkspaceCreation>;
    readonly workspace?: Option.Option<WorkspaceType>;
  } = {},
) {
  let retained = options.retained ?? Option.none();
  let storedWorkspace = options.workspace ?? Option.none();
  let updateCount = 0;
  const StateLive = Layer.succeed(
    WorkspaceRegistryStateService,
    WorkspaceRegistryStateService.of({
      transaction: (effect) => effect,
      listWorkspaces: () => Effect.die("not used"),
      listProjects: () => Effect.die("not used"),
      findIdempotencyFingerprint: () =>
        Effect.succeed(Option.map(retained, (value) => value.fingerprint)),
      findWorkspaceCreation: () => Effect.succeed(retained),
      findProjectCreation: () => Effect.succeed(Option.none()),
      insertWorkspaceCreation: (created, _scope, _key, fingerprint) =>
        Effect.sync(() => {
          storedWorkspace = Option.some(created);
          retained = Option.some({ workspace: created, fingerprint });
        }),
      findWorkspace: () => Effect.succeed(storedWorkspace),
      findProject: () => Effect.succeed(Option.none()),
      insertProjectCreation: () => Effect.die("not used"),
      updateWorkspaceName: (updated) =>
        Effect.sync(() => {
          updateCount += 1;
          storedWorkspace = Option.some(updated);
        }),
      updateProjectName: () => Effect.die("not used"),
    }),
  );
  return {
    layer: workspaceRegistryLayer.pipe(Layer.provide([StateLive, fixedUlidLayer])),
    updateCount: () => updateCount,
  };
}

const input = {
  name: WorkspaceName.make("Personal"),
  idempotencyScope: IdempotencyScope.make("human:owner"),
  idempotencyKey: IdempotencyKey.make("create-personal"),
};

describe("Workspace Registry application", () => {
  it("creates once and replays the retained result through its application seam", async () => {
    const harness = applicationHarness();
    const program = Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2024-02-03T04:05:06.789Z"));
      const registry = yield* WorkspaceRegistryLocalService;
      const created = yield* registry.createWorkspace(input);
      const replayed = yield* registry.createWorkspace(input);
      return { created, replayed };
    }).pipe(Effect.provide([harness.layer, TestClock.layer()]));

    const { created, replayed } = await Effect.runPromise(program);
    expect(created).toMatchObject({
      replayed: false,
      workspace: {
        id: fixedWorkspaceId,
        name: "Personal",
        createdAt: "2024-02-03T04:05:06.789Z",
        updatedAt: "2024-02-03T04:05:06.789Z",
      },
    });
    expect(replayed).toEqual({
      workspace: created.workspace,
      replayed: true,
    });
  });

  it("keeps conflicting idempotency reuse in the typed error channel", async () => {
    const firstHarness = applicationHarness();
    const first = await Effect.runPromise(
      WorkspaceRegistryLocalService.pipe(
        Effect.andThen((registry) => registry.createWorkspace(input)),
        Effect.provide(firstHarness.layer),
      ),
    );
    const retained = Option.some({
      workspace: first.workspace,
      fingerprint: IdempotencyFingerprint.make('["CreateWorkspace","Different"]'),
    });
    const result = await Effect.runPromise(
      WorkspaceRegistryLocalService.pipe(
        Effect.andThen((registry) => registry.createWorkspace(input)),
        Effect.result,
        Effect.provide(applicationHarness({ retained }).layer),
      ),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("IdempotencyKeyReused");
    }
  });

  it("renames and strictly advances updatedAt when the clock has not advanced", async () => {
    const harness = applicationHarness({ workspace: Option.some(workspace("Before")) });
    const renamed = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(initialTimestamp));
        const registry = yield* WorkspaceRegistryLocalService;
        return yield* registry.renameWorkspace(fixedWorkspaceId, WorkspaceName.make("After"));
      }).pipe(Effect.provide([harness.layer, TestClock.layer()])),
    );

    expect(renamed.name).toBe("After");
    expect(renamed.updatedAt).toBe("2024-01-01T00:00:00.001Z");
    expect(harness.updateCount()).toBe(1);
  });

  it("returns an unchanged Workspace without reading time or writing on rename no-op", async () => {
    const current = workspace("Same");
    const harness = applicationHarness({ workspace: Option.some(current) });
    const renamed = await Effect.runPromise(
      WorkspaceRegistryLocalService.pipe(
        Effect.andThen((registry) =>
          registry.renameWorkspace(fixedWorkspaceId, WorkspaceName.make("Same")),
        ),
        Effect.provide(harness.layer),
      ),
    );

    expect(renamed).toEqual(current);
    expect(harness.updateCount()).toBe(0);
  });

  it("returns the requested WorkspaceId with rename not-found", async () => {
    const harness = applicationHarness();
    const result = await Effect.runPromise(
      WorkspaceRegistryLocalService.pipe(
        Effect.andThen((registry) =>
          registry.renameWorkspace(fixedWorkspaceId, WorkspaceName.make("Missing")),
        ),
        Effect.result,
        Effect.provide(harness.layer),
      ),
    );

    expect(result).toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: "WorkspaceNotFound",
          workspaceId: fixedWorkspaceId,
        }),
      ),
    );
  });
});
