import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  CreateIssueRpcInput,
  CreateIssueRpcResult,
  IssueReferencesRpcResult,
  IssueRevisionsRpcResult,
  IssueTimelineRpcResult,
  ProjectClientService,
  ProjectRpcCallFailed,
  type ProjectRpc,
} from "../../application/project/project-rpc.ts";
import type { ProjectId } from "../../domain/entity-id.ts";
import { Issue } from "../../domain/issue.ts";
import { ProjectObject } from "../../infra/project-resource.ts";

type RpcOperation = keyof ProjectRpc;

function decodeRpcResponse<A>(
  schema: Schema.Decoder<A>,
  value: unknown,
  operation: RpcOperation,
): Effect.Effect<A, ProjectRpcCallFailed> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new ProjectRpcCallFailed({ operation, cause })),
  );
}

function withRpcCallError<A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E | Cloudflare.RpcCallError> {
  // SAFETY: Alchemy's schemaless stub can fail with RpcCallError when native JSRPC rejects, but its Shape mapping omits that transport error from the static method type.
  return effect as Effect.Effect<A, E | Cloudflare.RpcCallError>;
}
function rpcCall<A, E>(
  effect: Effect.Effect<A, E>,
  operation: RpcOperation,
): Effect.Effect<A, E | ProjectRpcCallFailed> {
  return withRpcCallError(effect).pipe(
    Effect.catchIf(
      (error): error is Cloudflare.RpcCallError => error instanceof Cloudflare.RpcCallError,
      (cause) =>
        Effect.logError("Project RPC call failed").pipe(
          Effect.annotateLogs({ error_type: cause._tag, operation, rpc_method: cause.method }),
          Effect.andThen(Effect.fail(new ProjectRpcCallFailed({ operation, cause }))),
        ),
    ),
  );
}

/** Construct the Gateway Project client from the hosted Alchemy namespace. */
export const make = Effect.gen(function* () {
  const projects = yield* ProjectObject;
  const stub = (projectId: ProjectId) => projects.getByName(projectId);
  return ProjectClientService.of({
    createIssue: Effect.fn("ProjectRpc.createIssue")((input) =>
      Schema.encodeEffect(CreateIssueRpcInput)(input).pipe(
        Effect.orDie,
        Effect.flatMap((encoded) =>
          rpcCall(stub(input.projectId).createIssue(encoded), "createIssue"),
        ),
        Effect.flatMap((result) => decodeRpcResponse(CreateIssueRpcResult, result, "createIssue")),
      ),
    ),
    readIssue: Effect.fn("ProjectRpc.readIssue")((projectId, issueId) =>
      rpcCall(stub(projectId).readIssue(issueId), "readIssue").pipe(
        Effect.flatMap((result) => decodeRpcResponse(Issue, result, "readIssue")),
      ),
    ),
    readIssueByNumber: Effect.fn("ProjectRpc.readIssueByNumber")((projectId, number) =>
      rpcCall(stub(projectId).readIssueByNumber(number), "readIssueByNumber").pipe(
        Effect.flatMap((result) => decodeRpcResponse(Issue, result, "readIssueByNumber")),
      ),
    ),
    readIssueRevisions: Effect.fn("ProjectRpc.readIssueRevisions")((projectId, issueId) =>
      rpcCall(stub(projectId).readIssueRevisions(issueId), "readIssueRevisions").pipe(
        Effect.flatMap((result) =>
          decodeRpcResponse(IssueRevisionsRpcResult, result, "readIssueRevisions"),
        ),
      ),
    ),
    readIssueTimeline: Effect.fn("ProjectRpc.readIssueTimeline")((projectId, issueId) =>
      rpcCall(stub(projectId).readIssueTimeline(issueId), "readIssueTimeline").pipe(
        Effect.flatMap((result) =>
          decodeRpcResponse(IssueTimelineRpcResult, result, "readIssueTimeline"),
        ),
      ),
    ),
    readIssueReferences: Effect.fn("ProjectRpc.readIssueReferences")((projectId, issueId) =>
      rpcCall(stub(projectId).readIssueReferences(issueId), "readIssueReferences").pipe(
        Effect.flatMap((result) =>
          decodeRpcResponse(IssueReferencesRpcResult, result, "readIssueReferences"),
        ),
      ),
    ),
  });
});

/** Adapt the hosted Alchemy Project namespace to the Gateway application interface. */
export const layer = Layer.effect(ProjectClientService, make);
