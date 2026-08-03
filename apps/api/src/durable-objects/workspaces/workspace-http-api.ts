import { Schema } from "effect";
import {
  ArchiveWorkspaceError,
  CreateWorkspaceError,
  GetWorkspaceError,
  RenameWorkspaceError,
  UnarchiveWorkspaceError,
  Workspace,
  WorkspaceId,
  WorkspaceName,
} from "../../domain/workspace.ts";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

const createWorkspaceEndpoint = HttpApiEndpoint.post("createWorkspace", "/workspace", {
  payload: Schema.Struct({
    id: WorkspaceId,
    name: WorkspaceName,
  }),
  success: Workspace,
  error: CreateWorkspaceError,
});

const getWorkspaceEndpoint = HttpApiEndpoint.get("getWorkspace", "/workspace", {
  success: Workspace,
  error: GetWorkspaceError,
});

const renameWorkspaceEndpoint = HttpApiEndpoint.post("renameWorkspace", "/workspace/rename", {
  payload: Schema.Struct({ name: WorkspaceName }),
  success: Workspace,
  error: RenameWorkspaceError,
});

const archiveWorkspaceEndpoint = HttpApiEndpoint.post("archiveWorkspace", "/workspace/archive", {
  success: Workspace,
  error: ArchiveWorkspaceError,
});

const unarchiveWorkspaceEndpoint = HttpApiEndpoint.post(
  "unarchiveWorkspace",
  "/workspace/unarchive",
  {
    success: Workspace,
    error: UnarchiveWorkspaceError,
  },
);

/** Versioned HTTP endpoint group served by one Workspace Durable Object. */
export class WorkspaceHttpApiGroup extends HttpApiGroup.make("workspace")
  .add(createWorkspaceEndpoint)
  .add(getWorkspaceEndpoint)
  .add(renameWorkspaceEndpoint)
  .add(archiveWorkspaceEndpoint)
  .add(unarchiveWorkspaceEndpoint) {}

/** Shared Workspace HTTP contract used by the Durable Object server and client. */
export class WorkspaceHttpApi extends HttpApi.make("WorkspaceHttpApi")
  .add(WorkspaceHttpApiGroup)
  .prefix("/v1") {}
