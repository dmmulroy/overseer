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
  IssueReferenceCollection,
  IssueResponse,
  IssueRevisionCollection,
  IssueRevisionResponse,
  IssueTimelineCollection,
  IssueTimelineEntryResponse,
  OverseerApi,
} from "../../contract/http-api.ts";
import { CommandAttribution, type Actor, type AgentSession } from "../../domain/actor.ts";
import type { IssueId, ProjectId } from "../../domain/entity-id.ts";
import type { IdempotencyKey } from "../../domain/idempotency.ts";
import type { Issue, IssueBody, IssueNumber, IssueTitle } from "../../domain/issue.ts";
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
function json(value: unknown, status = 200, headers?: Readonly<Record<string, string>>) {
  return HttpServerResponse.jsonUnsafe(value, { status, headers });
}
const issueFailure = Effect.fn("Gateway.issueFailure")(function* (failure: ProjectOperationError) {
  const context = yield* GatewayRequestContext;
  const problems = yield* ProblemResponse;
  switch (failure._tag) {
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
  return json(issueResponse(result.success.issue), 201, {
    location: `/api/issues/${result.success.issue.id}`,
    ...(result.success.replayed ? { "idempotency-replayed": "true" } : {}),
  });
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
