import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vite-plus/test";
import { UlidGeneratorService } from "../../src/application/ulid-generator.ts";
import {
  layer as workspaceRegistryLayer,
  type RecordedCreation,
  WorkspaceRegistryLocalService,
  WorkspaceRegistryStateService,
} from "../../src/application/workspace-registry/workspace-registry.ts";
import { ProjectId, WorkspaceId } from "../../src/domain/entity-id.ts";
import { IdempotencyKey } from "../../src/domain/idempotency.ts";
import { Project, ProjectName, ProjectTimestamp } from "../../src/domain/project.ts";
import { Ulid } from "../../src/domain/ulid.ts";
import {
  Workspace,
  WorkspaceName,
  WorkspaceTimestamp,
  type Workspace as WorkspaceType,
} from "../../src/domain/workspace.ts";

const fixedUlid = Ulid.make("01J00000000000000000000000");
const fixedWorkspaceId = WorkspaceId.make(`workspace_${fixedUlid}`);
const fixedProjectId = ProjectId.make(`project_${fixedUlid}`);
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
    readonly recordedCreation?: Option.Option<RecordedCreation>;
    readonly workspace?: Option.Option<WorkspaceType>;
  } = {},
) {
  let recordedCreation = options.recordedCreation ?? Option.none();
  let storedWorkspace = options.workspace ?? Option.none();
  let updateCount = 0;
  const StateLive = Layer.succeed(
    WorkspaceRegistryStateService,
    WorkspaceRegistryStateService.of({
      transaction: (effect) => effect,
      listWorkspaces: () => Effect.die("not used"),
      listProjects: () => Effect.die("not used"),
      findRecordedCreation: () => Effect.succeed(recordedCreation),
      insertWorkspaceCreation: (created) =>
        Effect.sync(() => {
          storedWorkspace = Option.some(created);
          recordedCreation = Option.some({ _tag: "WorkspaceCreation", workspace: created });
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
  idempotencyKey: IdempotencyKey.make("create-personal"),
};

describe("Workspace Registry application", () => {
  it("creates once and replays the recorded result through its application seam", async () => {
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

  it("keeps cross-result-type idempotency reuse in the typed error channel", async () => {
    const project = Project.make({
      id: fixedProjectId,
      workspaceId: fixedWorkspaceId,
      name: ProjectName.make("Existing Project"),
      lifecycle: "active",
      createdAt: ProjectTimestamp.make(initialTimestamp),
      updatedAt: ProjectTimestamp.make(initialTimestamp),
    });
    const result = await Effect.runPromise(
      WorkspaceRegistryLocalService.pipe(
        Effect.andThen((registry) => registry.createWorkspace(input)),
        Effect.result,
        Effect.provide(
          applicationHarness({
            recordedCreation: Option.some({ _tag: "ProjectCreation", project }),
          }).layer,
        ),
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
