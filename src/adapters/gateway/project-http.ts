import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { WorkspaceRegistryService } from "../../application/workspace-registry/workspace-registry.ts";
import type {
  IdempotencyKeyReused,
  ProjectMoveNotApplicable,
  ProjectNotFound,
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
  ProjectCollection,
  IssueSchemaPaths,
  ProjectResponse,
  ProjectSchemaPaths,
} from "../../contract/http-api.ts";
import type { ProjectId, WorkspaceId } from "../../domain/entity-id.ts";
import type { IdempotencyKey } from "../../domain/idempotency.ts";
import { type ProjectCursor, ProjectPageLimit } from "../../domain/pagination.ts";
import type { Project, ProjectName } from "../../domain/project.ts";
import { GatewayRequestContext } from "./gateway-request-context.ts";
import { ProblemResponse, type ProblemInput } from "./problem-response.ts";

function projectResponse(project: Project): ProjectResponse {
  const self = `/api/projects/${project.id}`;
  return ProjectResponse.make({
    id: project.id,
    workspace_id: project.workspaceId,
    name: project.name,
    lifecycle: project.lifecycle,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    archived_at: null,
    links: {
      self: { href: self },
      workspace: { href: `/api/workspaces/${project.workspaceId}` },
      rename: { href: self, method: "PATCH", schema: ProjectSchemaPaths.rename },
      move: { href: `${self}/move`, method: "POST", schema: ProjectSchemaPaths.move },
      create_issue: { href: `${self}/issues`, method: "POST", schema: IssueSchemaPaths.create },
    },
  });
}
function projectCollection(
  projects: ReadonlyArray<Project>,
  workspaceId: Option.Option<WorkspaceId>,
  cursor: Option.Option<ProjectCursor>,
  nextCursor: Option.Option<ProjectCursor>,
  limit: ProjectPageLimit,
): ProjectCollection {
  const base = Option.match(workspaceId, {
    onNone: () => DiscoveryPaths.projects,
    onSome: (id) => `/api/workspaces/${id}/projects`,
  });
  const query = Option.isSome(cursor)
    ? `?cursor=${encodeURIComponent(cursor.value)}&limit=${limit}`
    : limit === 50
      ? ""
      : `?limit=${limit}`;
  const links: Record<string, Link> = { self: { href: `${base}${query}` } };
  if (Option.isSome(workspaceId))
    links.create = { href: base, method: "POST", schema: ProjectSchemaPaths.create };
  if (Option.isSome(nextCursor))
    links.next = { href: `${base}?cursor=${encodeURIComponent(nextCursor.value)}&limit=${limit}` };
  return ProjectCollection.make({ items: projects.map(projectResponse), links });
}
function json(
  value: unknown,
  status = 200,
  headers?: Readonly<Record<string, string>>,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(value, { status, headers });
}
const requestProblem = Effect.fn("Gateway.projectRequestProblem")(function* (
  input: Omit<ProblemInput, "requestId">,
) {
  const context = yield* GatewayRequestContext;
  const problems = yield* ProblemResponse;
  return problems.render({ ...input, requestId: context.requestId });
});
type ProjectFailure =
  | WorkspaceRegistryCursorInvalid
  | WorkspaceNotFound
  | ProjectNotFound
  | ProjectMoveNotApplicable
  | IdempotencyKeyReused
  | WorkspaceRegistryRecordCorrupt
  | WorkspaceRegistryStateUnavailable
  | WorkspaceRegistryRpcCallFailed;
const projectFailure = Effect.fn("Gateway.projectFailure")(function* (failure: ProjectFailure) {
  switch (failure._tag) {
    case "WorkspaceRegistryCursorInvalid":
      return yield* requestProblem({
        code: "malformed_request",
        detail: "The Project cursor is invalid or expired.",
      });
    case "WorkspaceNotFound":
      return yield* requestProblem({
        code: "resource_not_found",
        detail: "The requested Workspace does not exist.",
      });
    case "ProjectNotFound":
      return yield* requestProblem({
        code: "resource_not_found",
        detail: "The requested Project does not exist.",
      });
    case "ProjectMoveNotApplicable":
      return yield* requestProblem({
        code: "action_not_applicable",
        detail: "The Project already belongs to the requested Workspace.",
        details: { current_project: projectResponse(failure.project) },
        links: {
          project: { href: `/api/projects/${failure.project.id}` },
          workspace: { href: `/api/workspaces/${failure.project.workspaceId}` },
        },
      });
    case "IdempotencyKeyReused":
      return yield* requestProblem({
        code: "idempotency_key_reused",
        detail: "This Idempotency-Key already identifies another Workspace Registry operation.",
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
const listProjectsResponse = Effect.fn("Gateway.listProjects")(function* (
  workspaceId: Option.Option<WorkspaceId>,
  query: { readonly cursor?: ProjectCursor; readonly limit?: ProjectPageLimit },
) {
  const registry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(
    registry.listProjects({
      workspaceId,
      cursor: Option.fromNullishOr(query.cursor),
      limit: query.limit ?? ProjectPageLimit.make(50),
    }),
  );
  return Result.isFailure(result)
    ? yield* projectFailure(result.failure)
    : json(
        projectCollection(
          result.success.projects,
          workspaceId,
          result.success.cursor,
          result.success.nextCursor,
          result.success.limit,
        ),
      );
});
const readProjectResponse = Effect.fn("Gateway.readProject")(function* (projectId: ProjectId) {
  const registry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(registry.readProject(projectId));
  return Result.isFailure(result)
    ? yield* projectFailure(result.failure)
    : json(projectResponse(result.success));
});
const createProjectResponse = Effect.fn("Gateway.createProject")(function* (
  workspaceId: WorkspaceId,
  name: ProjectName,
  idempotencyKey: IdempotencyKey,
) {
  const registry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(
    registry.createProject({
      workspaceId,
      name,
      idempotencyKey,
    }),
  );
  if (Result.isFailure(result)) return yield* projectFailure(result.failure);
  const responseHeaders: Record<string, string> = {
    location: `/api/projects/${result.success.project.id}`,
  };
  if (result.success.replayed) responseHeaders["idempotency-replayed"] = "true";
  return json(projectResponse(result.success.project), 201, responseHeaders);
});
const renameProjectResponse = Effect.fn("Gateway.renameProject")(function* (
  projectId: ProjectId,
  name: ProjectName,
) {
  const registry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(registry.renameProject(projectId, name));
  return Result.isFailure(result)
    ? yield* projectFailure(result.failure)
    : json(projectResponse(result.success));
});
const moveProjectResponse = Effect.fn("Gateway.moveProject")(function* (
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  idempotencyKey: IdempotencyKey,
) {
  const registry = yield* WorkspaceRegistryService;
  const result = yield* Effect.result(
    registry.moveProject({ projectId, workspaceId, idempotencyKey }),
  );
  if (Result.isFailure(result)) {
    if (result.failure._tag === "WorkspaceNotFound") {
      return yield* requestProblem({
        code: "resource_not_found",
        detail: "The target Workspace does not exist.",
        links: { project: { href: `/api/projects/${projectId}` } },
      });
    }
    return yield* projectFailure(result.failure);
  }
  return json(
    projectResponse(result.success.project),
    200,
    result.success.replayed ? { "idempotency-replayed": "true" } : {},
  );
});

/** Project HTTP handlers backed by yielded Workspace Registry operations. */
export const layer = HttpApiBuilder.group(OverseerApi, "projects", (handlers) =>
  handlers
    .handle("listProjects", ({ query }) => listProjectsResponse(Option.none(), query))
    .handle("headProjects", ({ query }) => listProjectsResponse(Option.none(), query))
    .handle("listWorkspaceProjects", ({ params, query }) =>
      listProjectsResponse(Option.some(params.workspace_id), query),
    )
    .handle("headWorkspaceProjects", ({ params, query }) =>
      listProjectsResponse(Option.some(params.workspace_id), query),
    )
    .handle("createProject", ({ params, headers, payload }) =>
      createProjectResponse(params.workspace_id, payload.name, headers["idempotency-key"]),
    )
    .handle("readProject", ({ params }) => readProjectResponse(params.project_id))
    .handle("headProject", ({ params }) => readProjectResponse(params.project_id))
    .handle("renameProject", ({ params, payload }) =>
      renameProjectResponse(params.project_id, payload.name),
    )
    .handle("moveProject", ({ params, headers, payload }) =>
      moveProjectResponse(params.project_id, payload.workspace_id, headers["idempotency-key"]),
    ),
);
