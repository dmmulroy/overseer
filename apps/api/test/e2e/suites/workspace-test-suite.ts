import { DateTime, Effect } from "effect";
import { WorkspaceId } from "../../../src/domain/workspace.ts";
import { WorkspaceNotFoundApiError } from "../../../src/overseer-http-api.ts";
import type { OverseerTestHarness } from "../harness/overseer-test-harness.ts";

/** Registers deterministic Workspace guarantees against the selected Stack. */
export const registerWorkspaceTestSuite = (harness: OverseerTestHarness): void => {
  harness.test(
    "a Workspace completes its persisted lifecycle",
    ({ assert, client, fixtures }) =>
      Effect.gen(function* () {
        const { initialName, renamedName } = fixtures.scenarios.workspaceRename.make();

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

        assert.deepEqual("the first read returns the created Workspace", initialRead, created);
        assert.equal("renaming preserves the Workspace identity", renamed.id, created.id);
        assert.equal("renaming applies the requested Workspace name", renamed.name, renamedName);
        assert.equal("renaming preserves the active lifecycle state", renamed.state, "active");
        assert.deepEqual("the archived Workspace persists across reads", archivedRead, archived);
        assert.equal("archiving changes the Workspace lifecycle state", archived.state, "archived");
        assert.deepEqual("the unarchived Workspace persists across reads", activeRead, unarchived);
        assert.equal("unarchiving preserves the Workspace identity", activeRead.id, created.id);
        assert.equal(
          "unarchiving preserves the renamed Workspace name",
          activeRead.name,
          renamedName,
        );
        assert.equal("unarchiving restores the active lifecycle state", activeRead.state, "active");
        assert.deepEqual(
          "the complete lifecycle preserves the Workspace creation time",
          activeRead.createdAt,
          created.createdAt,
        );

        const updateTimes = [created, renamed, archived, unarchived].map((workspace) =>
          DateTime.toEpochMillis(workspace.updatedAt),
        );
        assert.each("Workspace update timestamps", updateTimes.slice(1), (current, index) => {
          const previous = assert.isDefined(
            "the previous Workspace update timestamp exists",
            updateTimes[index],
          );
          assert.greaterThanOrEqual(
            "the Workspace update timestamp does not move backwards",
            current,
            previous,
          );
        });
      }),
    { timeout: 120_000 },
  );

  harness.test(
    "a valid unknown Workspace ID returns the public not-found contract",
    ({ assert, client }) =>
      Effect.gen(function* () {
        const workspaceId = WorkspaceId.make("workspace_00000000000000000000000000");

        const unknownError = yield* client.overseer
          .getWorkspace({ params: { workspaceId } })
          .pipe(Effect.flip);

        const error = assert.instanceOf(
          "an unknown Workspace returns the public not-found error",
          unknownError,
          WorkspaceNotFoundApiError,
        );
        assert.equal(
          "the not-found error uses the stable public code",
          error.code,
          "workspace_not_found",
        );
        assert.isFalse("the not-found error is not retryable", error.retryable);
        assert.equal(
          "the not-found error identifies the requested Workspace",
          error.details.workspaceId,
          workspaceId,
        );
        assert.equal(
          "the not-found error identifies the get operation",
          error.details.operation,
          "get",
        );
        assert.containsText(
          "the not-found message identifies the requested Workspace",
          error.message,
          workspaceId,
        );
      }),
    { timeout: 120_000 },
  );
};
