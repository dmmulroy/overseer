import { assert } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import * as FastCheck from "effect/testing/FastCheck";
import { WorkspaceId, WorkspaceName } from "../../src/domain/workspace.ts";
import { WorkspaceNotFoundApiError } from "../../src/overseer-http-api.ts";
import { OverseerApiClient } from "./overseer-api-client.ts";
import type { OverseerTestHarness } from "./overseer-test-harness.ts";

const workspaceNameArbitrary = Schema.toArbitrary(WorkspaceName)(FastCheck);
const workspaceLifecycleNames = FastCheck.tuple(
  workspaceNameArbitrary,
  workspaceNameArbitrary,
).filter(([initialName, renamedName]) => initialName !== renamedName);

const sampleWorkspaceLifecycleNames = (): readonly [WorkspaceName, WorkspaceName] => {
  const names = FastCheck.sample(workspaceLifecycleNames, {
    numRuns: 1,
    seed: 0x5eed,
  })[0];
  if (names === undefined) {
    throw new Error("Workspace lifecycle mock-data generator returned no sample");
  }
  return names;
};

/** Registers deterministic Workspace guarantees against the selected Stack. */
export const registerWorkspaceTestSuite = (harness: OverseerTestHarness): void => {
  harness.test(
    "a Workspace completes its persisted lifecycle",
    Effect.gen(function* () {
      const client = yield* OverseerApiClient;
      const [initialName, renamedName] = sampleWorkspaceLifecycleNames();

      const created = yield* client.overseer.createWorkspace({
        payload: { name: initialName },
      });
      const initialRead = yield* client.overseer.getWorkspace({
        params: { workspaceId: created.id },
      });
      const renamed = yield* client.overseer.renameWorkspace({
        params: { workspaceId: created.id },
        payload: { name: renamedName },
      });
      const archived = yield* client.overseer.archiveWorkspace({
        params: { workspaceId: created.id },
      });
      const archivedRead = yield* client.overseer.getWorkspace({
        params: { workspaceId: created.id },
      });
      const unarchived = yield* client.overseer.unarchiveWorkspace({
        params: { workspaceId: created.id },
      });
      const activeRead = yield* client.overseer.getWorkspace({
        params: { workspaceId: created.id },
      });

      assert.deepStrictEqual(initialRead, created);
      assert.strictEqual(renamed.id, created.id);
      assert.strictEqual(renamed.name, renamedName);
      assert.strictEqual(renamed.state, "active");
      assert.deepStrictEqual(archivedRead, archived);
      assert.strictEqual(archived.state, "archived");
      assert.deepStrictEqual(activeRead, unarchived);
      assert.strictEqual(activeRead.id, created.id);
      assert.strictEqual(activeRead.name, renamedName);
      assert.strictEqual(activeRead.state, "active");
      assert.deepStrictEqual(activeRead.createdAt, created.createdAt);

      const updateTimes = [created, renamed, archived, unarchived].map((workspace) =>
        DateTime.toEpochMillis(workspace.updatedAt),
      );
      for (let index = 1; index < updateTimes.length; index += 1) {
        const previous = updateTimes[index - 1];
        const current = updateTimes[index];
        if (previous === undefined || current === undefined) {
          return assert.fail("Expected complete Workspace update timestamps");
        }
        assert.ok(current >= previous);
      }
    }),
    { timeout: 120_000 },
  );

  harness.test(
    "a valid unknown Workspace ID returns the public not-found contract",
    Effect.gen(function* () {
      const client = yield* OverseerApiClient;
      const workspaceId = WorkspaceId.make("workspace_00000000000000000000000000");

      const error = yield* client.overseer
        .getWorkspace({ params: { workspaceId } })
        .pipe(Effect.flip);

      if (!(error instanceof WorkspaceNotFoundApiError)) {
        return assert.fail("Expected the public Workspace not-found error");
      }
      assert.strictEqual(error.code, "workspace_not_found");
      assert.strictEqual(error.retryable, false);
      assert.strictEqual(error.details.workspaceId, workspaceId);
      assert.strictEqual(error.details.operation, "get");
      assert.match(error.message, new RegExp(workspaceId));
    }),
    { timeout: 120_000 },
  );
};
