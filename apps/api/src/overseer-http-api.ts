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
import { OverseerRequestId, OVERSEER_REQUEST_ID_HEADER } from "./request-id.ts";
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

const WorkspaceApiResponse = Workspace.pipe(
  Schema.annotateEncoded({
    description: "Workspace state after the requested operation completes.",
    examples: [workspaceApiExample],
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

const overseerRequestIdOpenApiHeader = {
  description: "Application request correlation ID for support, logs, and traces.",
  required: true,
  schema: {
    type: "string",
    pattern: "^request_[A-Z0-9]{26}$",
    example: "request_01KZGWMQ4054AXZGW9RR1VJ3JM",
  },
} as const;

const workspaceArchivedApiExample = {
  ...workspaceApiExample,
  state: "archived",
  updatedAt: "2026-08-08T14:35:41.913Z",
} as const;

const workspaceApiRequestExamplesByOperation = {
  "Create Workspace": { name: "Product Engineering" },
  "Rename Workspace": { name: "Platform Engineering" },
} as const;

const workspaceApiExamplesByOperation = {
  "Archive Workspace": workspaceArchivedApiExample,
  "Create Workspace": workspaceApiExample,
  "Get Workspace": workspaceApiExample,
  "Rename Workspace": {
    ...workspaceApiExample,
    name: "Platform Engineering",
    updatedAt: "2026-08-08T14:35:11.913Z",
  },
  "Unarchive Workspace": {
    ...workspaceApiExample,
    updatedAt: "2026-08-08T14:36:11.913Z",
  },
} as const;

const publicApiErrorExamplesByStatus = {
  "401": {
    message: "A valid Cf-Access-Jwt-Assertion header is required.",
  },
  "404": {
    code: "workspace_not_found",
    message:
      "Workspace not found: Workspace workspace_01KZGWRATYFXD8QCG7QTKG5C3S was not found. Check the Workspace ID and try again.",
    requestId: "request_01KZGWMQ4054AXZGW9RR1VJ3JM",
    retryable: false,
    details: {
      workspaceId: "workspace_01KZGWRATYFXD8QCG7QTKG5C3S",
      operation: "get",
    },
  },
  "500": {
    code: "workspace_operation_failed",
    message:
      "Workspace operation failed: the requested Workspace read could not be completed because Overseer encountered an internal consistency problem. Contact support with request ID request_01KZGWMQ4054AXZGW9RR1VJ3JM.",
    requestId: "request_01KZGWMQ4054AXZGW9RR1VJ3JM",
    retryable: false,
    details: {
      workspaceId: null,
      operation: "create",
    },
  },
  "503": {
    code: "workspace_service_unavailable",
    message:
      "Workspace service unavailable: the requested Workspace creation could not be completed because a required Overseer service is temporarily unavailable. Do not retry this operation automatically; contact support with request ID request_01KZGWMQ4054AXZGW9RR1VJ3JM.",
    requestId: "request_01KZGWMQ4054AXZGW9RR1VJ3JM",
    retryable: false,
    details: {
      workspaceId: null,
      operation: "create",
    },
  },
} as const;

const isOpenApiRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const addOverseerOpenApiResponseHeaders = (
  openApiSpec: Record<string, unknown>,
): Record<string, unknown> => {
  if (!isOpenApiRecord(openApiSpec.paths)) {
    return openApiSpec;
  }

  const components = isOpenApiRecord(openApiSpec.components)
    ? {
        ...openApiSpec.components,
        securitySchemes: isOpenApiRecord(openApiSpec.components.securitySchemes)
          ? {
              ...openApiSpec.components.securitySchemes,
              accessAssertion: isOpenApiRecord(
                openApiSpec.components.securitySchemes.accessAssertion,
              )
                ? {
                    ...openApiSpec.components.securitySchemes.accessAssertion,
                    description:
                      "Cloudflare Access assertion sent in the Cf-Access-Jwt-Assertion header.",
                  }
                : openApiSpec.components.securitySchemes.accessAssertion,
            }
          : openApiSpec.components.securitySchemes,
      }
    : openApiSpec.components;

  return {
    ...openApiSpec,
    components,
    paths: Object.fromEntries(
      Object.entries(openApiSpec.paths).map(([path, pathItem]) => {
        if (!isOpenApiRecord(pathItem)) {
          return [path, pathItem];
        }

        return [
          path,
          Object.fromEntries(
            Object.entries(pathItem).map(([method, operation]) => {
              if (!isOpenApiRecord(operation) || !isOpenApiRecord(operation.responses)) {
                return [method, operation];
              }

              const workspaceExample =
                typeof operation.summary === "string"
                  ? workspaceApiExamplesByOperation[
                      operation.summary as keyof typeof workspaceApiExamplesByOperation
                    ]
                  : undefined;

              const requestExample =
                typeof operation.summary === "string"
                  ? workspaceApiRequestExamplesByOperation[
                      operation.summary as keyof typeof workspaceApiRequestExamplesByOperation
                    ]
                  : undefined;
              const requestBody =
                isOpenApiRecord(operation.requestBody) &&
                isOpenApiRecord(operation.requestBody.content)
                  ? {
                      ...operation.requestBody,
                      content: Object.fromEntries(
                        Object.entries(operation.requestBody.content).map(
                          ([contentType, mediaType]) => [
                            contentType,
                            isOpenApiRecord(mediaType) && requestExample !== undefined
                              ? { ...mediaType, example: requestExample }
                              : mediaType,
                          ],
                        ),
                      ),
                    }
                  : operation.requestBody;

              return [
                method,
                {
                  ...operation,
                  requestBody,
                  responses: Object.fromEntries(
                    Object.entries(operation.responses).map(([status, response]) => {
                      if (!isOpenApiRecord(response)) {
                        return [status, response];
                      }

                      const responseExample =
                        publicApiErrorExamplesByStatus[
                          status as keyof typeof publicApiErrorExamplesByStatus
                        ] ?? (status.startsWith("2") ? workspaceExample : undefined);
                      const content = isOpenApiRecord(response.content)
                        ? Object.fromEntries(
                            Object.entries(response.content).map(([contentType, mediaType]) => [
                              contentType,
                              isOpenApiRecord(mediaType) && responseExample !== undefined
                                ? {
                                    ...mediaType,
                                    examples: { example: { value: responseExample } },
                                  }
                                : mediaType,
                            ]),
                          )
                        : response.content;

                      const headers = isOpenApiRecord(response.headers)
                        ? { ...response.headers }
                        : {};
                      headers[OVERSEER_REQUEST_ID_HEADER] = overseerRequestIdOpenApiHeader;

                      return [
                        status,
                        {
                          ...response,
                          content,
                          headers,
                        },
                      ];
                    }),
                  ),
                },
              ];
            }),
          ),
        ];
      }),
    ),
  };
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
  success: WorkspaceApiResponse.pipe(HttpApiSchema.status("Created")),
  error: [WorkspaceOperationFailedApiError, WorkspaceServiceUnavailableApiError],
}).annotateMerge(
  OpenApi.annotations({
    summary: "Create Workspace",
    description:
      "Creates a Workspace and returns its canonical ID for subsequent Workspace operations.",
  }),
);

const getWorkspaceEndpoint = HttpApiEndpoint.get("getWorkspace", "/v1/workspaces/:workspaceId", {
  params: WorkspaceApiParams,
  success: WorkspaceApiResponse,
  error: [
    WorkspaceNotFoundApiError,
    WorkspaceOperationFailedApiError,
    WorkspaceServiceUnavailableApiError,
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
    success: WorkspaceApiResponse,
    error: [
      WorkspaceNotFoundApiError,
      WorkspaceOperationFailedApiError,
      WorkspaceServiceUnavailableApiError,
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
    success: WorkspaceApiResponse,
    error: [
      WorkspaceNotFoundApiError,
      WorkspaceOperationFailedApiError,
      WorkspaceServiceUnavailableApiError,
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
    success: WorkspaceApiResponse,
    error: [
      WorkspaceNotFoundApiError,
      WorkspaceOperationFailedApiError,
      WorkspaceServiceUnavailableApiError,
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
      externalDocs: {
        url: "https://github.com/dmmulroy/overseer/blob/main/docs/errors.md",
        description: "Overseer error response design and request-correlation guidance",
      },
      transform: addOverseerOpenApiResponseHeaders,
    }),
  ) {}
