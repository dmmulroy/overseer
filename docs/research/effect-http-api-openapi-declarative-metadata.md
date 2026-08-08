# Effect HTTP API OpenAPI declarative metadata in `4.0.0-beta.102`

**Research status:** verified against the pinned `effect@4.0.0-beta.102` in `node_modules`, the identical source checkout in `repos/effect`, Effect's first-party tests, and the current Overseer API/OpenAPI output. No application code was changed and no subagent was used.

## Conclusion

`apps/api/src/overseer-http-api.ts` should **not keep traversing the complete OpenAPI document as an unknown record**.

Most of the current transform is already supported declaratively:

- request and response body examples belong on encoded `Schema` metadata;
- the Access API-key description belongs on the `HttpApiSecurity` value;
- API/group/operation title, version, description, summary, servers, and endpoint/group external docs have direct `OpenApi` annotations.

Two exact output shapes are **not first-class in this pinned release**:

1. response-header documentation; and
2. OpenAPI Media Type Object `example` / `examples` fields (as distinct from JSON Schema's `examples`).

Effect's generated response and media-type models contain neither field. If exact Media Type Object placement is not a hard requirement, schema examples are the declarative replacement and the duplicated media examples should be deleted. Response headers still require an OpenAPI escape hatch. The least fragile escape hatch is a small **endpoint operation transform** that adds the header to `operation.responses`, not an API-level transform that discovers `paths`, methods, request bodies, components, and responses through runtime record guards.

There is one additional bug: the API-level `externalDocs` currently passed to `OpenApi.annotations` is ignored by this version. `ExternalDocs` is consumed only for group tags and endpoint operations. A top-level OpenAPI `externalDocs` object requires `override` or `transform`.

## Version and source identity

- `node_modules/effect/package.json` reports `4.0.0-beta.102`.
- `repos/effect` is at `f02a1e657e8e78a1a46b1c0dca9328e691e870ea`.
- `repos/effect/packages/effect/src/unstable/httpapi/OpenApi.ts` and `node_modules/effect/src/unstable/httpapi/OpenApi.ts` compare byte-for-byte equal.

Citations below use `node_modules/effect` for the exact installed API and `repos/effect` for first-party tests. The two source trees are identical for the cited module.

## Support matrix

| Current behavior                         | Pinned declarative support                          | Recommendation                                                                                  |
| ---------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Request examples                         | **Directly supported** as encoded schema `examples` | Keep/use `Schema.annotateEncoded`; delete request-example lookup and media-object duplication   |
| Response success examples                | **Directly supported** as encoded schema `examples` | Give each endpoint an example-specific response schema when examples differ by operation        |
| Error response examples                  | **Directly supported** as encoded schema `examples` | Annotate the error response schemas; use endpoint-specific wrappers if operation details differ |
| Access security description              | **Directly supported** on `HttpApiSecurity`         | Use `HttpApiSecurity.annotateMerge(OpenApi.annotations({ description }))`                       |
| Response header documentation            | **Unsupported first-class**                         | Retain only a small endpoint-operation transform, or omit the header documentation              |
| Media Type Object `example` / `examples` | **Unsupported first-class**                         | Prefer schema `examples`; only transform if exact media-object placement is mandatory           |
| API title/version/description/servers    | **Directly supported**                              | Keep current annotations                                                                        |
| Group title/description                  | **Directly supported**                              | Keep current annotations                                                                        |
| Endpoint summary/description             | **Directly supported**                              | Keep current annotations                                                                        |
| Top-level `externalDocs`                 | **Not wired to the API annotation in this version** | Move it to API `override: { externalDocs: ... }`                                                |

## Directly supported

### 1. Request and response examples through encoded Schema metadata

`Schema.annotateEncoded` annotates the encoded/wire side and accepts normal documentation metadata, including `examples` (`node_modules/effect/src/Schema.ts:613-676`). Effect's JSON Schema generation always includes the standard `examples` annotation (`Schema.ts:15258-15272`). OpenAPI generation converts endpoint payload and response schemas to OpenAPI 3.1 JSON Schema and patches those schemas into request/response content (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:374-414, 532-577, 589-616`).

This is already working in Overseer. The generated identity response has `schema.examples: ["Overseer API"]` without help from the transform (`apps/api/openapi.json:20-28`). The Workspace payload/response schemas also already carry schema examples from `Schema.annotateEncoded` (`apps/api/src/overseer-http-api.ts:86-105`; generated output begins at `apps/api/openapi.json:87-143`). The transform currently adds a second, redundant example at the media-type level.

Use endpoint-specific schema values when the same domain schema needs operation-specific examples:

```ts
const workspaceApiResponse = (example: typeof Workspace.Encoded) =>
  Workspace.pipe(
    Schema.annotateEncoded({
      description: "Workspace state after the requested operation completes.",
      examples: [example],
    }),
  );

const createWorkspaceEndpoint = HttpApiEndpoint.post("createWorkspace", "/v1/workspaces", {
  payload: CreateWorkspaceApiPayload,
  success: workspaceApiResponse(workspaceApiExample).pipe(HttpApiSchema.status("Created")),
  // ...
});

const archiveWorkspaceEndpoint = HttpApiEndpoint.post(
  "archiveWorkspace",
  "/v1/workspaces/:workspaceId/archive",
  {
    params: WorkspaceApiParams,
    success: workspaceApiResponse(workspaceArchivedApiExample),
    // ...
  },
);
```

`HttpApiSchema.status` is itself declarative schema metadata and accepts numeric or named statuses (`node_modules/effect/src/unstable/httpapi/HttpApiSchema.ts:148-168`); OpenAPI reads it when grouping success and error response bodies (`HttpApiSchema.ts:717-729`).

The request schemas already need no replacement beyond deleting the transform duplication:

```ts
const CreateWorkspaceApiPayload = Schema.Struct({
  name: Workspace.fields.name,
}).pipe(
  Schema.annotateEncoded({
    description: "Input required to create a Workspace.",
    examples: [{ name: "Product Engineering" }],
  }),
);
```

For error schemas, annotate the encoded response schema and use that schema in the endpoint/middleware declaration:

```ts
const WorkspaceNotFoundApiResponse = WorkspaceNotFoundApiError.pipe(
  Schema.annotateEncoded({
    examples: [publicApiErrorExamplesByStatus["404"]],
  }),
);

const WorkspaceOperationFailedApiResponse = WorkspaceOperationFailedApiError.pipe(
  Schema.annotateEncoded({
    examples: [publicApiErrorExamplesByStatus["500"]],
  }),
);
```

The same pattern works for middleware errors:

```ts
const AccessUnauthorizedApiResponse = AccessUnauthorized.pipe(
  Schema.annotateEncoded({
    examples: [
      {
        message: "A valid Cf-Access-Jwt-Assertion header is required.",
      },
    ],
  }),
);

// In HttpApiMiddleware.Service options:
error: AccessUnauthorizedApiResponse,
```

A local runtime probe against the pinned package confirmed that an encoded annotation on an `ErrorClass` response is emitted on its generated component schema, while preserving the annotated HTTP status.

**Modeling warning:** the current status-keyed transform gives every 404 example `details.operation: "get"` and every 500/503 example creation-oriented details, even on rename/archive/unarchive operations (`apps/api/src/overseer-http-api.ts:145-182, 273-286`). If examples are intended to describe each operation accurately, create endpoint-specific annotated error-schema wrappers rather than continuing a global status lookup.

### 2. Access security scheme description

Every `HttpApiSecurity` carries an annotation context, and `HttpApiSecurity.annotateMerge` merges OpenAPI annotations into it (`node_modules/effect/src/unstable/httpapi/HttpApiSecurity.ts:32-44, 210-238`). OpenAPI generation explicitly reads `OpenApi.Description` from the security value and puts it in the generated security scheme (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:830-866`). The API-key model itself includes `description?: string` (`OpenApi.ts:1111-1122`).

Exact replacement in `apps/api/src/access-authentication-middleware.ts`:

```ts
import {
  HttpApiMiddleware,
  HttpApiSecurity,
  OpenApi,
} from "effect/unstable/httpapi";

// ...

security: {
  accessAssertion: HttpApiSecurity.apiKey({
    in: "header",
    key: "Cf-Access-Jwt-Assertion",
  }).pipe(
    HttpApiSecurity.annotateMerge(
      OpenApi.annotations({
        description:
          "Cloudflare Access assertion sent in the Cf-Access-Jwt-Assertion header.",
      }),
    ),
  ),
},
```

This should replace the transform's traversal and rewrite of `components.securitySchemes.accessAssertion` (`apps/api/src/overseer-http-api.ts:194-212`).

### 3. Existing API/group/endpoint metadata

`OpenApi.annotations` directly exposes `identifier`, `title`, `version`, `description`, `license`, `summary`, `deprecated`, `externalDocs`, `servers`, `format`, `override`, `exclude`, and `transform` (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:159-213`). Generation consumes:

- API title/version/description/license/summary/servers (`OpenApi.ts:299-325`);
- group title/description/external docs (`OpenApi.ts:327-340`); and
- endpoint description/summary/deprecation/external docs (`OpenApi.ts:477-492`).

The existing title, version, descriptions, summaries, and servers should remain declarative.

## Unsupported first-class

### 1. Response headers

The pinned generator creates each response with only `description`, then optionally `content`; there is no response-header collection or middleware response metadata step (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:374-455`). The public generated model confirms that `OpenApiSpecResponse` has only `description` and optional `content` (`OpenApi.ts:1036-1045`). `OpenAPISpecOperation` points to that response model (`OpenApi.ts:1142-1159`).

Request headers are unrelated: `HttpApiEndpoint` header schemas become OpenAPI **request parameters** through `processParameters(..., "header")` (`OpenApi.ts:456-475, 579-586`). There is no symmetric response-header API in `HttpApiEndpoint`, `HttpApiSchema`, middleware annotations, or `OpenApiSpecResponse` in beta.102.

Therefore the `X-Overseer-Request-Id` response header cannot be represented through a typed first-class `HttpApi`/`HttpApiSchema` declaration in this version.

### 2. Media Type Object examples

The pinned `OpenApiSpecMediaType` contains only `schema` and optional `x-effect-stream`; it has neither `example` nor `examples` (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:1047-1073`). The request-body and response-body generation initializes each media object as `{ schema: {} }` before JSON Schema patching (`OpenApi.ts:391-414, 532-577`).

Consequently:

- `Schema.annotateEncoded({ examples })` emits JSON Schema `examples` under `content[type].schema`;
- it does **not** emit OpenAPI Media Type Object `content[type].example` or `.examples`.

The current transform's request `example` and response `examples` fields (`apps/api/src/overseer-http-api.ts:238-289`) can only be preserved exactly through `OpenApi.Override`/`OpenApi.Transform` or another post-processing step. They do not need to be preserved for the examples to remain documented: schema-level examples are valid generated OpenAPI 3.1 metadata and are already present.

## Escape hatches and the narrow response-header transform

`OpenApi.Override` shallowly assigns arbitrary fields to the generated API object, group tag, or endpoint operation; `OpenApi.Transform` replaces one of those generated objects (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:99-146, 331-353, 589-596, 641-655`). These are deliberate escape hatches, not typed response-header APIs.

An endpoint `override` is a poor fit for headers because overriding `responses` is shallow: it replaces the complete generated responses map and forces application code to reproduce generated descriptions, content, statuses, and schema placeholders. A scoped endpoint transform preserves generated response bodies and only adds headers.

Suggested fallback:

```ts
type OpenApiResponseWithHeaders = OpenApi.OpenApiSpecResponse & {
  readonly headers?: Readonly<Record<string, unknown>>;
};

const addRequestIdResponseHeader = (value: Record<string, any>): Record<string, any> => {
  // This transform is attached only to endpoints, so Effect passes an operation.
  const operation = value as unknown as OpenApi.OpenAPISpecOperation;

  return {
    ...operation,
    responses: Object.fromEntries(
      Object.entries(operation.responses).map(([status, response]) => [
        status,
        {
          ...(response as OpenApiResponseWithHeaders),
          headers: {
            ...(response as OpenApiResponseWithHeaders).headers,
            [OVERSEER_REQUEST_ID_HEADER]: overseerRequestIdOpenApiHeader,
          },
        },
      ]),
    ),
  };
};
```

Attach it to each public endpoint alongside the existing operation metadata:

```ts
OpenApi.annotations({
  summary: "Create Workspace",
  description: "Creates a Workspace and returns its canonical ID ...",
  transform: addRequestIdResponseHeader,
});
```

Endpoint transforms run after Effect has assembled security, payload, success, and middleware error responses, so this covers all generated statuses for that operation (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:477-596`). It eliminates the risky assumptions about `paths`, HTTP method keys, `summary` as an example lookup key, request bodies, components, and media types. It still uses an escape hatch because response headers are genuinely unsupported.

If repeating the annotation on each endpoint is undesirable, a final API transform may still be used, but it should cast the callback value once to `OpenApi.OpenAPISpec`—because its attachment site is known—and traverse `spec.paths` using Effect's exported model. The current sequence of `isOpenApiRecord` guards is not required by the pinned API.

## Top-level `externalDocs` bug

The current API annotation includes `externalDocs` (`apps/api/src/overseer-http-api.ts:433-450`), but `OpenApi.fromApi` only reads `ExternalDocs` while processing groups and endpoints (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:327-340, 477-492`). `OpenAPISpec` also omits a top-level `externalDocs` field from its generated subset (`OpenApi.ts:888-904`). The generated `apps/api/openapi.json` contains no `externalDocs`.

If top-level external docs are required, use the generic API override:

```ts
OpenApi.annotations({
  title: "Overseer API",
  version: "0.0.0",
  description: "...",
  servers: [/* ... */],
  override: {
    externalDocs: {
      url: "https://github.com/dmmulroy/overseer/blob/main/docs/errors.md",
      description: "Overseer error response design and request-correlation guidance",
    },
  },
});
```

API overrides are applied near the end of generation after schema patches (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:641-655`). This is declarative raw OpenAPI metadata, though not represented in Effect's narrowed `OpenAPISpec` interface.

Alternatively, place `externalDocs` on the group or individual endpoints if that is the intended semantic location; those locations are first-class and typed.

## Why `Record<string, unknown>` / `Record<string, any>` appears

The premise needs a correction for beta.102:

- `OpenApi.fromApi(api)` returns `OpenApi.OpenAPISpec`, not `Record<string, unknown>` (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:260-268, 888-904`).
- `OpenApi.Override` stores `Record<string, unknown>` because it accepts arbitrary standard OpenAPI fields and extensions outside Effect's generated subset (`OpenApi.ts:99-105`).
- `OpenApi.Transform` is actually typed `(openApiSpec: Record<string, any>) => Record<string, any>` in this pin (`OpenApi.ts:126-146`), and `OpenApi.annotations({ transform })` repeats that type (`OpenApi.ts:159-193`). The local function explicitly narrows its own parameter to `Record<string, unknown>` (`apps/api/src/overseer-http-api.ts:184-189`); `fromApi` did not impose that type.

The broad transform type is relevant because a single `OpenApi.Transform` annotation key is reused at three structurally different attachment sites:

- API annotation: complete `OpenAPISpec`;
- group annotation: `OpenAPISpecTag`;
- endpoint annotation: `OpenAPISpecOperation`.

The implementation retrieves the same transform annotation and casts its result according to the attachment site (`node_modules/effect/src/unstable/httpapi/OpenApi.ts:349-352, 593-596, 652-655`). It also allows users to add OpenAPI fields and vendor extensions that Effect's intentionally narrow model does not claim to model; the source explicitly says `OpenAPISpec` describes only `fromApi` output, not the entire OpenAPI specification (`OpenApi.ts:881-887`).

Thus the broad record type is an escape-hatch design tradeoff, not evidence that the generated document is unknowable. At a known attachment site, a transform can safely use the corresponding exported Effect model at its boundary.

## What should be deleted or refactored

### Delete

From `apps/api/src/overseer-http-api.ts` after replacements are in place:

- `isOpenApiRecord`;
- `workspaceApiRequestExamplesByOperation`;
- the global status/summary-based request and response media-example injection;
- the component security-scheme rewrite;
- the API-level `transform: addOverseerOpenApiResponseHeaders`;
- `addOverseerOpenApiResponseHeaders` itself.

If schema examples are accepted instead of exact media-object examples, also delete all media-type `example` / `examples` post-processing. This removes duplicate examples already visible in the generated output.

### Refactor declaratively

- Move Access's description onto the `HttpApiSecurity.apiKey` with `HttpApiSecurity.annotateMerge`.
- Put success examples on endpoint-specific encoded response schemas.
- Put error examples on encoded error response schemas; make them endpoint-specific where `details.operation` differs.
- Keep request examples on the existing encoded payload schemas.
- Move top-level `externalDocs` into API `override`, or relocate it to a group/endpoint where `ExternalDocs` is first-class.

### Retain only as a narrow escape hatch

- Response-header documentation, implemented as an endpoint-operation transform over `operation.responses`.
- Media Type Object examples only if a consumer specifically requires that exact placement; otherwise do not retain them.

## Final verdict

Pinned Effect beta.102 can declaratively express **all of the semantic metadata except response-header documentation**. It can express examples declaratively at the JSON Schema level, but it cannot reproduce the transform's exact Media Type Object example fields through first-class APIs. Security descriptions are directly supported and should move out of the transform. Top-level external docs need a raw `override` because the apparent API annotation is not consumed.

Therefore: **delete the whole-document unknown-record traversal**. Replace examples and security metadata with Schema/HttpApiSecurity annotations, fix `externalDocs`, and keep at most one small, attachment-site-aware operation transform for the unsupported response header.
