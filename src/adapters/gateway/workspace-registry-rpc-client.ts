import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { WorkspaceRegistryService } from "../../application/workspace-registry/workspace-registry.ts";
import {
  CreateProjectRpcInput,
  CreateWorkspaceRpcInput,
  MoveProjectRpcInput,
  RegisterIssueOwnerRpcInput,
  RenameProjectRpcInput,
  RenameWorkspaceRpcInput,
  WORKSPACE_REGISTRY_SINGLETON_NAME,
  WorkspaceRegistryRpcCallFailed,
  type WorkspaceRegistryRpc,
} from "../../application/workspace-registry/workspace-registry-rpc.ts";
import { WorkspaceRegistryObject } from "../../infra/workspace-registry-resource.ts";

type RpcOperation = keyof WorkspaceRegistryRpc;

function withRpcCallError<A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E | Cloudflare.RpcCallError> {
  // SAFETY: Alchemy's schemaless stub can fail with RpcCallError when native JSRPC rejects, but its Shape mapping omits that transport error from the static method type. This widens only the error channel to match makeRpcStub's runtime behavior.
  return effect as Effect.Effect<A, E | Cloudflare.RpcCallError>;
}

function rpcCall<A, E>(
  effect: Effect.Effect<A, E>,
  operation: RpcOperation,
): Effect.Effect<A, E | WorkspaceRegistryRpcCallFailed> {
  const callFailed = (cause: Cloudflare.RpcCallError) =>
    Effect.logError("Workspace Registry RPC call failed").pipe(
      Effect.annotateLogs({
        error_type: cause._tag,
        operation,
        rpc_method: cause.method,
      }),
      Effect.andThen(
        Effect.fail(
          new WorkspaceRegistryRpcCallFailed({
            operation,
            cause,
          }),
        ),
      ),
    );

  return withRpcCallError(effect).pipe(
    Effect.catchIf(
      (error): error is Cloudflare.RpcCallError => error instanceof Cloudflare.RpcCallError,
      callFailed,
    ),
  );
}

/** Construct the Gateway Workspace Registry client from the hosted Alchemy namespace. */
export const make = Effect.gen(function* () {
  const workspaceRegistries = yield* WorkspaceRegistryObject;
  const stub = () => workspaceRegistries.getByName(WORKSPACE_REGISTRY_SINGLETON_NAME);

  return WorkspaceRegistryService.of({
    listWorkspaces: Effect.fn("WorkspaceRegistryRpc.listWorkspaces")((input) =>
      rpcCall(
        stub().listWorkspaces(
          Option.match(input.cursor, {
            onNone: () => ({ limit: input.limit }),
            onSome: (cursor) => ({ cursor, limit: input.limit }),
          }),
        ),
        "listWorkspaces",
      ).pipe(
        Effect.map((page) => ({
          workspaces: page.workspaces,
          cursor: Option.fromNullishOr(page.cursor),
          nextCursor: Option.fromNullishOr(page.nextCursor),
          limit: page.limit,
        })),
      ),
    ),
    readWorkspace: Effect.fn("WorkspaceRegistryRpc.readWorkspace")((workspaceId) =>
      rpcCall(stub().readWorkspace(workspaceId), "readWorkspace"),
    ),
    createWorkspace: Effect.fn("WorkspaceRegistryRpc.createWorkspace")((input) =>
      rpcCall(stub().createWorkspace(CreateWorkspaceRpcInput.make(input)), "createWorkspace"),
    ),
    renameWorkspace: Effect.fn("WorkspaceRegistryRpc.renameWorkspace")((workspaceId, name) =>
      rpcCall(
        stub().renameWorkspace(RenameWorkspaceRpcInput.make({ workspaceId, name })),
        "renameWorkspace",
      ),
    ),
    listProjects: Effect.fn("WorkspaceRegistryRpc.listProjects")((input) =>
      rpcCall(
        stub().listProjects({
          ...(Option.isSome(input.workspaceId) ? { workspaceId: input.workspaceId.value } : {}),
          ...(Option.isSome(input.cursor) ? { cursor: input.cursor.value } : {}),
          limit: input.limit,
        }),
        "listProjects",
      ).pipe(
        Effect.map((page) => ({
          projects: page.projects,
          cursor: Option.fromNullishOr(page.cursor),
          nextCursor: Option.fromNullishOr(page.nextCursor),
          limit: page.limit,
        })),
      ),
    ),
    readProject: Effect.fn("WorkspaceRegistryRpc.readProject")((projectId) =>
      rpcCall(stub().readProject(projectId), "readProject"),
    ),
    createProject: Effect.fn("WorkspaceRegistryRpc.createProject")((input) =>
      rpcCall(stub().createProject(CreateProjectRpcInput.make(input)), "createProject"),
    ),
    renameProject: Effect.fn("WorkspaceRegistryRpc.renameProject")((projectId, name) =>
      rpcCall(
        stub().renameProject(RenameProjectRpcInput.make({ projectId, name })),
        "renameProject",
      ),
    ),
    moveProject: Effect.fn("WorkspaceRegistryRpc.moveProject")((input) =>
      rpcCall(stub().moveProject(MoveProjectRpcInput.make(input)), "moveProject"),
    ),
    registerIssueOwner: Effect.fn("WorkspaceRegistryRpc.registerIssueOwner")((input) =>
      rpcCall(
        stub().registerIssueOwner(RegisterIssueOwnerRpcInput.make(input)),
        "registerIssueOwner",
      ),
    ),
    readIssueOwner: Effect.fn("WorkspaceRegistryRpc.readIssueOwner")((issueId) =>
      rpcCall(stub().readIssueOwner(issueId), "readIssueOwner"),
    ),
  });
});

/** Adapt the hosted Alchemy namespace directly to the Gateway application interface. */
export const layer = Layer.effect(WorkspaceRegistryService, make);
