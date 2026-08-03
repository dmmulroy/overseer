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

```ts
import * as Schema from "effect/Schema";

class ListWorkspacesError extends Schema.TaggedErrorClass<ListWorkspacesError>()(
  "ListWorkspacesError",
  {},
) {}

class GetWorkspaceError extends Schema.TaggedErrorClass<GetWorkspaceError>()(
  "GetWorkspaceError",
  {},
) {}

class CreateWorkspaceError extends Schema.TaggedErrorClass<CreateWorkspaceError>()(
  "CreateWorkspaceError",
  {},
) {}

class RenameWorkspaceError extends Schema.TaggedErrorClass<RenameWorkspaceError>()(
  "RenameWorkspaceError",
  {},
) {}

class ArchiveWorkspaceError extends Schema.TaggedErrorClass<ArchiveWorkspaceError>()(
  "ArchiveWorkspaceError",
  {},
) {}

class UnarchiveWorkspaceError extends Schema.TaggedErrorClass<UnarchiveWorkspaceError>()(
  "UnarchiveWorkspaceError",
  {},
) {}

class ListProjectsError extends Schema.TaggedErrorClass<ListProjectsError>()(
  "ListProjectsError",
  {},
) {}

class GetProjectError extends Schema.TaggedErrorClass<GetProjectError>()("GetProjectError", {}) {}

class CreateProjectError extends Schema.TaggedErrorClass<CreateProjectError>()(
  "CreateProjectError",
  {},
) {}

class ArchiveProjectError extends Schema.TaggedErrorClass<ArchiveProjectError>()(
  "ArchiveProjectError",
  {},
) {}

class UnarchiveProjectError extends Schema.TaggedErrorClass<UnarchiveProjectError>()(
  "UnarchiveProjectError",
  {},
) {}

class ListIssuesError extends Schema.TaggedErrorClass<ListIssuesError>()("ListIssuesError", {}) {}

class GetIssueError extends Schema.TaggedErrorClass<GetIssueError>()("GetIssueError", {}) {}

class CreateIssueError extends Schema.TaggedErrorClass<CreateIssueError>()(
  "CreateIssueError",
  {},
) {}

interface WorkspaceOperations {
  list(): Effect.Effect<ReadonlyArray<Workspace>, ListWorkspacesError>;
  get(id: WorkspaceId): Effect.Effect<Option.Option<Workspace>, GetWorkspaceError>;
  create(input: { name: WorkspaceName }): Effect.Effect<Workspace, CreateWorkspaceError>;
  rename(input: {
    id: WorkspaceId;
    name: WorkspaceName;
  }): Effect.Effect<Workspace, RenameWorkspaceError>;
  archive(id: WorkspaceId): Effect.Effect<Workspace, ArchiveWorkspaceError>;
  unarchive(id: WorkspaceId): Effect.Effect<Workspace, UnarchiveWorkspaceError>;
}

interface ProjectOperations {
  list(workspaceId: WorkspaceId): Effect.Effect<ReadonlyArray<Project>, ListProjectsError>;
  get(id: ProjectId): Effect.Effect<Option.Option<Project>, GetProjectError>;
  create(input: {
    workspaceId: WorkspaceId;
    name: ProjectName;
  }): Effect.Effect<Project, CreateProjectError>;
  archive(id: ProjectId): Effect.Effect<Project, ArchiveProjectError>;
  unarchive(id: ProjectId): Effect.Effect<Project, UnarchiveProjectError>;
}

interface IssueOperations {
  list(projectId: ProjectId): Effect.Effect<ReadonlyArray<Issue>, ListIssuesError>;
  get(id: IssueId): Effect.Effect<Option.Option<Issue>, GetIssueError>;
  create(input: {
    projectId: ProjectId;
    title: string;
    body: Option.Option<string>;
  }): Effect.Effect<Issue, CreateIssueError>;
}

interface OverseerSdk {
  readonly workspaces: WorkspaceOperations;
  readonly projects: ProjectOperations;
  readonly issues: IssueOperations;
}
```

# File Structure

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
class WorkspacesServer extends Cloudflare.DurableObject<WorkspacesServer>()(
  "WorkspacesServer",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      // Build the versioned Workspace HTTP API with state.storage.
      return {
        fetch: workspaceHttpApi,
      };
    });
  }),
) {}

interface IWorkspacesClient {
  readonly getWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Option.Option<Workspace>, GetWorkspaceError>;
  readonly createWorkspace: (
    input: { readonly name: WorkspaceName },
  ) => Effect.Effect<Workspace, CreateWorkspaceError>;
  readonly renameWorkspace: (input: {
    readonly id: WorkspaceId;
    readonly name: WorkspaceName;
  }) => Effect.Effect<Workspace, RenameWorkspaceError>;
  readonly archiveWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Workspace, ArchiveWorkspaceError>;
  readonly unarchiveWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Workspace, UnarchiveWorkspaceError>;
}

class WorkspacesClient extends Context.Service<WorkspacesClient, IWorkspacesClient>()(
  "@overseer/WorkspacesClient",
) {}
```

`WorkspacesServer` is the Alchemy Durable Object class. Its public shape is inferred from the object returned by the inner `Effect`; it does not need a separate server interface or named implementation value. `IWorkspacesClient` is the application-facing capability, and `WorkspacesClient` is its Effect service tag. The client implementation owns Durable Object namespace lookup, stub creation, `Cloudflare.toHttpClient`, and HTTP request and response translation.

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
  readonly renameWorkspace: (
    name: WorkspaceName,
  ) => Effect.Effect<Workspace, RenameWorkspaceError>;
  readonly archiveWorkspace: Effect.Effect<Workspace, ArchiveWorkspaceError>;
  readonly unarchiveWorkspace: Effect.Effect<Workspace, UnarchiveWorkspaceError>;
}

class WorkspaceDatabase extends Context.Service<WorkspaceDatabase, IWorkspaceDatabase>()(
  "@overseer/WorkspaceDatabase",
) {}
```

`WorkspaceDatabase` owns SQL, table structure, persistence records, stored-row parsing, and Workspace schema migrations. Stored rows are parsed through the domain Workspace schemas before leaving the database service. `makeWorkspaceDatabase` runs the bundled `SqliteMigrator` loader before obtaining and closing over the generic `SqlClient` and returning the service implementation. The `WorkspaceDatabase` Layer cannot finish acquisition until all pending migrations finish.

The Durable Object composition root adapts the current instance's native storage with `@effect/sql-sqlite-do`. Layer descriptions may be created beside the yielded state reference, but state-backed services and migrations are acquired only in the returned runtime Effect because Alchemy evaluates the outer Effect during planning with mock storage:

```ts
Effect.gen(function* () {
  const state = yield* Cloudflare.DurableObjectState;

  const workspaceDatabaseLayer = WorkspaceDatabase.layerWithoutDependencies.pipe(
    Layer.provide(SqliteClient.layer({ storage: state.raw.storage })),
  );

  return Effect.gen(function* () {
    // Acquire SQL, complete pending migrations, then construct the HTTP handler.
    const httpLayer = HttpApiBuilder.layer(WorkspaceHttpApi).pipe(
      Layer.provide(workspaceHttpHandlersLayer),
      Layer.provide(workspaceDatabaseLayer),
    );

    return { fetch: yield* HttpRouter.toHttpEffect(httpLayer) };
  });
});
```

Passing the complete `state.raw.storage` enables Effect SQL transaction support. One database service and SQL client are acquired for the Durable Object instance and shared by its handlers; they are not reconstructed for every request.

## Overseer API

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

Cloudflare Access injects the resulting signed `Cf-Access-Jwt-Assertion` header. The Worker verifies that assertion itself through an application-owned `CloudflareAccessVerifier` Effect service and a custom `HttpApiMiddleware` applied to the API. The middleware declares the header as an API-key security scheme, returns typed `401` failures, and provides the authenticated request context.

The verifier must validate:

- the JWT signature through the Access JWKS endpoint at `/cdn-cgi/access/certs`;
- the `RS256` algorithm;
- the configured issuer and Access application audience;
- the `exp` and `iat` claims; and
- the `JWT` type.

The initial implementation lives in `apps/api/src/cloudflare-access-verifier.ts`. `CloudflareAccessVerifier` is an application-owned Effect service around `jose`; it hides `createRemoteJWKSet`, `jwtVerify`, JWT payloads, key caching, and `jose` errors. Its `verifyAccessAssertion` operation accepts a `Redacted<string>` assertion and returns a parsed `CloudflareAccessPrincipal` or a classified `CloudflareAccessVerificationFailed` error. The production Layer reads and parses `ACCESS_AUDIENCE` and `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, constructs one remote JWKS client per Layer, and reuses that client's key cache across requests in the Worker isolate.

The verifier accepts only mutually exclusive Cloudflare application-token identities: a human has a nonempty bounded `sub`, a validated `email`, and no `common_name`; an Agent has an empty `sub`, a bounded visible-ASCII `common_name`, and no `email`. It classifies missing assertions, invalid assertions, invalid identities, and unavailable verification separately. It never returns raw JWT claims, never retains claim details in typed failures, and never unwraps the redacted assertion outside the verifier operation.

This module implements assertion verification only. The future HTTP middleware will map `CloudflareAccessPrincipal` into the domain `Actor`, provide `CurrentActor`, and translate verification failure into its typed `401` API response. Local fixed-human authentication remains a separate composition-root Layer rather than a permissive branch in the production verifier.

`Cloudflare.Access` infrastructure resources belong in the Alchemy composition root. Alchemy's separate `Access` runtime helper for obtaining outbound Access headers is a control-plane/CLI capability, not the Worker-side inbound JWT verifier.

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

Production uses the real Access verifier and Access policies. Local development uses a separate fixed local-human authentication Layer and does not provision or emulate Cloudflare Access. The local Layer is a composition-root substitution, not a claim that local workerd reproduces production Access admission.

### Durable Object Identity

**Decision:** Every Durable Object instance is keyed and accessed by its canonical domain ID.

- `WorkspacesServer` instances use `WorkspaceId`.
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
  readonly deleteProject: (
    id: ProjectId,
  ) => Effect.Effect<BookkeeperProject, DeleteProjectError>;

  readonly listIssues: (
    projectId: ProjectId,
    request: PaginationRequest,
  ) => Effect.Effect<PaginationPage<BookkeeperIssue>, ListIssuesError>;
  readonly getIssue: (
    id: IssueId,
  ) => Effect.Effect<Option.Option<BookkeeperIssue>, GetIssueError>;
  readonly registerIssue: (
    issue: BookkeeperIssue,
  ) => Effect.Effect<BookkeeperIssue, RegisterIssueError>;
  readonly deleteIssue: (
    id: IssueId,
  ) => Effect.Effect<BookkeeperIssue, DeleteIssueError>;

  readonly getCounts: Effect.Effect<BookkeeperCounts, GetBookkeeperCountsError>;
}

class BookkeeperClient extends Context.Service<BookkeeperClient, IBookkeeperClient>()(
  "@overseer/BookkeeperClient",
) {}
```

The application-facing operations use `register` and `delete`; the HTTP adapter maps them to `PUT` and `DELETE`. `BookkeeperServer` is an Alchemy Durable Object with an inferred `{ fetch }` shape and no separate server interface.

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

Reads should first resolve or confirm the entity through the Bookkeeper, but should not write a mutation record unless the later design requires a read lease. The protocol remains intentionally non-atomic across Durable Objects: a confirmed Bookkeeper operation followed by a failed local mutation requires retry, reconciliation, and recovery behavior.

When the detailed protocol is designed, explore Effect `Scope`, `Effect.acquireRelease`, and `Effect.scoped` for reservation or lease lifetimes. The design should determine the operation record, idempotency key, expiration, retry, release, crash recovery, and whether Bookkeeper needs a separate operation-intent table.

#### Bookkeeper Database and Migrations

`BookkeeperDatabase` follows the same composition pattern as `WorkspaceDatabase`: its Layer depends on the generic Effect `SqlClient`, and `BookkeeperServer` provides `SqliteClient.layer({ storage: state.raw.storage })` inside the Durable Object runtime composition.

`makeBookkeeperDatabase` owns and runs its bundled `SqliteMigrator` loader before it returns the database service implementation. Migration definitions remain private to the database module. The database Layer cannot complete until all pending migrations finish, so the HTTP handler cannot become available against an old schema. Migration failures reject Durable Object construction and are never ignored or moved into operation error types. Migration execution never occurs during Alchemy's planning pass, is not launched through `state.waitUntil`, and is not deferred until an arbitrary request.

# To-dos

- Explore a daily janitor Cron job or Durable Workflow that audits Bookkeeper records against all Workspace, Project, and Issue servers and reconciles inconsistencies.
