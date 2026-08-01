import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import {
  ProjectOperationsService,
  type ProjectOperationError,
} from "../../application/gateway/project-operations.ts";
import {
  IssueCollection,
  IssueReferenceCollection,
  IssueResponse,
  IssueSchemaPaths,
  IssueSummaryResponse,
  type Link,
  IssueRevisionCollection,
  IssueRevisionResponse,
  IssueTimelineCollection,
  IssueTimelineEntryResponse,
  OverseerApi,
} from "../../contract/http-api.ts";
import { CommandAttribution, type Actor, type AgentSession } from "../../domain/actor.ts";
import type { IssueId, LabelId, ProjectId } from "../../domain/entity-id.ts";
import type { IdempotencyKey } from "../../domain/idempotency.ts";
import type { Assignee, Issue, IssueBody, IssueNumber, IssueTitle } from "../../domain/issue.ts";
import {
  IssuePageLimit,
  type IssueAssigneeStatusFilter,
  type IssueBlockingStatusFilter,
  type IssueCursor,
  type IssueLabelMatchFilter,
  type IssueLifecycleFilter,
  type IssuePageLimit as IssuePageLimitType,
  type IssueSort,
  type IssueSortDirection,
  type IssueStateFilter,
} from "../../domain/pagination.ts";
import { gatewayRequestAgentSession, GatewayRequestContext } from "./gateway-request-context.ts";
import { ProblemResponse } from "./problem-response.ts";

function apiActor(actor: Actor) {
  return actor._tag === "HumanActor"
    ? { kind: "human" as const, subject: actor.subject, email: actor.email }
    : { kind: "agent" as const, agent_id: actor.agentId };
}
function apiAgentSession(session: Option.Option<AgentSession>) {
  return Option.match(session, {
    onNone: () => null,
    onSome: (value) => ({
      session_id: value.sessionId,
      harness: Option.getOrNull(value.harness),
    }),
  });
}
function issueResponse(issue: Issue): IssueResponse {
  const self = `/api/issues/${issue.id}`;
  return IssueResponse.make({
    id: issue.id,
    project_id: issue.projectId,
    number: issue.number,
    title: issue.title,
    body: Option.getOrNull(issue.body),
    state: issue.state,
    lifecycle: issue.lifecycle,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    links: {
      self: { href: self },
      project: { href: `/api/projects/${issue.projectId}` },
      project_number: { href: `/api/projects/${issue.projectId}/issues/${issue.number}` },
      revisions: { href: `${self}/revisions` },
      timeline: { href: `${self}/timeline` },
      references: { href: `${self}/references` },
    },
  });
}
function issueSummaryResponse(issue: Issue): IssueSummaryResponse {
  return IssueSummaryResponse.make({
    id: issue.id,
    project_id: issue.projectId,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    lifecycle: "live",
    assignee: null,
    parent_issue_id: null,
    blocking_status: "unblocked",
    active_blocker_count: 0,
    labels: [],
    updated_at: issue.updatedAt,
    links: { self: { href: `/api/issues/${issue.id}` } },
  });
}

type IssueListHttpQuery = {
  readonly state?: IssueStateFilter;
  readonly lifecycle?: IssueLifecycleFilter;
  readonly assignee?: Assignee;
  readonly assignee_status?: IssueAssigneeStatusFilter;
  readonly label_id?: LabelId | ReadonlyArray<LabelId>;
  readonly label_match?: IssueLabelMatchFilter;
  readonly parent?: "root" | IssueId;
  readonly blocking_status?: IssueBlockingStatusFilter;
  readonly number?: IssueNumber;
  readonly sort?: IssueSort;
  readonly direction?: IssueSortDirection;
  readonly cursor?: IssueCursor;
  readonly limit?: IssuePageLimitType;
};

type NormalizedIssueListQuery = {
  readonly state: IssueStateFilter;
  readonly lifecycle: IssueLifecycleFilter;
  readonly assignee: Assignee | undefined;
  readonly assignee_status: IssueAssigneeStatusFilter;
  readonly label_id: ReadonlyArray<LabelId>;
  readonly label_match: IssueLabelMatchFilter;
  readonly parent: "root" | IssueId | undefined;
  readonly blocking_status: IssueBlockingStatusFilter;
  readonly number: IssueNumber | undefined;
  readonly sort: IssueSort;
  readonly direction: IssueSortDirection;
  readonly cursor: IssueCursor | undefined;
  readonly limit: IssuePageLimitType;
};

function issuePageHref(projectId: ProjectId, query: NormalizedIssueListQuery): string {
  const parameters = new URLSearchParams({
    state: query.state,
    lifecycle: query.lifecycle,
    assignee_status: query.assignee_status,
    blocking_status: query.blocking_status,
    sort: query.sort,
    direction: query.direction,
    limit: String(query.limit),
  });
  if (query.assignee !== undefined) parameters.set("assignee", query.assignee);
  for (const labelId of query.label_id) parameters.append("label_id", labelId);
  if (query.label_id.length > 0) parameters.set("label_match", query.label_match);
  if (query.parent !== undefined) parameters.set("parent", query.parent);
  if (query.number !== undefined) parameters.set("number", String(query.number));
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  return `/api/projects/${projectId}/issues?${parameters.toString()}`;
}

function json(value: unknown, status = 200, headers?: Readonly<Record<string, string>>) {
  return HttpServerResponse.jsonUnsafe(value, { status, headers });
}
const issueFailure = Effect.fn("Gateway.issueFailure")(function* (failure: ProjectOperationError) {
  const context = yield* GatewayRequestContext;
  const problems = yield* ProblemResponse;
  switch (failure._tag) {
    case "IssueCursorInvalid":
      return problems.render({
        code: "invalid_cursor",
        detail:
          failure.reason === "rebound"
            ? "The Issue cursor belongs to different filters or ordering. Follow the complete pagination link without changing its query."
            : "The Issue cursor is malformed or expired. Restart from the collection without a cursor.",
        details: { reason: failure.reason },
        requestId: context.requestId,
      });
    case "IssueNotFound":
    case "IssueOwnerNotFound":
      return problems.render({
        code: "resource_not_found",
        detail: "The requested Issue does not exist.",
        requestId: context.requestId,
      });
    case "ProjectNotFound":
      return problems.render({
        code: "resource_not_found",
        detail: "The requested Project does not exist.",
        requestId: context.requestId,
      });
    case "ProjectIdempotencyKeyReused":
      return problems.render({
        code: "idempotency_key_reused",
        detail: "This Idempotency-Key already identifies another Project-local operation.",
        requestId: context.requestId,
      });
    case "ProjectRecordCorrupt":
    case "ProjectStateUnavailable":
    case "WorkspaceRegistryRecordCorrupt":
    case "WorkspaceRegistryStateUnavailable":
      return problems.render({
        code: "service_unavailable",
        detail: "Project Issue data is temporarily unavailable.",
        requestId: context.requestId,
      });
    case "ProjectRpcCallFailed":
    case "WorkspaceRegistryRpcCallFailed":
      return problems.render({
        code: "internal_error",
        detail: "Overseer could not complete the Project operation.",
        requestId: context.requestId,
      });
  }
});
const listIssuesResponse = Effect.fn("Gateway.listIssues")(function* (
  projectId: ProjectId,
  query: IssueListHttpQuery,
) {
  const context = yield* GatewayRequestContext;
  const problems = yield* ProblemResponse;
  if (query.assignee !== undefined && query.assignee_status === "unassigned") {
    return problems.render({
      code: "malformed_request",
      detail: "An exact assignee cannot be combined with assignee_status=unassigned.",
      errors: [
        {
          code: "contradictory",
          path: "/query/assignee_status",
          message: "Use assigned or any when filtering by an exact assignee.",
        },
      ],
      requestId: context.requestId,
    });
  }
  if (query.label_match !== undefined && query.label_id === undefined) {
    return problems.render({
      code: "malformed_request",
      detail: "label_match requires at least one label_id filter.",
      errors: [
        {
          code: "requires_label_id",
          path: "/query/label_match",
          message: "Add one or more label_id parameters or omit label_match.",
        },
      ],
      requestId: context.requestId,
    });
  }
  const operations = yield* ProjectOperationsService;
  const labelIds =
    query.label_id === undefined
      ? []
      : Array.isArray(query.label_id)
        ? query.label_id
        : [query.label_id];
  const normalized = {
    state: query.state ?? "open",
    lifecycle: query.lifecycle ?? "live",
    assignee: query.assignee,
    assignee_status: query.assignee_status ?? "any",
    label_id: labelIds,
    label_match: query.label_match ?? "any",
    parent: query.parent,
    blocking_status: query.blocking_status ?? "any",
    number: query.number,
    sort: query.sort ?? "updated_at",
    direction: query.direction ?? "desc",
    cursor: query.cursor,
    limit: query.limit ?? IssuePageLimit.make(50),
  } as const;
  const result = yield* Effect.result(
    operations.listIssues({
      projectId,
      state: normalized.state,
      lifecycle: normalized.lifecycle,
      assignee: Option.fromNullishOr(normalized.assignee),
      assigneeStatus: normalized.assignee_status,
      labelIds,
      labelMatch: normalized.label_match,
      parent: Option.fromNullishOr(normalized.parent),
      blockingStatus: normalized.blocking_status,
      number: Option.fromNullishOr(normalized.number),
      sort: normalized.sort,
      direction: normalized.direction,
      cursor: Option.fromNullishOr(normalized.cursor),
      limit: normalized.limit,
    }),
  );
  if (Result.isFailure(result)) return yield* issueFailure(result.failure);
  const links: Record<string, Link> = {
    self: { href: issuePageHref(projectId, normalized) },
    create: {
      href: `/api/projects/${projectId}/issues`,
      method: "POST",
      schema: IssueSchemaPaths.create,
    },
  };
  if (Option.isSome(result.success.previousCursor)) {
    links.previous = {
      href: issuePageHref(projectId, {
        ...normalized,
        cursor: result.success.previousCursor.value,
      }),
    };
  }
  if (Option.isSome(result.success.nextCursor)) {
    links.next = {
      href: issuePageHref(projectId, {
        ...normalized,
        cursor: result.success.nextCursor.value,
      }),
    };
  }
  return json(
    IssueCollection.make({
      items: result.success.issues.map(issueSummaryResponse),
      links,
    }),
  );
});

const createIssueResponse = Effect.fn("Gateway.createIssue")(function* (
  projectId: ProjectId,
  title: IssueTitle,
  body: Option.Option<IssueBody>,
  idempotencyKey: IdempotencyKey,
) {
  const context = yield* GatewayRequestContext;
  const operations = yield* ProjectOperationsService;
  const result = yield* Effect.result(
    operations.createIssue({
      projectId,
      title,
      body,
      idempotencyKey,
      attribution: CommandAttribution.make({
        actor: context.actor,
        agentSession: gatewayRequestAgentSession(context),
        requestId: context.requestId,
      }),
    }),
  );
  if (Result.isFailure(result)) return yield* issueFailure(result.failure);
  const responseHeaders: Record<string, string> = {
    location: `/api/issues/${result.success.issue.id}`,
  };
  if (result.success.replayed) responseHeaders["idempotency-replayed"] = "true";
  return json(issueResponse(result.success.issue), 201, responseHeaders);
});
const readCanonicalIssueResponse = Effect.fn("Gateway.readIssue")(function* (issueId: IssueId) {
  const operations = yield* ProjectOperationsService;
  const result = yield* Effect.result(operations.readIssue(issueId));
  return Result.isFailure(result)
    ? yield* issueFailure(result.failure)
    : json(issueResponse(result.success));
});
const readNumberedIssueResponse = Effect.fn("Gateway.readNumberedIssue")(function* (
  projectId: ProjectId,
  number: IssueNumber,
) {
  const operations = yield* ProjectOperationsService;
  const result = yield* Effect.result(operations.readIssueByNumber(projectId, number));
  return Result.isFailure(result)
    ? yield* issueFailure(result.failure)
    : json(issueResponse(result.success));
});
const revisionsResponse = Effect.fn("Gateway.readIssueRevisions")(function* (issueId: IssueId) {
  const operations = yield* ProjectOperationsService;
  const result = yield* Effect.result(operations.readIssueRevisions(issueId));
  if (Result.isFailure(result)) return yield* issueFailure(result.failure);
  return json(
    IssueRevisionCollection.make({
      items: result.success.map((revision) =>
        IssueRevisionResponse.make({
          field: revision.field,
          number: revision.number,
          value: revision.field === "title" ? revision.value : Option.getOrNull(revision.value),
          actor: apiActor(revision.actor),
          agent_session: apiAgentSession(revision.agentSession),
          created_at: revision.createdAt,
        }),
      ),
      links: {
        self: { href: `/api/issues/${issueId}/revisions` },
        issue: { href: `/api/issues/${issueId}` },
      },
    }),
  );
});
const timelineResponse = Effect.fn("Gateway.readIssueTimeline")(function* (issueId: IssueId) {
  const operations = yield* ProjectOperationsService;
  const result = yield* Effect.result(operations.readIssueTimeline(issueId));
  if (Result.isFailure(result)) return yield* issueFailure(result.failure);
  return json(
    IssueTimelineCollection.make({
      items: result.success.map((entry) =>
        IssueTimelineEntryResponse.make({
          position: entry.position,
          event: {
            id: entry.event.id,
            kind: entry.event.kind,
            source_issue_id: entry.event.sourceIssueId,
            target_issue_id:
              entry.event.kind === "issue_created" ? null : entry.event.targetIssueId,
            actor: apiActor(entry.event.actor),
            agent_session: apiAgentSession(entry.event.agentSession),
            created_at: entry.event.createdAt,
          },
        }),
      ),
      links: {
        self: { href: `/api/issues/${issueId}/timeline` },
        issue: { href: `/api/issues/${issueId}` },
      },
    }),
  );
});
const referencesResponse = Effect.fn("Gateway.readIssueReferences")(function* (issueId: IssueId) {
  const operations = yield* ProjectOperationsService;
  const result = yield* Effect.result(operations.readIssueReferences(issueId));
  if (Result.isFailure(result)) return yield* issueFailure(result.failure);
  return json(
    IssueReferenceCollection.make({
      outgoing: result.success.outgoing.map((reference) => ({
        source_issue_id: reference.sourceIssueId,
        target_issue_id: reference.targetIssueId,
      })),
      incoming: result.success.incoming.map((reference) => ({
        source_issue_id: reference.sourceIssueId,
        target_issue_id: reference.targetIssueId,
      })),
      links: {
        self: { href: `/api/issues/${issueId}/references` },
        issue: { href: `/api/issues/${issueId}` },
      },
    }),
  );
});

/** Issue HTTP handlers backed by routed Project operations. */
export const layer = HttpApiBuilder.group(OverseerApi, "issues", (handlers) =>
  handlers
    .handle("listIssues", ({ params, query }) => listIssuesResponse(params.project_id, query))
    .handle("headIssues", ({ params, query }) => listIssuesResponse(params.project_id, query))
    .handle("createIssue", ({ params, headers, payload }) =>
      createIssueResponse(
        params.project_id,
        payload.title,
        Option.fromNullishOr(payload.body),
        headers["idempotency-key"],
      ),
    )
    .handle("readIssue", ({ params }) => readCanonicalIssueResponse(params.issue_id))
    .handle("headIssue", ({ params }) => readCanonicalIssueResponse(params.issue_id))
    .handle("readNumberedIssue", ({ params }) =>
      readNumberedIssueResponse(params.project_id, params.issue_number),
    )
    .handle("headNumberedIssue", ({ params }) =>
      readNumberedIssueResponse(params.project_id, params.issue_number),
    )
    .handle("readIssueRevisions", ({ params }) => revisionsResponse(params.issue_id))
    .handle("readIssueTimeline", ({ params }) => timelineResponse(params.issue_id))
    .handle("readIssueReferences", ({ params }) => referencesResponse(params.issue_id)),
);
