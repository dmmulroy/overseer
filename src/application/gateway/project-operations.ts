import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { IssueId, ProjectId } from "../../domain/entity-id.ts";
import type { Issue, IssueNumber, IssueRevision, IssueTimelineEntry } from "../../domain/issue.ts";
import type { SteerIssueStateInput, SteerIssueStateResult } from "../issues/issue-steering.ts";
import type {
  CreateIssueInput,
  CreateIssueResult,
  IssueCursorInvalid,
  IssueNotFound,
  IssuePage,
  ListIssuesInput,
  ProjectIdempotencyKeyReused,
} from "../issues/issue-discovery.ts";
import {
  ProjectClientService,
  type IssueReferencesRpcResult,
  type ProjectRecordCorrupt,
  type ProjectRpcCallFailed,
  type ProjectStateUnavailable,
} from "../project/project-rpc.ts";
import { WorkspaceRegistryService } from "../workspace-registry/workspace-registry.ts";
import type {
  IssueOwnerNotFound,
  ProjectNotFound,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryRpcCallFailed,
  WorkspaceRegistryStateUnavailable,
} from "../workspace-registry/workspace-registry-rpc.ts";

/** Expected failures while routing one Project-local operation through the Gateway. */
export type ProjectOperationError =
  | IssueCursorInvalid
  | IssueNotFound
  | IssueOwnerNotFound
  | ProjectNotFound
  | ProjectIdempotencyKeyReused
  | ProjectRecordCorrupt
  | ProjectStateUnavailable
  | ProjectRpcCallFailed
  | WorkspaceRegistryRecordCorrupt
  | WorkspaceRegistryStateUnavailable
  | WorkspaceRegistryRpcCallFailed;

/** Gateway policy for routing admitted Project-local Issue operations. */
export type ProjectOperations = {
  readonly createIssue: (
    input: CreateIssueInput,
  ) => Effect.Effect<CreateIssueResult, ProjectOperationError>;
  readonly closeIssue: (
    input: SteerIssueStateInput,
  ) => Effect.Effect<SteerIssueStateResult, ProjectOperationError>;
  readonly reopenIssue: (
    input: SteerIssueStateInput,
  ) => Effect.Effect<SteerIssueStateResult, ProjectOperationError>;
  readonly listIssues: (input: ListIssuesInput) => Effect.Effect<IssuePage, ProjectOperationError>;
  readonly readIssue: (issueId: IssueId) => Effect.Effect<Issue, ProjectOperationError>;
  readonly readIssueByNumber: (
    projectId: ProjectId,
    number: IssueNumber,
  ) => Effect.Effect<Issue, ProjectOperationError>;
  readonly readIssueRevisions: (
    issueId: IssueId,
  ) => Effect.Effect<ReadonlyArray<IssueRevision>, ProjectOperationError>;
  readonly readIssueTimeline: (
    issueId: IssueId,
  ) => Effect.Effect<ReadonlyArray<IssueTimelineEntry>, ProjectOperationError>;
  readonly readIssueReferences: (
    issueId: IssueId,
  ) => Effect.Effect<IssueReferencesRpcResult, ProjectOperationError>;
};

/** Effect service for Gateway Project-local operation routing and admission. */
export class ProjectOperationsService extends Context.Service<
  ProjectOperationsService,
  ProjectOperations
>()("@overseer/application/ProjectOperations") {}

/** Construct Gateway Project routing policy from Registry and Project capabilities. */
export const make = Effect.gen(function* () {
  const registry = yield* WorkspaceRegistryService;
  const projects = yield* ProjectClientService;
  const owner = Effect.fn("ProjectOperations.resolveIssueOwner")((issueId: IssueId) =>
    registry.readIssueOwner(issueId),
  );

  return ProjectOperationsService.of({
    createIssue: Effect.fn("ProjectOperations.createIssue")(function* (input) {
      yield* registry.readProject(input.projectId);
      const created = yield* projects.createIssue(input);
      yield* registry.registerIssueOwner({ issueId: created.issue.id, projectId: input.projectId });
      return created;
    }),
    closeIssue: Effect.fn("ProjectOperations.closeIssue")(function* (input) {
      const projectId = yield* owner(input.issueId);
      yield* registry.readProject(projectId);
      return yield* projects.closeIssue(projectId, input);
    }),
    reopenIssue: Effect.fn("ProjectOperations.reopenIssue")(function* (input) {
      const projectId = yield* owner(input.issueId);
      yield* registry.readProject(projectId);
      return yield* projects.reopenIssue(projectId, input);
    }),
    listIssues: Effect.fn("ProjectOperations.listIssues")(function* (input) {
      yield* registry.readProject(input.projectId);
      return yield* projects.listIssues(input);
    }),
    readIssue: Effect.fn("ProjectOperations.readIssue")(function* (issueId) {
      const projectId = yield* owner(issueId);
      yield* registry.readProject(projectId);
      return yield* projects.readIssue(projectId, issueId);
    }),
    readIssueByNumber: Effect.fn("ProjectOperations.readIssueByNumber")(
      function* (projectId, number) {
        yield* registry.readProject(projectId);
        return yield* projects.readIssueByNumber(projectId, number);
      },
    ),
    readIssueRevisions: Effect.fn("ProjectOperations.readIssueRevisions")(function* (issueId) {
      const projectId = yield* owner(issueId);
      yield* registry.readProject(projectId);
      return yield* projects.readIssueRevisions(projectId, issueId);
    }),
    readIssueTimeline: Effect.fn("ProjectOperations.readIssueTimeline")(function* (issueId) {
      const projectId = yield* owner(issueId);
      yield* registry.readProject(projectId);
      return yield* projects.readIssueTimeline(projectId, issueId);
    }),
    readIssueReferences: Effect.fn("ProjectOperations.readIssueReferences")(function* (issueId) {
      const projectId = yield* owner(issueId);
      yield* registry.readProject(projectId);
      return yield* projects.readIssueReferences(projectId, issueId);
    }),
  });
});

/** Production Gateway Project-operation policy layer. */
export const layer = Layer.effect(ProjectOperationsService, make);
