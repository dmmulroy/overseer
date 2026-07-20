import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import type { Catalog } from "../../application/catalog/catalog.ts";
import type { CatalogOutcome } from "../../application/catalog/catalog-rpc.ts";
import {
  DiscoveryPaths,
  type Link,
  OverseerApi,
  WorkspaceCollection,
  WorkspaceRepresentation,
  WorkspaceSchemaPaths,
} from "../../contract/http-api.ts";
import type { WorkspaceId } from "../../domain/entity-id.ts";
import type { WorkspaceCursor } from "../../domain/pagination.ts";
import type { Workspace } from "../../domain/workspace.ts";
import { RequestId } from "../../domain/actor.ts";
import { gatewayRequestContext } from "./gateway-request-context.ts";
import type { ProblemResponder } from "./problem-response.ts";

function projectWorkspace(workspace: Workspace): WorkspaceRepresentation {
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
      rename: { href: self, method: "PATCH", schema: WorkspaceSchemaPaths.rename },
    },
  });
}

function projectCollection(
  workspaces: ReadonlyArray<Workspace>,
  cursor: Option.Option<string>,
  nextCursor: Option.Option<string>,
  limit: number,
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
    items: workspaces.map(projectWorkspace),
    links,
  });
}

function json(value: unknown, status = 200, headers?: Readonly<Record<string, string>>) {
  return HttpServerResponse.jsonUnsafe(value, { status, headers });
}

function requestProblem(
  requestId: RequestId,
  respond: ProblemResponder,
  input: Omit<Parameters<ProblemResponder>[0], "requestId">,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.fromWeb(respond({ ...input, requestId }));
}

function workspaceOutcome(
  outcome: CatalogOutcome,
  requestId: RequestId,
  respond: ProblemResponder,
): HttpServerResponse.HttpServerResponse {
  switch (outcome._tag) {
    case "WorkspaceFound":
    case "WorkspaceRenamed":
      return json(projectWorkspace(outcome.workspace));
    case "WorkspaceCollection":
      return json(projectCollection(
        outcome.workspaces,
        Option.fromNullishOr(outcome.cursor),
        Option.fromNullishOr(outcome.nextCursor),
        outcome.limit,
      ));
    case "CursorInvalid":
      return requestProblem(requestId, respond, {
        code: "malformed_request",
        detail: "The Workspace cursor is invalid or expired.",
      });
    case "WorkspaceNotFound":
      return requestProblem(requestId, respond, {
        code: "resource_not_found",
        detail: "The requested Workspace does not exist.",
      });
    case "IdempotencyKeyReused":
      return requestProblem(requestId, respond, {
        code: "idempotency_key_reused",
        detail: "This Idempotency-Key was already used for a different request.",
      });
    case "CatalogProtocolInvalid":
    case "CatalogRecordCorrupt":
    case "CatalogStateUnavailable":
      return requestProblem(requestId, respond, {
        code: "service_unavailable",
        detail: "The Workspace Catalog is temporarily unavailable.",
      });
    case "WorkspaceCreated":
      return json(projectWorkspace(outcome.workspace), 201, {
        location: `/api/workspaces/${outcome.workspace.id}`,
        ...(outcome.replayed ? { "idempotency-replayed": "true" } : {}),
      });
  }
}

function listWorkspaces(
  catalog: Catalog,
  respond: ProblemResponder,
  query: {
    readonly cursor?: WorkspaceCursor;
    readonly limit?: number;
  },
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  never
> {
  return Effect.gen(function* () {
    const context = yield* gatewayRequestContext;
    const outcome = yield* catalog.listWorkspaces({
      cursor: Option.fromNullishOr(query.cursor),
      limit: query.limit ?? 50,
    });
    return workspaceOutcome(outcome, context.requestId, respond);
  });
}

function readWorkspace(
  catalog: Catalog,
  respond: ProblemResponder,
  workspaceId: WorkspaceId,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  never
> {
  return Effect.gen(function* () {
    const context = yield* gatewayRequestContext;
    const outcome = yield* catalog.readWorkspace(workspaceId);
    return workspaceOutcome(outcome, context.requestId, respond);
  });
}

function makeWorkspaceHandlers(
  catalog: Catalog,
  respond: ProblemResponder,
) {
  return HttpApiBuilder.group(OverseerApi, "workspaces", (handlers) =>
    handlers
      .handle("listWorkspaces", ({ query }) =>
        listWorkspaces(catalog, respond, query))
      .handle("headWorkspaces", ({ query }) =>
        listWorkspaces(catalog, respond, query))
      .handle("readWorkspace", ({ params }) =>
        readWorkspace(catalog, respond, params.workspace_id))
      .handle("headWorkspace", ({ params }) =>
        readWorkspace(catalog, respond, params.workspace_id))
      .handle("createWorkspace", ({ headers, payload }) =>
        Effect.gen(function* () {
          const context = yield* gatewayRequestContext;
          const outcome = yield* catalog.createWorkspace({
            name: payload.name,
            principalKey: context.idempotencyPrincipal,
            idempotencyKey: headers["idempotency-key"],
          });
          return workspaceOutcome(outcome, context.requestId, respond);
        }))
      .handle("renameWorkspace", ({ payload, params }) =>
        Effect.gen(function* () {
          const context = yield* gatewayRequestContext;
          const outcome = yield* catalog.renameWorkspace(
            params.workspace_id,
            payload.name,
          );
          return workspaceOutcome(outcome, context.requestId, respond);
        })),
  );
}

/** Build the Workspace HTTP handlers over the Catalog application seam. */
export function workspaceHandlers(
  catalog: Catalog,
  respond: ProblemResponder,
): ReturnType<typeof makeWorkspaceHandlers> {
  return makeWorkspaceHandlers(catalog, respond);
}
