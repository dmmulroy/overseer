# Domain Model

## Core Domain Models

```ts
import type * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

type Actor =
  | {
      kind: "human";
      subject: CloudflareAccessSubject;
      email: EmailAddress;
    }
  | {
      kind: "agent";
      agentId: AgentId;
    };

type WorkspaceState = "active" | "archived";

type Workspace = {
  id: WorkspaceId;
  name: WorkspaceName;
  state: WorkspaceState;
  createdAt: DateTime.Utc;
  updatedAt: DateTime.Utc;
};

type ProjectState = "active" | "archived";

type Project = {
  id: ProjectId;
  workspaceId: WorkspaceId;
  name: ProjectName;
  state: ProjectState;
  createdAt: DateTime.Utc;
  updatedAt: DateTime.Utc;
};

type IssueState = "open" | "blocked" | "closed";

type Issue = {
  id: IssueId;
  projectId: ProjectId;
  number: number;
  title: string;
  body: Option.Option<string>;
  state: IssueState;
  blockedBy: Option.Option<IssueId>;
  createdAt: DateTime.Utc;
  updatedAt: DateTime.Utc;
};
```

## Ancillary Domain Models

```ts
import * as Schema from "effect/Schema";

/**
 * Canonical 26-character Universally Unique Lexicographically Sortable Identifier.
 *
 * @example Valid: `01ARZ3NDEKTSV4RRFFQ69G5FAV`
 * @example Invalid: `01ARZ3NDEKTSV4RRFFQ69G5FAI` (`I` is not in the ULID alphabet)
 */
const Ulid = Schema.String.check(Schema.isPattern(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)).pipe(
  Schema.brand("Ulid"),
);

/** A validated canonical ULID. */
type Ulid = typeof Ulid.Type;

/**
 * Stable Agent credential identity containing 1–256 visible ASCII characters.
 *
 * @example Valid: `agent-codex-01`
 * @example Invalid: `agent codex 01` (spaces are not visible ASCII in the accepted range)
 */
const AgentId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(/^[!-~]+$/),
).pipe(Schema.brand("AgentId"));

/** A validated Agent credential identity. */
type AgentId = typeof AgentId.Type;

/**
 * Stable human subject from a validated Cloudflare Access JWT `sub` claim.
 *
 * @example Valid: `8ca4f860-9f4f-4f3b-bf62-4524a30f5c11`
 * @example Invalid: `` (the subject cannot be empty)
 */
const CloudflareAccessSubject = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
).pipe(Schema.brand("CloudflareAccessSubject"));

/** A validated Cloudflare Access human subject. */
type CloudflareAccessSubject = typeof CloudflareAccessSubject.Type;

/**
 * Email address containing one `@`, no whitespace, and at most 320 characters.
 *
 * @example Valid: `alice@example.com`
 * @example Invalid: `alice.example.com` (missing `@`)
 */
const EmailAddress = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(320),
  Schema.isPattern(/^[^\s@]+@[^\s@]+$/),
).pipe(Schema.brand("EmailAddress"));

/** A validated email address. */
type EmailAddress = typeof EmailAddress.Type;

/**
 * Nonblank, single-line Workspace display name containing at most 200 characters.
 *
 * @example Valid: `Platform Engineering`
 * @example Invalid: `   ` (contains no non-whitespace characters)
 */
const WorkspaceName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
  Schema.isPattern(/\S/u),
  Schema.isPattern(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u),
).pipe(Schema.brand("WorkspaceName"));

/** A validated Workspace display name. */
type WorkspaceName = typeof WorkspaceName.Type;

/**
 * Nonblank, single-line Project display name containing at most 200 characters.
 *
 * @example Valid: `Overseer API`
 * @example Invalid: `First line\nSecond line` (line breaks are not allowed)
 */
const ProjectName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
  Schema.isPattern(/\S/u),
  Schema.isPattern(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u),
).pipe(Schema.brand("ProjectName"));

/** A validated Project display name. */
type ProjectName = typeof ProjectName.Type;

/**
 * Workspace identity composed of the `workspace_` prefix and a canonical ULID.
 *
 * @example Valid: `workspace_01ARZ3NDEKTSV4RRFFQ69G5FAV`
 * @example Invalid: `project_01ARZ3NDEKTSV4RRFFQ69G5FAV` (wrong prefix)
 */
const WorkspaceId = Schema.TemplateLiteral(["workspace_", Ulid]).pipe(Schema.brand("WorkspaceId"));

/** A validated Workspace identity. */
type WorkspaceId = typeof WorkspaceId.Type;

/**
 * Project identity composed of the `project_` prefix and a canonical ULID.
 *
 * @example Valid: `project_01ARZ3NDEKTSV4RRFFQ69G5FAV`
 * @example Invalid: `project_1234` (suffix is not a canonical ULID)
 */
const ProjectId = Schema.TemplateLiteral(["project_", Ulid]).pipe(Schema.brand("ProjectId"));

/** A validated Project identity. */
type ProjectId = typeof ProjectId.Type;

/**
 * Issue identity composed of the `issue_` prefix and a canonical ULID.
 *
 * @example Valid: `issue_01ARZ3NDEKTSV4RRFFQ69G5FAV`
 * @example Invalid: `issue-01ARZ3NDEKTSV4RRFFQ69G5FAV` (wrong separator)
 */
const IssueId = Schema.TemplateLiteral(["issue_", Ulid]).pipe(Schema.brand("IssueId"));

/** A validated Issue identity. */
type IssueId = typeof IssueId.Type;
```

# Overseer SDK

**Decision:** The root API Worker depends only on the application-owned `OverseerSdk` for Overseer operations. HTTP handlers must not call `WorkspaceClient`, `BookkeeperClient`, Durable Object namespaces, or persistence services directly.

The SDK groups the existing application client capabilities instead of inventing parallel operation interfaces or duplicating their method and error types:

```ts
interface IOverseerSdk {
  readonly workspace: IWorkspaceClient;
  // Future additions use the same singular resource naming:
  // readonly project: IProjectClient;
  // readonly issue: IIssueClient;
}

class OverseerSdk extends Context.Service<OverseerSdk, IOverseerSdk>()("@overseer/OverseerSdk") {}
```

The resource-oriented call site is:

```ts
const overseer = yield * OverseerSdk;

const workspace = yield * overseer.workspace.createWorkspace({ name });
const current = yield * overseer.workspace.getWorkspace(workspaceId);
const renamed = yield * overseer.workspace.renameWorkspace({ id: workspaceId, name });
```

The SDK begins as one app-local capability because the API Worker is its only consumer:

```text
apps/api/src/overseer-sdk/
└── overseer-sdk.ts
```

`makeOverseerSdk` yields each lower application client once and exposes that client's existing service interface under its singular resource property. `overseerSdkLayerWithoutDependencies` preserves those client requirements, and the root Worker selects their production Layers. Future cross-client orchestration belongs behind an existing client capability or a deliberately added SDK capability; do not create `WorkspaceOperations`, `ProjectOperations`, or `IssueOperations` aliases that merely repeat client interfaces.

# File Structure

## Monorepo Boundaries

**Decision:** Apps are independent runnable or deployable composition roots and never import from one another. An app may depend on external libraries and workspaces under `packages/*`; packages never import from `apps/*`. Cross-app calls use real runtime interfaces, while shared code moves behind an intentional package public entrypoint.

Keep a capability in its owning app while it has one consumer. When another app needs it, extract the complete cohesive capability—not a forwarding file or grab-bag helper—into `packages/*` and make both apps depend on that package. Over time this allows apps to become thin command/deployment entrypoints while reusable domain modules, application services, clients, infrastructure lifecycle services, and test utilities live in packages. This is an incremental extraction rule, not a request to move the current API modules before they have another consumer.

Reserve the eventual `overseer` executable name for the official user-facing CLI that operates the Overseer API. A separate operator application may live at `apps/ops` and expose an unambiguous internal executable such as `overseer-ops` for Stack lifecycle, Access service-token administration, smoke tests, and debugging. `apps/ops` does not import `apps/api`; reusable Alchemy deployment capabilities, authenticated API clients, stage naming, and test orchestration move to packages when both apps or tests need them.

## Domain Modules

**Decision:** Keep domain vocabulary under `apps/api/src/domain/`, organized by domain concept rather than by technical role.

Begin with one singular, concept-named module for each core concept:

```text
apps/api/src/domain/
├── actor.ts
├── workspace.ts
├── project.ts
├── issue.ts
└── ulid.ts
```

Each concept module owns its runtime schemas, inferred types, parsers or smart constructors, invariants, and closely related domain behavior. For example, `workspace.ts` owns `WorkspaceId`, `WorkspaceName`, `WorkspaceState`, and `Workspace`. Shared ULID mechanics have one definition site in `ulid.ts`, while each branded domain ID remains beside the concept it identifies.

Do not split domain code into generic technical buckets such as `types.ts`, `schemas.ts`, `ids.ts`, or `validators.ts`; that would scatter one concept across several search results. Do not name the directory `domain-types`, because these modules own domain behavior and constraints rather than only TypeScript declarations. Import concept modules directly until a barrel provides a concrete interface benefit.

Boundary representations remain outside the domain modules. In particular, `CloudflareAccessPrincipal` belongs to the Cloudflare Access adapter, while the resulting `Actor` belongs to `domain/actor.ts`. The principal composes the domain-owned `AgentId`, `CloudflareAccessSubject`, and `EmailAddress` schemas so JWT claims cross the boundary as branded domain values without duplicating their constraints. If one concept grows enough to answer several distinct questions, deepen it into a concept directory with descriptive files and colocated tests, rather than introducing that nesting in advance.

# Architecture

## Service Constructor Naming

**Decision:** Do not export generic service constructor names such as `make`. Include the capability in each constructor name so plain-text search finds the correct definition directly:

```ts
const makeBookkeeperDatabase = Effect.gen(function* () {
  // ...
});

const makeWorkspaceDatabase = Effect.gen(function* () {
  // ...
});
```

Apply this convention to every service constructor. Service tags and Layers retain their capability names as well; avoid imports that depend on the file path to disambiguate generic exported identifiers.

## Shared Pagination

**Decision:** Use one generic pagination module for HTTP APIs, clients, and database services rather than defining service-specific page containers.

The module lives at `apps/api/src/pagination.ts` and owns the opaque cursor, bounded page size, request schema, and generic page schema:

```ts
const PaginationCursor = Schema.String.pipe(Schema.brand("PaginationCursor"));
const PaginationLimit = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
).pipe(Schema.brand("PaginationLimit"));

const PaginationRequest = Schema.Struct({
  cursor: Schema.OptionFromNullOr(PaginationCursor),
  limit: PaginationLimit,
});

const PaginationPage = <Item extends Schema.Top>(item: Item) =>
  Schema.Struct({
    items: Schema.Array(item),
    nextCursor: Schema.OptionFromNullOr(PaginationCursor),
  });
```

Cursors are opaque to callers. Each database implementation owns their encoding, decoding, ordering, and invalid-cursor failure. Collection endpoints use this shared representation even when their query filters differ.

## Workspace Service

The Workspace service owns Workspace state. Each Workspace is hosted by one Durable Object instance keyed by its `WorkspaceId`. The application talks to those instances through an application-owned client rather than through Cloudflare namespaces or stubs directly.

### Workspace HTTP API

The server exposes a versioned HTTP API scoped to the Workspace instance selected by the client. The Workspace ID is included when the instance is created; subsequent operations act on that same instance and do not repeat its ID in the route.

```text
POST /v1/workspace
GET  /v1/workspace
POST /v1/workspace/rename
POST /v1/workspace/archive
POST /v1/workspace/unarchive
```

```ts
const createWorkspace = HttpApiEndpoint.post("createWorkspace", "/workspace", {
  payload: Schema.Struct({
    id: WorkspaceId,
    name: WorkspaceName,
  }),
  success: Workspace,
  error: CreateWorkspaceError,
});

const getWorkspace = HttpApiEndpoint.get("getWorkspace", "/workspace", {
  success: Workspace,
  error: GetWorkspaceError,
});

const renameWorkspace = HttpApiEndpoint.post("renameWorkspace", "/workspace/rename", {
  payload: Schema.Struct({
    name: WorkspaceName,
  }),
  success: Workspace,
  error: RenameWorkspaceError,
});

const archiveWorkspace = HttpApiEndpoint.post("archiveWorkspace", "/workspace/archive", {
  success: Workspace,
  error: ArchiveWorkspaceError,
});

const unarchiveWorkspace = HttpApiEndpoint.post("unarchiveWorkspace", "/workspace/unarchive", {
  success: Workspace,
  error: UnarchiveWorkspaceError,
});

class WorkspaceHttpApiGroup extends HttpApiGroup.make("workspace")
  .add(createWorkspace)
  .add(getWorkspace)
  .add(renameWorkspace)
  .add(archiveWorkspace)
  .add(unarchiveWorkspace) {}

class WorkspaceHttpApi extends HttpApi.make("WorkspaceHttpApi")
  .add(WorkspaceHttpApiGroup)
  .prefix("/v1") {}
```

`POST /v1/workspace` initializes the selected Durable Object and must be idempotent for the same `WorkspaceId`. It rejects an attempt to initialize that instance with a different ID. Rename, archive, and unarchive are explicit state transitions. Rename replaces the Workspace name and preserves its identity. Archive and unarchive do not delete the Durable Object or its stored Workspace.

### Workspace Server and Client

```ts
class WorkspaceServer extends Cloudflare.DurableObject<WorkspaceServer>()(
  "WorkspaceServer",
  workspaceServerImplementation,
) {}

interface IWorkspaceClient {
  readonly getWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Option.Option<Workspace>, GetWorkspaceError>;
  readonly createWorkspace: (input: {
    readonly name: WorkspaceName;
  }) => Effect.Effect<Workspace, CreateWorkspaceError>;
  readonly renameWorkspace: (input: {
    readonly id: WorkspaceId;
    readonly name: WorkspaceName;
  }) => Effect.Effect<Workspace, RenameWorkspaceError>;
  readonly archiveWorkspace: (id: WorkspaceId) => Effect.Effect<Workspace, ArchiveWorkspaceError>;
  readonly unarchiveWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Workspace, UnarchiveWorkspaceError>;
}

class WorkspaceClient extends Context.Service<WorkspaceClient, IWorkspaceClient>()(
  "@overseer/WorkspaceClient",
) {}
```

`WorkspaceServer` is the Alchemy Durable Object class. Its public shape is inferred from the object returned by the inner `Effect`; it does not need a separate server interface or named implementation value. `IWorkspaceClient` is the application-facing capability, and `WorkspaceClient` is its Effect service tag. The client implementation owns Durable Object namespace lookup, stub creation, `Cloudflare.toHttpClient`, and HTTP request and response translation.

The client resolves the `WorkspaceServer` namespace during Alchemy Init without resolving a stub. It uses `makeExecutionMemo` to create one Effect `Cache` per API Worker invocation, keys that cache by `WorkspaceId`, and suspends `namespace.getByName(id)` until the first lookup for that ID. Calls for the same Workspace ID in one API request share the stub-backed `HttpApiClient`; another request receives a fresh cache and client because its Cloudflare I/O context is different.

This lifecycle machinery is entirely private to `makeWorkspaceClient`. Callers yield `WorkspaceClient` or use `OverseerSdk.workspace` and invoke domain operations with canonical Workspace IDs. They never select, retain, or manage Durable Object stubs, generated HTTP clients, caches, or instance facades. `IWorkspaceClient` remains the complete public surface, including collection-level `createWorkspace` and ID-addressed instance operations; there is no public or static `for` method.

Listing Workspaces remains a Bookkeeper operation because no individual Workspace Durable Object owns the collection.

### Workspace Database

Handlers and inner Workspace services depend on a domain-shaped `WorkspaceDatabase`, not on raw Cloudflare storage or Effect's generic SQL client:

```ts
interface IWorkspaceDatabase {
  readonly createWorkspace: (input: {
    readonly id: WorkspaceId;
    readonly name: WorkspaceName;
  }) => Effect.Effect<Workspace, CreateWorkspaceError>;
  readonly getWorkspace: Effect.Effect<Option.Option<Workspace>, GetWorkspaceError>;
  readonly renameWorkspace: (name: WorkspaceName) => Effect.Effect<Workspace, RenameWorkspaceError>;
  readonly archiveWorkspace: Effect.Effect<Workspace, ArchiveWorkspaceError>;
  readonly unarchiveWorkspace: Effect.Effect<Workspace, UnarchiveWorkspaceError>;
}

class WorkspaceDatabase extends Context.Service<WorkspaceDatabase, IWorkspaceDatabase>()(
  "@overseer/WorkspaceDatabase",
) {}
```

`WorkspaceDatabase` owns SQL, table structure, persistence records, stored-row parsing, and Workspace schema migrations. Stored rows are parsed through the domain Workspace schemas before leaving the database service. `makeWorkspaceDatabase` runs the bundled `SqliteMigrator` loader before obtaining and closing over the generic `SqlClient` and returning the service implementation. The `WorkspaceDatabase` Layer cannot finish acquisition until all pending migrations finish.

The Durable Object composition root adapts the current instance's native storage with `@effect/sql-sqlite-do`. Infrastructure-backed application Layers are provided to Alchemy's outer init Effect, and their service tags are yielded there rather than bypassing the Layer by yielding an exported `make` Effect directly. Stable outer services are closed over and bridged into inner runtime Layers with `Layer.succeed` when required.

Layer descriptions may be created beside the yielded state reference, but state-backed services and migrations are acquired only in the returned runtime Effect because Alchemy evaluates the outer Effect during planning with mock storage:

```ts
Effect.gen(function* () {
  const state = yield* Cloudflare.DurableObjectState;
  const bookkeeperClient = yield* BookkeeperClient;

  const workspaceDatabaseLayer = WorkspaceDatabase.layerWithoutDependencies.pipe(
    Layer.provide(SqliteClient.layer({ storage: state.raw.storage })),
  );
  const workspaceHandlersLayer = workspaceHttpHandlersLayer.pipe(
    Layer.provide(workspaceDatabaseLayer),
    Layer.provide(Layer.succeed(BookkeeperClient, bookkeeperClient)),
  );

  return Effect.gen(function* () {
    // Acquire SQL, complete pending migrations, then construct the HTTP handler.
    const httpLayer = HttpApiBuilder.layer(WorkspaceHttpApi).pipe(
      Layer.provide(workspaceHandlersLayer),
    );

    return { fetch: yield* HttpRouter.toHttpEffect(httpLayer) };
  });
}).pipe(Effect.provide(bookkeeperClientLayerWithoutDependencies));
```

Passing the complete `state.raw.storage` enables Effect SQL transaction support. One database service and SQL client are acquired for the Durable Object instance and shared by its handlers; they are not reconstructed for every request.

## Overseer API

### Public REST API

The root API Worker exposes this initial versioned Workspace API:

```text
GET  /
POST /v1/workspaces
GET  /v1/workspaces/:workspaceId
POST /v1/workspaces/:workspaceId/rename
POST /v1/workspaces/:workspaceId/archive
POST /v1/workspaces/:workspaceId/unarchive
```

`POST /v1/workspaces` accepts `{ name }`; `OverseerSdk` generates the `WorkspaceId`. All other Workspace routes parse the ID from the path. Successful creation returns `201`; successful reads and state changes return `200` with the complete Workspace representation.

Declare `AccessAuthenticationMiddleware` once on the top-level `OverseerHttpApi`, after adding its groups. Effect propagates API-level middleware to every group and endpoint. Individual endpoints do not repeat the middleware declaration. The middleware implementation is still materialized once per Worker isolate so its Cloudflare Access JWKS cache is reused, while assertion verification and `CurrentActor` remain request-scoped.

Keep the complete root HTTP contract in `apps/api/src/overseer-http-api.ts` and aggregate all of its handler groups in `apps/api/src/overseer-http-handlers.ts`. Do not create resource-specific top-level files such as `overseer-workspace-http-api.ts` or `overseer-workspace-http-handlers.ts`; deepen the structure only if the aggregate files become too large to answer their one root-API question clearly. `apps/api/src/api-worker.ts` remains the composition root that materializes dependencies and builds the router.

Workspace handlers yield `OverseerSdk` and invoke only `overseer.workspace.*`. They do not directly yield lower-level Durable Object clients. Listing Workspaces is deferred until the root collection contract uses the shared pagination model and the SDK exposes it through an intentional client capability.

`apps/api/src/api-worker.ts` separates the `ApiWorker` Alchemy tag from its default-exported `.make()` Layer. The Worker declares `BookkeeperServer | WorkspaceServer` as its hosted Durable Object contract, while each Durable Object module likewise exports its lightweight server tag by name and its production implementation Layer by default. Modules with substitutable dependencies expose both `layerWithoutDependencies` and a production `layer` assembled with the dependency's production Layer; tests and alternate compositions can select the former, while ordinary callers consume the latter. This dependency-first `Layer.provide` chain registers Bookkeeper before Workspace in both Alchemy initialization phases without an imperative ordering yield. The Worker's effectful props still select the optional Access deployment and preserve generated Outputs directly in environment bindings. The Alchemy Stack provides the default Worker Layer, yields `ApiWorker` for outputs, and yields the same stable Access deployment Effect for output projection.

The checked-in OpenAPI 3.1 artifact lives at `apps/api/openapi.json` and is generated directly from `OverseerHttpApi` with Effect's `OpenApi.fromApi`. Run `vp run generate:openapi` after changing the root HTTP contract, schemas, middleware errors, or OpenAPI annotations. The Vite Plus task formats the generated artifact and caches its declared output; handwritten edits to `openapi.json` are overwritten.

### Request Identity Middleware

**Decision:** Create one request identity at the HTTP boundary and provide it to the complete request Effect. Handlers and error translators yield the request-scoped service; they never generate a new identifier when an error occurs.

```ts
const OverseerRequestId = Schema.TemplateLiteral(["request_", Ulid]).pipe(
  Schema.brand("OverseerRequestId"),
);

type OverseerRequestId = typeof OverseerRequestId.Type;

class CurrentRequestId extends Context.Service<CurrentRequestId, OverseerRequestId>()(
  "@overseer/CurrentRequestId",
) {}

class RequestIdMiddleware extends HttpApiMiddleware.Service<
  RequestIdMiddleware,
  { provides: CurrentRequestId }
>()("@overseer/RequestIdMiddleware") {}
```

`RequestIdMiddleware` generates exactly one `OverseerRequestId` for each matched Overseer endpoint request before authentication and endpoint execution, provides it as `CurrentRequestId`, and annotates the request span and structured logs with `requestId`. It registers an Effect HTTP pre-response handler that sets `X-Overseer-Request-Id` on successful and failed endpoint responses after the final response has been encoded. Error translation yields `CurrentRequestId` and copies the same value into the error response body. This correlates authentication, parsing, SDK calls, Durable Object calls, and response translation under one identity. The middleware must also make the request ID available to failures produced before an endpoint handler runs; middleware ordering is verified against the pinned Effect implementation rather than assumed.

The HTTP API middleware does not run for traffic that matches no declared endpoint. If Overseer later requires `X-Overseer-Request-Id` on router-level not-found or method responses, add one outer `HttpMiddleware` around the complete router rather than duplicating ID generation.

Declare `RequestIdMiddleware` once on the top-level `OverseerHttpApi`, alongside `AccessAuthenticationMiddleware`. Request identity must wrap authentication so authentication failures can use the same correlation value. The production composition root materializes stable middleware implementations once per Worker isolate, but identifier generation and context provision occur once per request.

Use two environment-specific Layers behind the same middleware service:

```text
apps/api/src/request-id.ts
apps/api/src/request-id-middleware.ts
```

- `requestIdMiddlewareLayer` is the local and generic implementation. It generates an `OverseerRequestId` from the Effect clock and randomness.
- `cloudflareRequestIdMiddlewareLayer` is the Cloudflare implementation. It reads and parses the inbound `cf-ray` header, generates the same unique Overseer request ID, and records the Ray ID as separate structured context such as `cloudflareRayId`. All Cloudflare-specific schemas, parsing, header names, and annotations remain private to `request-id-middleware.ts`; `request-id.ts` owns only provider-neutral Overseer request identity.
- `requestIdMiddlewareLayerForEnvironment` is the ready application Layer imported by composition roots. It uses `OverseerEnvironmentConfig` to select the generic Layer for development and the Cloudflare Layer for production, keeping that selection out of callers.

Do not use the raw Cloudflare Ray ID as the unique Overseer request ID. [Cloudflare documents that Ray IDs are not guaranteed to be unique for every request](https://developers.cloudflare.com/fundamentals/reference/cloudflare-ray-id/). Preserve the full validated Ray ID separately so operators can search Cloudflare Security Events and logs, while `OverseerRequestId` remains the application correlation identity returned to callers. Missing or malformed `cf-ray` is not a request failure: omit the Cloudflare field, retain the generated Overseer request ID, and annotate the malformed-header classification without recording the raw value.

The Cloudflare Ray ID is observability context only. It is never authentication or authorization evidence, and public error bodies continue to expose only `requestId` unless a future support workflow has a concrete reason to expose `cloudflareRayId`.

### Public Error Contracts

**Decision:** Errors are part of the public API and observability design, not generic fallback copy. Follow the canonical principles in [`docs/errors.md`](docs/errors.md), informed by [“When life gives you lemons, write better error messages”](https://wix-ux.com/when-life-gives-you-lemons-write-better-error-messages-46c5223e1a2f): explain what did not happen and why, include truthful reassurance about unaffected state when known, tell the caller what it can do next, avoid blame and implementation jargon, and provide a request identifier when support is the only next step.

Every application-generated error response belongs to a `PublicApiError` discriminated union. Each variant has a literal `code`, an operation-specific `message`, a `requestId`, a `retryable` value, and a variant-specific `details` schema. Do not use an untyped details record that allows the code and contextual fields to disagree. For example:

```ts
const WorkspaceNotFoundApiError = Schema.Struct({
  code: Schema.Literal("workspace_not_found"),
  message: Schema.String,
  requestId: Schema.String,
  retryable: Schema.Literal(false),
  details: Schema.Struct({
    workspaceId: WorkspaceId,
    operation: Schema.Literals(["get", "rename", "archive", "unarchive"]),
  }),
});
```

`code` is a stable machine-readable discriminator. `message` is a complete operation-specific explanation suitable for a human or Agent. `details` carries only the safe structured context defined for that error, such as `workspaceId`, `operation`, field violations, and legal values. It never contains credentials, JWT claims, raw request bodies, SQL, stack traces, or private causes. `requestId` comes from `CurrentRequestId` and correlates the response with the complete request trace and logs; error constructors never generate it themselves. `retryable` states whether retrying the same logical operation without changing its input may succeed; it must account for idempotency and uncertain cross-Durable-Object outcomes rather than making a blanket promise.

Initial status contracts are:

| Status | Code                            | Contract                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `invalid_request`               | The path, query, headers, or payload could not be parsed. `details` identifies each invalid field and its constraint so the caller can correct it.                                                                                                                                       |
| `401`  | `unauthorized`                  | The Worker could not authenticate the request. The message directs the caller to provide valid Access credentials. Cloudflare Access may reject a request at the edge before this Worker contract is reached.                                                                            |
| `404`  | `workspace_not_found`           | A syntactically valid Workspace ID is unknown. The response includes the requested `workspaceId` and tells the caller to check it.                                                                                                                                                       |
| `405`  | `method_not_allowed`            | The route exists but does not support the HTTP method. The response identifies the allowed methods.                                                                                                                                                                                      |
| `409`  | `workspace_state_conflict`      | Reserved for a rejected Workspace lifecycle transition if the domain chooses non-idempotent transitions or forbids rename while archived. It is not emitted while those operations remain permitted or idempotent.                                                                       |
| `415`  | `unsupported_media_type`        | A body-bearing operation did not receive a supported JSON media type.                                                                                                                                                                                                                    |
| `500`  | `workspace_operation_failed`    | Overseer could not complete the named Workspace operation because of an internal invariant or invalid stored data. The response does not expose internals and directs the caller to contact support with `requestId`; retry is false unless the specific cause is known to be transient. |
| `503`  | `workspace_service_unavailable` | A required Overseer service is temporarily unavailable. The response identifies the operation, describes only state effects that are known with certainty, and indicates whether the same logical operation is safe to retry.                                                            |

Messages must name the failed operation and relevant safe identity. For example: `Workspace workspace_… was not found. Check the Workspace ID and try again.` Avoid `Something went wrong`, raw reason literals, and claims such as “no changes were made” unless the operation protocol proves that statement.

Internal typed errors follow the same information standard at greater fidelity. They carry the operation, safe domain identifiers, classified reason, and an attached cause where appropriate. Traces and logs record those structured fields and the response `requestId`; public adapters deliberately redact private causes while preserving a precise public classification. Each boundary translates known tagged errors explicitly so a newly introduced failure cannot silently collapse into a generic response.

### Durable Object HTTP Boundary

**Decision:** Treat each Durable Object as an independent HTTP service with an Effect HTTP API exposed through `fetch`.

- Do not use typed Alchemy RPC.
- Keep Durable Object bindings, namespaces, stubs, and `Cloudflare.toHttpClient` inside composition roots and client implementations.
- Expose only application-owned Effect client services such as `WorkspaceClient`, `ProjectClient`, and `IssueClient` to the rest of the application.
- Use the HTTP boundary to preserve the distinction between a Durable Object service and the Worker or other Durable Objects, even when Cloudflare executes the call within the same broader runtime environment.
- Treat this as a logical service boundary, not necessarily a physical network boundary.

### Cloudflare Access Authentication

**Decision:** Use Cloudflare Access as the production admission layer for both human and Agent requests.

Alchemy provisions the Access application, human policy, Agent service token, and Agent service-token policy. The application is a self-hosted Access application for the production hostname. Agents authenticate at the Access edge with `CF-Access-Client-Id` and `CF-Access-Client-Secret`; the raw service-token secret never enters the Worker.

Cloudflare Access injects the resulting signed `Cf-Access-Jwt-Assertion` header. The Worker verifies that assertion itself through an application-owned `CloudflareAccessVerifier` Effect service and a custom `HttpApiMiddleware` declared once on the top-level API. The middleware declaration applies to every group and endpoint, declares the header as an API-key security scheme, returns typed `401` failures, and provides the authenticated request context.

The verifier must validate:

- the JWT signature through the Access JWKS endpoint at `/cdn-cgi/access/certs`;
- the `RS256` algorithm;
- the configured issuer and Access application audience;
- the `exp` and `iat` claims; and
- the `JWT` type.

The initial implementation lives in `apps/api/src/cloudflare-access-verifier.ts`. `CloudflareAccessVerifier` is an application-owned Effect service around `jose`; it hides `createRemoteJWKSet`, `jwtVerify`, JWT payloads, key caching, and `jose` errors. Its `verifyAccessAssertion` operation accepts a `Redacted<string>` assertion and returns a parsed `CloudflareAccessPrincipal` or a classified `CloudflareAccessVerificationFailed` error. The production Layer reads and parses `ACCESS_AUDIENCE` and `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, constructs one remote JWKS client per Layer, and reuses that client's key cache across requests in the Worker isolate.

The verifier accepts only mutually exclusive Cloudflare application-token identities: a human has a nonempty bounded `sub`, a validated `email`, and no `common_name`; an Agent has an empty `sub`, a bounded visible-ASCII `common_name`, and no `email`. It classifies missing assertions, invalid assertions, invalid identities, and unavailable verification separately. It never returns raw JWT claims, never retains claim details in typed failures, and never unwraps the redacted assertion outside the verifier operation.

This module implements assertion verification only. `AccessAuthenticationMiddleware` maps `CloudflareAccessPrincipal` into the domain `Actor`, provides `CurrentActor`, and translates verification failure into its typed `401` API response. The environment-selected verifier Layer uses the production verifier only in deployed Access mode and returns a fixed local-human principal in local-development mode; the production verifier itself contains no permissive local branch.

`Cloudflare.Access` infrastructure resources belong in the Alchemy composition root. `OverseerApiAccessDeployment` represents the selected Access deployment as an `Option`: `None` means local development, while `Some` carries the deployed application, Agent token, and team domain. The `ApiWorker` props Effect derives Worker bindings from that value, and the Stack yields the same stable resource Effect to project client-facing outputs. Alchemy's separate `Access` runtime helper for obtaining outbound Access headers is a control-plane/CLI capability, not the Worker-side inbound JWT verifier.

### Access Request Context

**Decision:** The Access HTTP middleware exposes only the authenticated request `Actor` to API handlers.

The middleware keeps `CloudflareAccessPrincipal` internal, verifies the Cloudflare Access assertion, derives the immutable actor, and provides that actor as request context:

```ts
class CurrentActor extends Context.Service<CurrentActor, Actor>()("@overseer/CurrentActor") {}

const actor =
  yield * verifier.verify(assertion).pipe(Effect.map(actorFromCloudflareAccessPrincipal));

return yield * Effect.provideService(effect, CurrentActor, actor);
```

Human identity is derived from the verified Access `sub` and `email` claims. Agent identity is derived from the verified Access `common_name` claim for a service-token application assertion with no meaningful `sub`. The caller never supplies an Actor directly.

Handlers yield `CurrentActor` directly. They do not perform the repeated `CloudflareAccessPrincipal`-to-`Actor` conversion, and application code does not depend on the authentication-specific principal representation.

### Access Environments

Production uses the real Access verifier and Access policies. During `alchemy dev`, `ApiWorker` selects `Option.none()` before yielding any Access resource, binds `OVERSEER_ENVIRONMENT=development`, omits the audience and issuer bindings, and lets the environment-selected authentication Layer provide the fixed local-human principal. A cloud deployment selects `Option.some(...)`, provisions the Access application, policies, and Agent token, and binds `OVERSEER_ENVIRONMENT=production`, the generated application audience, and the team domain. This local substitution does not claim that workerd reproduces Access admission, nor does it create a synthetic infrastructure `Output` for the application audience.

`ApiWorker` uses one tagged `Cloudflare.Worker` class and one default-exported `.make()` Layer for both cases. `Option.match` adds Access-only Worker environment entries when the Access deployment exists, and the Stack projects authenticated-client outputs from that same selected deployment. Alchemy beta.72 also evaluates the props Effect while loading the bundled runtime, where deployment services such as `AlchemyContext` are intentionally absent; the props Effect therefore returns only runtime-safe common props when `__ALCHEMY_RUNTIME__` is set. Cloudflare supplies the already-planned environment bindings to workerd or the deployed Worker, while the provided Worker Layer builds the handlers and hosted Durable Object Layers under Worker host context. Do not duplicate the Worker declaration across local and cloud branches or provision Access merely to obtain a uniform local env shape.

Production serves the future web application at `overseer.mulroy.ai` and the API at `api.overseer.mulroy.ai`. The API Worker custom domain and Cloudflare Access application always use the same hostname. Production disables the Worker's `workers.dev` URL.

Remote non-production stages derive an isolated, single-label API hostname from the Alchemy stage. For example, stage `pr-42` uses `overseer-api-pr-42.mulroy.ai`, while Alchemy's default developer stage `dev_dmmulroy` uses the DNS-safe hostname `overseer-api-dev-dmmulroy.mulroy.ai`. Keeping ephemeral hostnames directly beneath `mulroy.ai` lets them use the zone's existing `*.mulroy.ai` Universal SSL certificate instead of provisioning and later deleting one advanced certificate for every stage. Each deployed-stack test still receives its own Worker custom domain, DNS record, Access application, policies, and service token. Local workerd stages attach no custom domain and continue to use their localhost URL.

### Durable Object Identity

**Decision:** Every Durable Object instance is keyed and accessed by its canonical domain ID.

- `WorkspaceServer` instances use `WorkspaceId`.
- `ProjectServer` instances use `ProjectId`.
- `IssueServer` instances use `IssueId`.
- Use the stable branded ID as the deterministic namespace key, never a display name or arbitrary caller-provided label.
- Client methods accept domain IDs; namespace lookup remains hidden inside the client implementation.

### Bookkeeper Server

**Decision:** Add a singleton `BookkeeperServer` Durable Object that owns an index of every Workspace, Project, and Issue server.

The singleton still follows the ID-keying rule through one reserved, stable ID:

```ts
type BookkeeperId = "bookkeeper";

const BOOKKEEPER_ID: BookkeeperId = "bookkeeper";
```

The Bookkeeper is the authoritative directory for entity registration, admission, deletion, and operation reservations, but it is not the source of truth for the full state held by each entity server. It must not pretend that a write to the Bookkeeper and a write to another Durable Object are one transaction.

#### Bookkeeper Modules

```text
apps/api/src/durable-objects/bookkeeper/
├── bookkeeper-http-api.ts
├── bookkeeper-database.ts
├── bookkeeper-server.ts
├── bookkeeper-client.ts
└── bookkeeper-migrations.ts
```

The shared HTTP contract is imported by both server and client. `BookkeeperDatabase` hides SQL, table structure, records, cursor encoding, stored-data parsing, transactions, and migrations. HTTP handlers yield `BookkeeperDatabase`; no handler yields `SqlClient` directly.

#### Bookkeeper Index Schemas

Bookkeeper output schemas are derived from the existing domain entity schemas so IDs and timestamps retain one definition site. They add only Bookkeeper-owned projection fields and do not independently redefine Workspace, Project, or Issue fields:

```ts
const BookkeeperWorkspace = Schema.Struct({
  id: Workspace.fields.id,
  createdAt: Workspace.fields.createdAt,
  updatedAt: Workspace.fields.updatedAt,
  deletedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});

const BookkeeperProject = Schema.Struct({
  id: Project.fields.id,
  workspaceId: Project.fields.workspaceId,
  createdAt: Project.fields.createdAt,
  updatedAt: Project.fields.updatedAt,
  deletedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});

const BookkeeperIssue = Schema.Struct({
  id: Issue.fields.id,
  projectId: Issue.fields.projectId,
  createdAt: Issue.fields.createdAt,
  updatedAt: Issue.fields.updatedAt,
  deletedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
});
```

These are Bookkeeper projections, not alternate domain entities. The generic `PaginationPage` schema wraps them for collection responses.

#### Bookkeeper Client

```ts
interface IBookkeeperClient {
  readonly listWorkspaces: (
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperWorkspace>, ListWorkspacesError>;
  readonly getWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Option.Option<BookkeeperWorkspace>, GetWorkspaceError>;
  readonly registerWorkspace: (
    workspace: BookkeeperWorkspace,
  ) => Effect.Effect<BookkeeperWorkspace, RegisterWorkspaceError>;
  readonly deleteWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<BookkeeperWorkspace, DeleteWorkspaceError>;

  readonly listProjects: (
    workspaceId: WorkspaceId,
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperProject>, ListProjectsError>;
  readonly getProject: (
    id: ProjectId,
  ) => Effect.Effect<Option.Option<BookkeeperProject>, GetProjectError>;
  readonly registerProject: (
    project: BookkeeperProject,
  ) => Effect.Effect<BookkeeperProject, RegisterProjectError>;
  readonly deleteProject: (id: ProjectId) => Effect.Effect<BookkeeperProject, DeleteProjectError>;

  readonly listIssues: (
    projectId: ProjectId,
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperIssue>, ListIssuesError>;
  readonly getIssue: (id: IssueId) => Effect.Effect<Option.Option<BookkeeperIssue>, GetIssueError>;
  readonly registerIssue: (
    issue: BookkeeperIssue,
  ) => Effect.Effect<BookkeeperIssue, RegisterIssueError>;
  readonly deleteIssue: (id: IssueId) => Effect.Effect<BookkeeperIssue, DeleteIssueError>;

  readonly getCounts: Effect.Effect<BookkeeperCounts, GetBookkeeperCountsError>;
}

class BookkeeperClient extends Context.Service<BookkeeperClient, IBookkeeperClient>()(
  "@overseer/BookkeeperClient",
) {}
```

The application-facing operations use `register` and `delete`; the HTTP adapter maps them to `PUT` and `DELETE`. `BookkeeperServer` is an Alchemy Durable Object with an inferred `{ fetch }` shape and no separate server interface.

`BookkeeperClient` resolves the singleton namespace during Alchemy Init but suspends `getByName(BOOKKEEPER_ID)` inside `makeExecutionMemo`. The first Bookkeeper operation in a Workspace Durable Object invocation constructs the stub-backed `HttpApiClient`; later Bookkeeper operations in that same invocation reuse it. A later invocation receives a fresh client for its new Cloudflare I/O context. Because Bookkeeper has one fixed target, this client does not need the keyed Effect `Cache` used by `WorkspaceClient`.

#### Initial Bookkeeper DDL

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX projects_by_workspace
  ON projects (workspace_id, deleted_at, id);

CREATE INDEX issues_by_project
  ON issues (project_id, deleted_at, id);
```

The Bookkeeper stores only identity, ownership, and timestamps. `deleted_at` is a tombstone; a null value means the indexed entity has not been deleted. `schema_migrations.version` versions the SQLite structure itself. The Bookkeeper should not store names, state, issue bodies, actor records, or per-row schema and projection metadata initially.

#### Initial Bookkeeper HTTP Interface

All routes are internal and versioned under `/v1`:

```text
GET    /v1/workspaces
GET    /v1/workspaces/:workspaceId
PUT    /v1/workspaces/:workspaceId
DELETE /v1/workspaces/:workspaceId
GET    /v1/projects?workspaceId=:workspaceId
GET    /v1/projects/:projectId
PUT    /v1/projects/:projectId
DELETE /v1/projects/:projectId
GET    /v1/issues?projectId=:projectId
GET    /v1/issues/:issueId
PUT    /v1/issues/:issueId
DELETE /v1/issues/:issueId
GET    /v1/counts
```

`PUT` registers or refreshes an index projection and is idempotent. Registration preserves the original creation timestamp, rejects an ownership change for a Project or Issue, and does not allow `updatedAt` to move backward. A Project requires a live parent Workspace; an Issue requires a live parent Project.

`DELETE` idempotently sets `deleted_at` and returns the resulting projection. Deleting a parent with live children is rejected. Tombstones are not initially restorable. Collection reads and counts exclude tombstones, while direct item reads return tombstoned records so reconciliation can distinguish deletion from an identity that never existed.

Collection reads use the shared cursor pagination module. `GET /v1/counts` provides live collection counts without requiring callers to enumerate every row. Actor indexing is deferred: `Actor` is currently an attribution value, not an independently addressable entity. HTTP endpoints are explicitly versioned through their `/v1` route prefix; schemas do not require version suffixes. The SQLite structure is versioned through Effect SQL migrations rather than a per-row version column.

#### Bookkeeper-First Mutation Protocol

Entity servers depend on their application-owned `BookkeeperClient`. Before a mutating CRUD operation changes local Durable Object state, it must write its intended registration, update, or deletion to the Bookkeeper and receive confirmation. The entity server may proceed with its local mutation only after that confirmation.

Bookkeeper and entity databases own their timestamps independently. Each service generates its timestamp immediately before its own write; timestamps are not passed between services or expected to match.

Entity reads go directly to the entity server and do not confirm the entity through Bookkeeper. Collection reads remain Bookkeeper operations because no individual entity server owns a collection. The mutation protocol remains intentionally non-atomic across Durable Objects: a confirmed Bookkeeper operation followed by a failed local mutation requires retry, reconciliation, and recovery behavior.

When the detailed protocol is designed, explore Effect `Scope`, `Effect.acquireRelease`, and `Effect.scoped` for reservation or lease lifetimes. The design should determine the operation record, idempotency key, expiration, retry, release, crash recovery, and whether Bookkeeper needs a separate operation-intent table.

#### Bookkeeper Database and Migrations

`BookkeeperDatabase` follows the same composition pattern as `WorkspaceDatabase`: its Layer depends on the generic Effect `SqlClient`, and `BookkeeperServer` provides `SqliteClient.layer({ storage: state.raw.storage })` inside the Durable Object runtime composition.

`makeBookkeeperDatabase` owns and runs its bundled `SqliteMigrator` loader before it returns the database service implementation. Migration definitions remain private to the database module. The database Layer cannot complete until all pending migrations finish, so the HTTP handler cannot become available against an old schema. Migration failures reject Durable Object construction and are never ignored or moved into operation error types. Migration execution never occurs during Alchemy's planning pass, is not launched through `state.waitUntil`, and is not deferred until an arbitrary request.

# Testing

Overseer favors deployed-stack integration tests over every other test form. The primary acceptance suite deploys the actual `OverseerApi` Stack with `alchemy/Test/Vitest`, sends real HTTP requests through the Access-protected custom domain, crosses the Worker, application services, Durable Object HTTP boundaries, Bookkeeper, and SQLite storage, and then destroys the Stack. Every public feature and endpoint must have deployed-stack coverage for its success behavior and every caller-reachable error path. A feature is not complete merely because a unit, service integration, or local-runtime integration test covers it. The canonical test strategy and suite outline live in [`docs/testing.md`](docs/testing.md); detailed harness research and pinned API examples live in [`docs/research/alchemy-effect-vitest-testing.md`](docs/research/alchemy-effect-vitest-testing.md).

The suite deploys one Stack once per suite file with `beforeAll(deploy(Stack))`, shares its output through Alchemy's lazy Effect accessor, waits for readiness with `Test.executeWhenReady`, and tears down with `afterAll(destroy(Stack))`. Keep one deployed-stack integration suite file initially so Vitest workers cannot race deployment and teardown. Organize that file by registering feature-specific test groups from non-test modules:

```text
apps/api/test/
  e2e.test.ts       # owns deploy, shared context, and destroy
  e2e/
    access.ts       # registers Access and identity cases
    workspace.ts    # registers all public Workspace cases
    test-client.ts  # typed/raw HTTP helpers; never owns hooks
    test-data.ts    # unique valid IDs and payloads
```

The feature modules are imported and invoked by the one `e2e.test.ts` orchestrator; Vitest must not discover them as independent files. Split into multiple `*.e2e.test.ts` files only when every file has an independent stage and lifecycle, or when the harness gains a single run-wide deployment fixture.

Every test run—whether started on a developer machine or in automation—creates a fresh Stack through the real providers under a unique, DNS-safe Alchemy stage such as `test-<user>-<run-id>`. Test runs never reuse `local`, a developer stage, `production`, or another run's stage. The stage is shared only by the suites participating in that one invocation and is destroyed when the invocation finishes. Assume this lifecycle is cheap, fast, and free: infrastructure cost is not a reason to reuse a Stack, replace deployed-stack coverage with a local runtime, or skip a real boundary. Concurrent local and automated runs remain isolated by their run IDs.

Every test creates unique domain data and is independently runnable; tests may share their run's infrastructure but never depend on another test's mutation. Destruction remains the normal final step, and automation also runs unconditional cleanup so interruption cannot routinely orphan resources. Use remote `Cloudflare.state()` for shared state coordination, and never log or snapshot the redacted Access token secret.

## Initial Deployed-Stack Integration Suite

Assume the main Worker adds public Workspace handlers backed only by `OverseerSdk`; its Workspace operations use `WorkspaceClient` to route each operation to the `WorkspaceServer` Durable Object keyed by `WorkspaceId`. For this test outline, the public routes are:

```text
GET  /
POST /v1/workspaces
GET  /v1/workspaces/:workspaceId
POST /v1/workspaces/:workspaceId/rename
POST /v1/workspaces/:workspaceId/archive
POST /v1/workspaces/:workspaceId/unarchive
```

The public create payload contains `name`; the SDK generates the `WorkspaceId`. The other routes take the ID from the path. The public `HttpApi` declaration owns the status and error-body contracts above; tests assert those contracts rather than implementation error classes.

### Deployment and Access

- A provisioned Agent service token reaches `GET /` through the custom domain and receives the API identity.
- A request with no Access credentials is rejected at the public edge.
- A request with invalid service-token credentials is rejected.
- Every public Workspace endpoint rejects an unauthenticated request. This verifies that the top-level API middleware continues to protect all groups and routes as the API evolves.
- Secrets and complete response headers are not snapshotted.

### Create Workspace

- A valid name creates an active Workspace with a generated canonical ID and parseable timestamps.
- A separate GET returns the same persisted Workspace, proving the request crossed the deployed Durable Object and storage boundaries.
- Distinct create requests produce distinct IDs and independent Durable Object state.
- Missing, malformed, empty, whitespace-only, overlong, multiline/control-character, and otherwise contract-invalid names produce the declared request error without creating a Workspace.
- The successful response proves the Bookkeeper-first registration path completed against the deployed Bookkeeper Durable Object; do not expose Bookkeeper's internal API solely for the test.

### Get Workspace

- A created Workspace is returned by ID with its complete persisted representation.
- A valid but unknown `WorkspaceId` produces the public not-found contract.
- A malformed path ID produces the public request-parsing contract and does not allocate meaningful domain state.

### Rename Workspace

- Renaming an existing Workspace changes only its name and update timestamp; ID, creation timestamp, and lifecycle state are preserved.
- A following GET observes the new name.
- A valid but unknown ID produces the public not-found contract.
- Every caller-visible invalid-name class produces the declared request error and leaves the stored Workspace unchanged.
- Rename behavior for an archived Workspace must be decided explicitly; once decided, the integration suite covers that success or rejection contract.

### Archive and Unarchive Workspace

- Archiving an active Workspace returns and persists the `archived` state while preserving identity, name, and creation timestamp.
- Unarchiving that Workspace returns and persists the `active` state.
- Archive and unarchive against a valid unknown ID each produce their declared not-found contract.
- Repeating archive on an archived Workspace and unarchive on an active Workspace cover the declared idempotency or transition-error contract. The current database implementation is idempotent, so changing that behavior requires an explicit domain decision and test update.
- A lifecycle sequence—create, rename, archive, read, unarchive, read—asserts that separate requests compose into one coherent persisted history and that `updatedAt` never moves backward.

### Concurrency and Boundary Cases

- Concurrent mutations against one Workspace are exercised against the deployed Stack to verify the Durable Object and mutation semaphore prevent corruption. Assertions describe legal observable outcomes rather than assuming network arrival order.
- Requests with wrong methods, malformed JSON, unsupported content types, and unexpected payload fields cover the public protocol contract where Effect HTTP API behavior is intentionally part of Overseer's API.
- Response parsing uses the public Schemas. Raw status and body assertions remain available for malformed requests and Access edge responses that cannot be decoded as application success/error values.

## Error-Path Accounting

Maintain an endpoint matrix beside the integration suite that lists every declared success and error variant and points to its test. Caller-inducible paths—authentication failure, malformed input, unknown IDs, illegal transitions, ownership failures, conflicts, and invalid cursors as those endpoints arrive—must run against the actual deployed Stack on every PR.

Some expected internal failures cannot be safely induced through the production public API: `database_unavailable`, `stored_workspace_invalid`, `workspace_registration_failed`, and `workspace_id_mismatch` are examples in the current Workspace modules. Never add production test-only endpoints, corrupt-storage switches, or fault flags merely to reach them. Prefer, in order:

1. an additional Alchemy-deployed scenario Stack using the same public handlers with a controlled failing or corrupt dependency Layer;
2. a deployed-stack integration test through an existing operational boundary that naturally creates the condition;
3. a focused integration test through the real Workspace HTTP/service interface when a deployed scenario would no longer represent the production path honestly.

Every row below the deployed-stack boundary records why the production Stack cannot safely induce it. This exception process keeps the suite comprehensive without pretending that a synthetic failure is the exact production deployment.

## Supporting Tests

Supporting tests exist only where they provide faster diagnosis, exercise otherwise uncontrollable failures, or prove pure application-owned rules:

1. **Local-runtime integration:** an optional explicitly selected developer feedback mode. The default local test command still deploys a fresh Stack through the real providers. The local runtime does not cover Cloudflare Access, custom-domain deployment, provider permissions, or real Durable Object provisioning and is not a substitute for any deployed-stack contract row.
2. **Integration:** public Effect service and HTTP contracts, real SQLite migrations/transactions, and controlled dependency Layers for failures that cannot be induced safely in the production Stack. Module mocks are forbidden.
3. **Unit and property:** nontrivial pure invariants, transitions, normalization, ordering, idempotency, and regressions. Do not restate straightforward Schema declarations or library mechanics.

Use `@effect/vitest` throughout Effect tests. Ordinary `it` owns synchronous pure tests; `it.effect` owns scoped programs using test services such as `TestClock`; Alchemy's harness uses live runtime services. Use `layer(...)` only when sharing one acquired Layer for a block is intentional; otherwise provide a fresh Layer per test. Assert expected failures through public error or protocol contracts, never through implementation spies or `vi.mock`.

The default local and automated `test` command runs unit tests followed by the complete uncached deployed-Stack endpoint matrix against a newly created stage. There is no reduced PR suite, main-only suite, nightly-only suite, or cost-based coverage split. `test:unit` is the explicit narrower inner-loop choice; a qualified local-runtime integration command may be added later, but neither is named or treated as the project's full test suite. Deployed-stack integration tests use explicit timeouts, bounded polling schedules, complete Stack configuration, and credentials for every Cloudflare and Alchemy state resource they provision.

# To-dos

- Explore a daily janitor Cron job or Durable Workflow that audits Bookkeeper records against all Workspace, Project, and Issue servers and reconciles inconsistencies.
