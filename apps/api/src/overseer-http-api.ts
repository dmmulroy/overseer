import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi";
import { AccessAuthenticationMiddleware } from "./access-authentication-middleware.ts";
import { Workspace, WorkspaceId } from "./domain/workspace.ts";
import { OverseerRequestId } from "./request-id.ts";
import { RequestIdMiddleware } from "./request-id-middleware.ts";

/** Workspace operation names exposed as structured API error context. */
export const WorkspaceApiOperation = Schema.Literals([
  "create",
  "get",
  "rename",
  "archive",
  "unarchive",
]);

/** A Workspace operation exposed as structured API error context. */
export type WorkspaceApiOperation = typeof WorkspaceApiOperation.Type;

const WorkspaceNotFoundApiErrorDetails = Schema.Struct({
  workspaceId: WorkspaceId,
  operation: Schema.Literals(["get", "rename", "archive", "unarchive"]),
});

const WorkspaceOperationApiErrorDetails = Schema.Struct({
  workspaceId: Schema.OptionFromNullOr(WorkspaceId),
  operation: WorkspaceApiOperation,
});

/** A syntactically valid Workspace identity that Overseer does not know. */
export class WorkspaceNotFoundApiError extends Schema.ErrorClass<WorkspaceNotFoundApiError>(
  "WorkspaceNotFoundApiError",
)(
  {
    code: Schema.Literal("workspace_not_found"),
    message: Schema.String,
    requestId: OverseerRequestId,
    retryable: Schema.Literal(false),
    details: WorkspaceNotFoundApiErrorDetails,
  },
  { httpApiStatus: 404 },
) {}

/** A non-transient internal failure that prevented a Workspace operation. */
export class WorkspaceOperationFailedApiError extends Schema.ErrorClass<WorkspaceOperationFailedApiError>(
  "WorkspaceOperationFailedApiError",
)(
  {
    code: Schema.Literal("workspace_operation_failed"),
    message: Schema.String,
    requestId: OverseerRequestId,
    retryable: Schema.Literal(false),
    details: WorkspaceOperationApiErrorDetails,
  },
  { httpApiStatus: 500 },
) {}

/** A temporarily unavailable capability that prevented a Workspace operation. */
export class WorkspaceServiceUnavailableApiError extends Schema.ErrorClass<WorkspaceServiceUnavailableApiError>(
  "WorkspaceServiceUnavailableApiError",
)(
  {
    code: Schema.Literal("workspace_service_unavailable"),
    message: Schema.String,
    requestId: OverseerRequestId,
    retryable: Schema.Boolean,
    details: WorkspaceOperationApiErrorDetails,
  },
  { httpApiStatus: 503 },
) {}

const workspaceApiExample = {
  id: "workspace_01KZGWRATYFXD8QCG7QTKG5C3S",
  name: "Product Engineering",
  state: "active",
  createdAt: "2026-08-08T14:34:41.913Z",
  updatedAt: "2026-08-08T14:34:41.913Z",
} as const;

const workspaceRenamedApiExample = {
  ...workspaceApiExample,
  name: "Platform Engineering",
  updatedAt: "2026-08-08T14:35:11.913Z",
} as const;

const workspaceArchivedApiExample = {
  ...workspaceApiExample,
  state: "archived",
  updatedAt: "2026-08-08T14:35:41.913Z",
} as const;

const workspaceUnarchivedApiExample = {
  ...workspaceApiExample,
  updatedAt: "2026-08-08T14:36:11.913Z",
} as const;

const workspaceApiResponse = (example: typeof Workspace.Encoded) =>
  Workspace.pipe(
    Schema.annotateEncoded({
      description: "Workspace state after the requested operation completes.",
      examples: [example],
    }),
  );

const CreateWorkspaceApiPayload = Schema.Struct({ name: Workspace.fields.name }).pipe(
  Schema.annotateEncoded({
    description: "Input required to create a Workspace.",
    examples: [{ name: "Product Engineering" }],
  }),
);

const RenameWorkspaceApiPayload = Schema.Struct({ name: Workspace.fields.name }).pipe(
  Schema.annotateEncoded({
    description: "Input required to replace a Workspace display name.",
    examples: [{ name: "Platform Engineering" }],
  }),
);

const WorkspaceApiParams = { workspaceId: WorkspaceId };
const exampleRequestId = "request_01KZGWMQ4054AXZGW9RR1VJ3JM" as const;

type ExistingWorkspaceApiOperation = Exclude<WorkspaceApiOperation, "create">;

const workspaceApiOperationLabel = (operation: WorkspaceApiOperation): string => {
  switch (operation) {
    case "create":
      return "creation";
    case "get":
      return "read";
    case "rename":
      return "rename";
    case "archive":
      return "archive";
    case "unarchive":
      return "unarchive";
  }
};

const workspaceNotFoundApiResponse = (operation: ExistingWorkspaceApiOperation) =>
  WorkspaceNotFoundApiError.pipe(
    Schema.annotateEncoded({
      examples: [
        {
          code: "workspace_not_found",
          message: `Workspace not found: Workspace ${workspaceApiExample.id} was not found. Check the Workspace ID and try again.`,
          requestId: exampleRequestId,
          retryable: false,
          details: { workspaceId: workspaceApiExample.id, operation },
        },
      ],
    }),
  );

const workspaceOperationFailedApiResponse = (operation: WorkspaceApiOperation) => {
  const workspaceId = operation === "create" ? null : workspaceApiExample.id;
  const identity = workspaceId === null ? "the requested Workspace" : `Workspace ${workspaceId}`;

  return WorkspaceOperationFailedApiError.pipe(
    Schema.annotateEncoded({
      examples: [
        {
          code: "workspace_operation_failed",
          message: `Workspace operation failed: ${identity} ${workspaceApiOperationLabel(operation)} could not be completed because Overseer encountered an internal consistency problem. Contact support with request ID ${exampleRequestId}.`,
          requestId: exampleRequestId,
          retryable: false,
          details: { workspaceId, operation },
        },
      ],
    }),
  );
};

const workspaceServiceUnavailableApiResponse = (operation: WorkspaceApiOperation) => {
  const workspaceId = operation === "create" ? null : workspaceApiExample.id;
  const identity = workspaceId === null ? "the requested Workspace" : `Workspace ${workspaceId}`;
  const retryable = operation !== "create";
  const recovery = retryable
    ? "Retry the same operation."
    : `Do not retry this operation automatically; contact support with request ID ${exampleRequestId}.`;

  return WorkspaceServiceUnavailableApiError.pipe(
    Schema.annotateEncoded({
      examples: [
        {
          code: "workspace_service_unavailable",
          message: `Workspace service unavailable: ${identity} ${workspaceApiOperationLabel(operation)} could not be completed because a required Overseer service is temporarily unavailable. ${recovery}`,
          requestId: exampleRequestId,
          retryable,
          details: { workspaceId, operation },
        },
      ],
    }),
  );
};

const getApiIdentityEndpoint = HttpApiEndpoint.get("getApiIdentity", "/", {
  success: Schema.String.pipe(Schema.annotateEncoded({ examples: ["Overseer API"] })),
}).annotateMerge(
  OpenApi.annotations({
    summary: "Get API identity",
    description: "Confirms that the authenticated Overseer API is reachable.",
  }),
);

const createWorkspaceEndpoint = HttpApiEndpoint.post("createWorkspace", "/v1/workspaces", {
  payload: CreateWorkspaceApiPayload,
  success: workspaceApiResponse(workspaceApiExample).pipe(HttpApiSchema.status("Created")),
  error: [
    workspaceOperationFailedApiResponse("create"),
    workspaceServiceUnavailableApiResponse("create"),
  ],
}).annotateMerge(
  OpenApi.annotations({
    summary: "Create Workspace",
    description:
      "Creates a Workspace and returns its canonical ID for subsequent Workspace operations.",
  }),
);

const getWorkspaceEndpoint = HttpApiEndpoint.get("getWorkspace", "/v1/workspaces/:workspaceId", {
  params: WorkspaceApiParams,
  success: workspaceApiResponse(workspaceApiExample),
  error: [
    workspaceNotFoundApiResponse("get"),
    workspaceOperationFailedApiResponse("get"),
    workspaceServiceUnavailableApiResponse("get"),
  ],
}).annotateMerge(
  OpenApi.annotations({
    summary: "Get Workspace",
    description: "Returns a Workspace by the canonical ID returned from create Workspace.",
  }),
);

const renameWorkspaceEndpoint = HttpApiEndpoint.post(
  "renameWorkspace",
  "/v1/workspaces/:workspaceId/rename",
  {
    params: WorkspaceApiParams,
    payload: RenameWorkspaceApiPayload,
    success: workspaceApiResponse(workspaceRenamedApiExample),
    error: [
      workspaceNotFoundApiResponse("rename"),
      workspaceOperationFailedApiResponse("rename"),
      workspaceServiceUnavailableApiResponse("rename"),
    ],
  },
).annotateMerge(
  OpenApi.annotations({
    summary: "Rename Workspace",
    description:
      "Replaces a Workspace display name using the canonical Workspace ID returned from create Workspace.",
  }),
);

const archiveWorkspaceEndpoint = HttpApiEndpoint.post(
  "archiveWorkspace",
  "/v1/workspaces/:workspaceId/archive",
  {
    params: WorkspaceApiParams,
    success: workspaceApiResponse(workspaceArchivedApiExample),
    error: [
      workspaceNotFoundApiResponse("archive"),
      workspaceOperationFailedApiResponse("archive"),
      workspaceServiceUnavailableApiResponse("archive"),
    ],
  },
).annotateMerge(
  OpenApi.annotations({
    summary: "Archive Workspace",
    description:
      "Changes a Workspace state to archived using the canonical Workspace ID returned from create Workspace.",
  }),
);

const unarchiveWorkspaceEndpoint = HttpApiEndpoint.post(
  "unarchiveWorkspace",
  "/v1/workspaces/:workspaceId/unarchive",
  {
    params: WorkspaceApiParams,
    success: workspaceApiResponse(workspaceUnarchivedApiExample),
    error: [
      workspaceNotFoundApiResponse("unarchive"),
      workspaceOperationFailedApiResponse("unarchive"),
      workspaceServiceUnavailableApiResponse("unarchive"),
    ],
  },
).annotateMerge(
  OpenApi.annotations({
    summary: "Unarchive Workspace",
    description:
      "Changes a Workspace state to active using the canonical Workspace ID returned from create Workspace.",
  }),
);

/** Root HTTP operations exposed by the Overseer API Worker. */
export class OverseerHttpApiGroup extends HttpApiGroup.make("overseer")
  .annotateMerge(
    OpenApi.annotations({
      title: "Overseer",
      description: "Authenticated Workspace lifecycle operations.",
    }),
  )
  .add(getApiIdentityEndpoint)
  .add(createWorkspaceEndpoint)
  .add(getWorkspaceEndpoint)
  .add(renameWorkspaceEndpoint)
  .add(archiveWorkspaceEndpoint)
  .add(unarchiveWorkspaceEndpoint) {}

/** Authenticated HTTP contract served by the Overseer API Worker. */
export class OverseerHttpApi extends HttpApi.make("OverseerHttpApi")
  .add(OverseerHttpApiGroup)
  .middleware(AccessAuthenticationMiddleware)
  .middleware(RequestIdMiddleware)
  .annotateMerge(
    OpenApi.annotations({
      title: "Overseer API",
      version: "0.0.0",
      description:
        "Authenticated API for managing Overseer Workspaces. Every response includes X-Overseer-Request-Id for support, logs, and traces.",
      servers: [
        {
          url: "http://localhost:8787",
          description: "Local Alchemy development server",
        },
      ],
      override: {
        externalDocs: {
          url: "https://github.com/dmmulroy/overseer/blob/main/docs/errors.md",
          description: "Overseer error response design and request-correlation guidance",
        },
      },
    }),
  ) {}
