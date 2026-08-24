import { assert, describe, it } from "@effect/vitest";
import { WorkspaceName } from "../../../src/domain/workspace.ts";
import { createOverseerFixtureRegistry } from "./overseer-fixture-registry.ts";

describe("Fixture registry", () => {
  it("reproduces generated model sequences", () => {
    const firstRegistry = createOverseerFixtureRegistry();
    const secondRegistry = createOverseerFixtureRegistry();

    const firstWorkspaceRenames = firstRegistry.scenarios.workspaceRename.makeMany(2);
    const secondWorkspaceRenames = secondRegistry.scenarios.workspaceRename.makeMany(2);
    const firstWorkspace = firstRegistry.models.workspace.make();
    const secondWorkspace = secondRegistry.models.workspace.make();

    assert.deepStrictEqual(secondWorkspaceRenames, firstWorkspaceRenames);
    assert.deepStrictEqual(secondWorkspace, firstWorkspace);
    for (const workspaceRename of firstWorkspaceRenames) {
      assert.notStrictEqual(workspaceRename.renamedName, workspaceRename.initialName);
    }
  });

  it("applies typed model overrides", () => {
    const fixtures = createOverseerFixtureRegistry();
    const initialName = WorkspaceName.make("Initial Workspace");
    const workspaceName = WorkspaceName.make("Overridden Workspace");

    const workspaceRename = fixtures.scenarios.workspaceRename.make({ initialName });
    const workspace = fixtures.models.workspace.make({ name: workspaceName });

    assert.strictEqual(workspaceRename.initialName, initialName);
    assert.strictEqual(workspace.name, workspaceName);
  });
});
