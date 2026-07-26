import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { WorkspaceRegistryService } from "../../application/workspace-registry/workspace-registry.ts";
import type {
  IdempotencyKeyReused,
  WorkspaceNotFound,
  WorkspaceRegistryCursorInvalid,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryRpcCallFailed,
  WorkspaceRegistryStateUnavailable,
} from "../../application/workspace-registry/workspace-registry-rpc.ts";
import {
  DiscoveryPaths,
  type Link,
  OverseerApi,
  WorkspaceCollection,
  WorkspaceRepresentation,
  WorkspaceSchemaPaths,
} from "../../contract/http-api.ts";
import type { WorkspaceId } from "../../domain/entity-id.ts";
import type { IdempotencyKey } from "../../domain/idempotency.ts";
import { type WorkspaceCursor, WorkspacePageLimit } from "../../domain/pagination.ts";
import type { Workspace, WorkspaceName } from "../../domain/workspace.ts";
import { GatewayRequestContext } from "./gateway-request-context.ts";
import { ProblemResponse, type ProblemInput } from "./problem-response.ts";

function workspaceRepresentation(workspace: Workspace): WorkspaceRepresentation {
  const self = `/api/workspaces/${workspace.id}`;
  return WorkspaceRepresentation.make({
    id: workspace.id,
    name: workspace.name,
    lifecycle: workspace.lifecycle,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
    archived_at: null,
    links: {
      self: { href: self },
      projects: { href: `${self}/projects` },
      rename: { href: self, method: "PATCH", schema: WorkspaceSchemaPaths.rename },
    },
  });
}

function workspaceCollection(
  workspaces: ReadonlyArray<Workspace>,
  cursor: Option.Option<WorkspaceCursor>,
  nextCursor: Option.Option<WorkspaceCursor>,
  limit: WorkspacePageLimit,
): WorkspaceCollection {
  const currentQuery = Option.isSome(cursor)
    ? `?cursor=${encodeURIComponent(cursor.value)}&limit=${limit}`
    : limit === 50
      ? ""
      : `?limit=${limit}`;
  const links: Record<string, Link> = {
    self: { href: `${DiscoveryPaths.workspaces}${currentQuery}` },
    create: {
      href: DiscoveryPaths.workspaces,
      method: "POST",
      schema: WorkspaceSchemaPaths.create,
    },
  };
  if (Option.isSome(nextCursor)) {
    links.next = {
      href: `${DiscoveryPaths.workspaces}?cursor=${encodeURIComponent(nextCursor.value)}&limit=${limit}`,
    };
  }
  return WorkspaceCollection.make({
    items: workspaces.map(workspaceRepresentation),
    links,
  });
}

function json(
  value: unknown,
  status = 200,
  headers?: Readonly<Record<string, string>>,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(value, { status, headers });
}

const requestProblem = Effect.fn("Gateway.requestProblem")(function* (
  input: Omit<ProblemInput, "requestId">,
) {
  const context = yield* GatewayRequestContext;
  const problems = yield* ProblemResponse;
  return problems.render({ ...input, requestId: context.requestId });
});

type WorkspaceFailure =
  | WorkspaceRegistryCursorInvalid
  | WorkspaceNotFound
  | IdempotencyKeyReused
  | WorkspaceRegistryRecordCorrupt
  | WorkspaceRegistryStateUnavailable
  | WorkspaceRegistryRpcCallFailed;

const workspaceFailure = Effect.fn("Gateway.workspaceFailure")(function* (
  failure: WorkspaceFailure,
) {
  switch (failure._tag) {
    case "WorkspaceRegistryCursorInvalid":
      return yield* requestProblem({
        code: "malformed_request",
        detail: "The Workspace cursor is invalid or expired.",
      });
    case "WorkspaceNotFound":
      return yield* requestProblem({
        code: "resource_not_found",
        detail: "The requested Workspace does not exist.",
      });
    case "IdempotencyKeyReused":
      return yield* requestProblem({
        code: "idempotency_key_reused",
        detail: "This Idempotency-Key was already used for a different request.",
      });
    case "WorkspaceRegistryRecordCorrupt":
    case "WorkspaceRegistryStateUnavailable":
      return yield* requestProblem({
        code: "service_unavailable",
        detail: "The Workspace Registry is temporarily unavailable.",
      });
    case "WorkspaceRegistryRpcCallFailed":
      return yield* requestProblem({
        code: "internal_error",
        detail: "Overseer could not complete the Workspace Registry call.",
      });
  }
});

const listWorkspacesResponse = Effect.fn("Gateway.listWorkspaces")(function* (query: {
  readonly cursor?: WorkspaceCursor;
  readonly limit?: WorkspacePageLimit;
}) {
  const workspaceRegistry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(
    workspaceRegistry.listWorkspaces({
      cursor: Option.fromNullishOr(query.cursor),
      limit: query.limit ?? WorkspacePageLimit.make(50),
    }),
  );
  return Result.isFailure(result)
    ? yield* workspaceFailure(result.failure)
    : json(
        workspaceCollection(
          result.success.workspaces,
          result.success.cursor,
          result.success.nextCursor,
          result.success.limit,
        ),
      );
});

const readWorkspaceResponse = Effect.fn("Gateway.readWorkspace")(function* (
  workspaceId: WorkspaceId,
) {
  const workspaceRegistry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(workspaceRegistry.readWorkspace(workspaceId));
  return Result.isFailure(result)
    ? yield* workspaceFailure(result.failure)
    : json(workspaceRepresentation(result.success));
});

const createWorkspaceResponse = Effect.fn("Gateway.createWorkspace")(function* (input: {
  readonly name: WorkspaceName;
  readonly idempotencyKey: IdempotencyKey;
}) {
  const context = yield* GatewayRequestContext;
  const workspaceRegistry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(
    workspaceRegistry.createWorkspace({
      name: input.name,
      idempotencyScope: context.idempotencyScope,
      idempotencyKey: input.idempotencyKey,
    }),
  );
  if (Result.isFailure(result)) {
    return yield* workspaceFailure(result.failure);
  }
  return json(workspaceRepresentation(result.success.workspace), 201, {
    location: `/api/workspaces/${result.success.workspace.id}`,
    ...(result.success.replayed ? { "idempotency-replayed": "true" } : {}),
  });
});

const renameWorkspaceResponse = Effect.fn("Gateway.renameWorkspace")(function* (
  workspaceId: WorkspaceId,
  name: WorkspaceName,
) {
  const workspaceRegistry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(workspaceRegistry.renameWorkspace(workspaceId, name));
  return Result.isFailure(result)
    ? yield* workspaceFailure(result.failure)
    : json(workspaceRepresentation(result.success));
});

/** Workspace HTTP handlers backed by yielded application services. */
export const layer = HttpApiBuilder.group(OverseerApi, "workspaces", (handlers) =>
  handlers
    .handle("listWorkspaces", ({ query }) => listWorkspacesResponse(query))
    .handle("headWorkspaces", ({ query }) => listWorkspacesResponse(query))
    .handle("readWorkspace", ({ params }) => readWorkspaceResponse(params.workspace_id))
    .handle("headWorkspace", ({ params }) => readWorkspaceResponse(params.workspace_id))
    .handle("createWorkspace", ({ headers, payload }) =>
      createWorkspaceResponse({
        name: payload.name,
        idempotencyKey: headers["idempotency-key"],
      }),
    )
    .handle("renameWorkspace", ({ payload, params }) =>
      renameWorkspaceResponse(params.workspace_id, payload.name),
    ),
);
