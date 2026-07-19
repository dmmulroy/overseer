# MVP program design

**Status:** Review artifact for [#50](https://github.com/dmmulroy/overseer/issues/50). This code shape implements the responsibilities in [the system architecture](../adr/0001-mvp-system-architecture.md). Review that architecture before accepting this design.

This is a responsibility and interface plan, not a requirement to preserve incidental syntax. The proposed modules are deep at the seams that have real callers or technology variability. Files should be added only with the vertical slice that first needs them.

## Design rules

1. Parse every less-trusted value when it enters typed code: HTTP, RPC, SQLite reads, R2 metadata, IndexedDB records, environment configuration, and workflow/alarm re-entry are separate boundaries.
2. Domain modules own pure meaning and correct construction. Application modules own policy and effect order. Adapters own protocol, persistence, framework, and provider translation. Composition roots alone wire raw capabilities.
3. Expected failures remain precise typed values until an outer adapter projects them. Promise rejection/throw is reserved for defects after adapters classify known external failures.
4. No application or domain interface mentions `Env`, `Request`, `Response`, `DurableObjectState`, Durable Object/R2 bindings or stubs, Alchemy resource types, SQL clients/rows, browser storage records, or Effect HTTP internals.
5. Use direct imports from owning files. Do not create `index.ts` barrels.
6. Do not use module mocks. Tests and callers cross the same public seam.
7. Do not create repository-per-table modules, a Base UI mirror, generic managers, forwarding services, or a shared dependency bag.
8. Pin the complete Effect family to exactly `4.0.0-beta.98`, including an override that prevents transitive duplication. A version change must rerun the workerd compatibility fixture.

## Proposed tree diff

The current repository has product/domain documentation but no application source. The target tree below is grouped by role; it is a destination map, not a first commit.

```text
+ alchemy.run.ts                         # Alchemy stage composition root
+ package.json                           # exact runtime/tool pins and verification scripts
+ package-lock.json
+ components.json                        # owned shadcn base-nova provenance/config
+ tsconfig.json
+ vite.config.ts
+ vitest.config.ts
+ playwright.config.ts
+
+ src/domain/                            # pure Domain Modules
+   entity-id.ts                         # prefixed ULID family and parsers
+   non-empty-line.ts                    # bounded nonblank single-line text
+   markdown.ts                          # bounded Markdown and reference extraction values
+   actor.ts                             # AuthenticatedPrincipal -> immutable Actor projection types
+   issue.ts                             # Issue states, text, number, readiness projections
+   issue-relationships.ts               # Parent and Blocking DAG decisions/order rules
+   label.ts                             # Label name/description/color/lifecycle
+   comment.ts                           # Comment lifecycle and revision decisions
+   timeline.ts                          # event vocabulary and projection values
+   attachment.ts                        # metadata, part plan, lifecycle, retention decisions
+   pagination.ts                        # parsed limits/sorts/filter values; no opaque encoding
+   idempotency.ts                       # key/fingerprint/result semantics
+
+ src/application/catalog/               # Catalog Application Module
+   catalog.ts                            # operations, outcomes, exact dependencies
+   catalog-state.ts                     # one cohesive transaction/state port
+   catalog-rpc.ts                       # private decoded RPC request/outcome contract
+
+ src/application/gateway/
+   project-operations.ts                # owner resolution, admission, idempotency, dispatch
+
+ src/application/project/
+   project-rpc.ts                       # private decoded Project RPC protocol only
+   project-transactions.ts              # shared transaction primitive; no policy
+
+ src/application/issues/                 # cohesive Project-local capabilities
+   issue-discovery.ts                   # create/read/list and its narrow state port
+   issue-steering.ts                    # lifecycle/assignee policy and Timeline writes
+   text-contributions.ts                # Issue text, Comments, and Revisions
+   classification.ts                    # Labels and assignments
+   work-structure.ts                    # Parent/Sub-issue and Blocking relations
+   references.ts                        # Markdown-derived reference reconciliation
+
+ src/application/attachments/            # metadata and cross-SQLite/R2 capabilities
+   attachment-metadata.ts               # Project-owned lifecycle and narrow state port
+   attachment-transfer.ts               # simple/multipart sequencing and finalization
+   attachment-objects.ts                # application-owned byte-store port
+   attachment-reconciliation.ts         # idempotent due-row scan and next wake-up
+
+ src/application/operations/
+   logical-export.ts                    # quiesced per-object export/verification capability
+
+ src/contract/                           # inbound HTTP wire-contract Adapter Module
+   http-api.ts                           # single Effect HttpApi declaration
+   representations.ts                   # REST projections and common Link/Problem schemas
+   request-schemas.ts                    # content-addressed schema publication
+   openapi.ts                            # OpenAPI generated from http-api.ts
+
+ src/adapters/gateway/                   # public inbound/outbound adapters
+   access-principal.ts                   # Access JWT -> AuthenticatedPrincipal
+   request-context.ts                    # Actor/session/origin/request-id parsing
+   gateway-http.ts                       # Effect HTTP handlers and media negotiation
+   problem-response.ts                   # typed failures -> RFC 9457
+   conditional-response.ts               # strong ETag/HEAD/304/cache headers
+   catalog-rpc-client.ts                 # Catalog Durable Object binding adapter
+   project-rpc-client.ts                 # Project Durable Object binding adapter
+   attachment-http.ts                    # raw upload/range/content streaming
+
+ src/adapters/catalog-sqlite/
+   catalog-sqlite-state.ts               # deep CatalogState implementation
+   catalog-records.ts                    # raw row schemas and projections
+   catalog-migrations.ts                 # ordered forward-only migrations
+
+ src/adapters/project-sqlite/
+   project-sqlite.ts                     # one wider adapter satisfying capability ports
+   project-records.ts                    # raw row schemas and projections
+   project-migrations.ts                 # ordered forward-only migrations
+
+ src/adapters/r2/
+   r2-attachment-objects.ts              # AttachmentObjects implementation
+   r2-content-response.ts                # range/provider header mechanics
+   r2-logical-exports.ts                 # retained recovery bucket adapter
+
+ src/adapters/browser/
+   effect-http-resources.ts              # generated client/status/header translation
+   indexeddb-drafts.ts                   # parsed Issue/Comment draft persistence
+
+ src/runtime/                             # runtime composition roots
+   gateway.ts                            # Worker fetch/static/API composition
+   workspace-catalog.ts                  # Catalog DO constructor and RPC entrypoint
+   project.ts                            # Project DO constructor/RPC/alarm entrypoints
+   recovery.ts                           # operational export/verification command
+
+ src/browser/                             # browser composition root and product UI
+   main.tsx                              # RegistryProvider, generated client, Router
+   route-tree.tsx                        # typed URLs/search and route lifetime
+   client/conditional-query.ts           # exact-URL ETag/SWR/freshness module
+   client/commands.ts                    # preflight, optimism, convergence, rollback
+   client/wake-signal.ts                 # polling/focus/visibility/online scheduling
+   shell/app-shell.tsx
+   features/workspaces/**
+   features/projects/**
+   features/issues/**
+   features/timeline/**
+   features/attachments/**
+
+ src/ui/theme.css                        # sole global semantic-token source
+ src/ui/components/*.tsx                 # owned generic shadcn/Base UI source, direct imports
+
+ tests/http/*.test.ts                    # authenticated Gateway HTTP in local workerd
+ tests/browser/*.spec.ts                 # authenticated SPA through real Gateway
+ tests/adapters/*.test.ts                 # only representative runtime mechanics
+ tests/fixtures/access-identity.ts
+ tests/fixtures/effect-cloudflare/**      # pinned compatibility regression fixture
+ tests/fixtures/private-r2.ts
```

Feature UI stays feature-colocated. It may import owned generic controls directly, but it does not import Base UI or CVA. Generic controls do not acquire Issue, Workspace, Project, Assignee, blocked, or other domain variants.

## Module interfaces and seams

### Domain values

The exact implementation may use Effect Schema brands, but construction remains parser-owned.

```ts
EntityId = WorkspaceId | ProjectId | IssueId | LabelId |
  CommentId | AttachmentId | TimelineEventId

IssueNumber       // positive project-local integer
RevisionNumber    // positive owner-local integer
TimelinePosition  // positive Issue-local integer
NonEmptyLine<Maximum>
Markdown<Maximum>
Assignee
LabelColor        // null or canonical uppercase #RRGGBB
StrongEtag
IdempotencyKey
CanonicalUrl

AccessSubject
EmailAddress
AgentDeploymentClientId
AgentSessionId
HarnessName
RequestId

AuthenticatedPrincipal =
  | { _tag: "HumanPrincipal"; subject: AccessSubject; email: EmailAddress }
  | { _tag: "AgentDeploymentPrincipal"; clientId: AgentDeploymentClientId }

Actor =
  | { kind: "human"; subject: AccessSubject; email: EmailAddress }
  | { kind: "agent_deployment"; clientId: AgentDeploymentClientId }

AgentSession = { sessionId: AgentSessionId; harness: HarnessName | null }
CommandAttribution = { actor; agentSession: AgentSession | null; requestId: RequestId }
```

Application modules also receive only the narrow generic capabilities they use:

```text
Clock.now() -> Instant
EntityIds.next<K extends EntityKind>(kind: K) -> EntityIdFor<K>
RequestTracer.child(SafeSpanContext) -> RequestTracer
```

`Clock`, `EntityIds`, and tracing are composed explicitly; application code does not read ambient time/randomness or global telemetry. Issue numbers and Timeline positions remain transactionally allocated by Project state rather than by `EntityIds`.

The domain lifecycle types are tagged unions rather than combinations of optional booleans:

```text
Workspace/Project: Active | Archived(archivedAt)
Issue: Live(Open | Closed(closedAt)) | Deleted(previous state, deletedAt)
Label/Comment: Live | Deleted(deletedAt)
Attachment: Pending(plan, expiresAt) | Ready(metadata) | Deleted(restorable, deadline)
Relation: Active | Inactive(reason)
```

Domain modules expose parsers/smart constructors, predicates, legal transition decisions, and projections. They do not perform I/O, read ambient time, allocate IDs, authorize a principal, or render HTTP.

High-value pure decisions include:

- Entity ID prefix/ULID parsing;
- nonblank length-limited text parsing without normalization;
- independent Parent and Blocking DAG cycle checks over preserved edges;
- complete-set Sub-issue reorder validation;
- Blocking/Parent/Label relation activity and Issue readiness;
- Revision/no-op decisions;
- Markdown reference extraction/reconciliation plans;
- Attachment simple/multipart limits, exact part plan, retention due dates, and legal lifecycle transitions;
- idempotency fingerprint equality and cursor/filter binding inputs.

### Catalog application seam

`Catalog` is the sole application interface used inside the Catalog Durable Object. Its caller-facing operations are the closed `CatalogRead` and `CatalogCommand` families rather than table-shaped CRUD.

```text
CatalogRead:
  DiscoverWorkspaces | ReadWorkspace | ListWorkspaceProjects |
  DiscoverProjects | ReadProject | AdmitProject

CatalogCommand:
  CreateWorkspace | RenameWorkspace | ArchiveWorkspace | RestoreWorkspace |
  CreateProject | RenameProject | MoveProject | ArchiveProject | RestoreProject

CatalogCommandEnvelope:
  command + attribution + optional idempotency context + admittedAt
```

Key outcomes are parsed `Workspace`, `Project`, exact collection pages, `ProjectAdmission`, or precise failures:

```text
CatalogError =
  WorkspaceNotFound | ProjectNotFound | AncestorArchived |
  ActionNotApplicable | InvalidCursor |
  IdempotencyKeyReused | IdempotencyInProgress |
  CatalogStateUnavailable | CatalogRecordCorrupt
```

`CatalogState` is one cohesive persistence port because Workspace membership, Project moves, lifecycle, and idempotency must share one transaction. It exposes semantic transaction-scoped operations, not a repository per entity and not SQL:

```text
CatalogTransactions.atomically(operation(CatalogState))

CatalogState:
  read catalog records as parsed values
  insert records with application-constructed IDs
  update membership/lifecycle
  resolve/store idempotency result
  page by parsed catalog filter/cursor
```

The application module owns admission and operation ordering. The SQLite adapter owns SQL statements, row parsing, keyset mechanics, and rollback. If the first implementation shows that an operation can be expressed as one deep semantic state method without moving policy into SQL, prefer that smaller method over exposing implementation steps.

### Project-local application seams

The Project Durable Object is one consistency and routing boundary, not one mega application module. Its inbound RPC adapter dispatches closed protocol cases to cohesive application modules:

| Application module | Caller-visible responsibility | Narrow state port |
|---|---|---|
| `IssueDiscovery` | create/read/page Issues and allocate immutable Project-local numbers | Issue records, number allocation, exact filtered keyset reads, plus the idempotency capability selected by #52 |
| `IssueSteering` | open/close and claim/release/reassign with attributed Timeline effects | Issue state/Assignee plus event/projection writes |
| `TextContributions` | Issue text, Comments, Revisions, no-ops, and narrative Timeline | text/Comment/Revisions plus event/projection writes |
| `Classification` | Label lifecycle and Issue assignments | Label/assignment records plus affected Issue projections |
| `WorkStructure` | Parent/Sub-issue order and Blocking invariants/readiness | preserved relation graphs plus affected Issue projections |
| `References` | current Markdown-derived references and same-Project backlinks | source text/reference sets plus affected Issue projections |
| `AttachmentMetadata` | pending/ready/deleted metadata, part progress, association, and retention | Attachment/association records plus the idempotency capability selected by #52 |

Each module defines operation-specific input/outcome types and an exact transaction port beside itself. One wider `ProjectSqlite` adapter may structurally satisfy all of those ports because one database owns the aggregate; callers never receive the wider adapter. This keeps SQL mechanics reusable without forcing unrelated application policies through one `ProjectState` interface.

Representative inputs and outcomes are:

```text
CreateIssueInput -> Issue
SteerIssueInput -> UpdatedIssue | NoChangeIssue
EditIssueTextInput -> UpdatedIssue | NoChangeIssue
SetParentInput -> CurrentPrimaryIssue
BeginAttachmentInput -> PendingAttachment + TransferPlan
ListIssuesInput -> exact Page<IssueSummary>
```

Representative precise error families are:

```text
IssueDiscoveryError = IssueNotFound | InvalidCursor |
  IdempotencyKeyReused | IdempotencyInProgress | ProjectStateUnavailable
SteeringError = IssueNotFound | ResourceDeleted | ActionNotApplicable |
  ProjectStateUnavailable
RelationError = CrossProjectRelation | RelationCycle | RelationConflict |
  RelationSetChanged(current ordered relation page) | ProjectStateUnavailable
AttachmentError = AttachmentNotReady | AttachmentInUse | UploadExpired |
  InvalidPart | IncompleteUpload | LengthMismatch | AttachmentNotRestorable |
  ProjectStateUnavailable
```

Every exported operation names only the errors it can produce. A broad union exists only at the private RPC codec and Gateway problem-projection adapters.

A capability transaction exposes only semantic operations required by that module. For example:

```text
IssueSteeringTransactions.atomically(operation(IssueSteeringState))
IssueSteeringState:
  load parsed Issue steering state
  persist a decided state/Assignee transition
  allocate Timeline positions
  append one event and all affected projections
```

The location and atomic protocol for ordinary POST idempotency are intentionally deferred to [#52](https://github.com/dmmulroy/overseer/issues/52). Capability ports must follow that decision; this plan does not assume Project-local rows can enforce a principal-global key scope.

`EntityIds` constructs Entity IDs before persistence. SQLite transaction state allocates only values requiring database serialization, such as Issue numbers and Timeline positions. Application modules call pure domain decisions and commit their complete record/Revision/reference/Timeline plans in one short transaction. The adapter owns row schemas, SQL statements, keyset encoding, and rollback; it returns parsed values or typed corruption/unavailability failures, never raw rows.

Qualified cross-Project Issue mention semantics are deliberately absent until [#51](https://github.com/dmmulroy/overseer/issues/51) resolves the contradiction between reciprocal atomic projections and one-Project transaction ownership. `References` may implement same-Project Issue references, Project mentions, and external URLs without inventing that missing policy.

### Private RPC seam

Two adapters make this a real seam:

1. the Gateway-side Catalog/Project RPC clients turn application calls into binding calls and decode outcomes;
2. the Durable Object inbound RPC adapters decode requests, dispatch to the owning Catalog or cohesive Project-local application module, and encode plain tagged outcomes.

The private protocol may use cohesive `read` and `command` methods with closed unions. It must not mirror every REST route or accept generic `{ operation: string; payload: unknown }`. RPC codecs are versioned with the single deployment and parse both ingress and egress because Alchemy transport strips class identity.

RPC only carries parsed Overseer values and safe failure context. Provider exceptions and Durable Object stubs remain in the adapters.

### Attachment transfer seam

`AttachmentTransfer` exists because SQLite metadata and R2 bytes cannot transact and because both simple and multipart HTTP entrypoints need one lifecycle policy. Deleting it would spread begin/transfer/finalize/recovery rules across handlers, so it earns the seam.

```text
AttachmentMetadata (application-owned port):
  begin(input, attribution, idempotency) -> PendingAttachment + TransferPlan
  recordPart(attachmentId, PartOutcome) -> PendingAttachment
  validateCompletion(attachmentId) -> CompletionPlan
  finalize(attachmentId, StoredObject) -> ReadyAttachment
  abort(attachmentId, reason) -> DeletedAttachment

AttachmentObjects (application-owned port):
  putSimple(ObjectIdentity, ByteStream, ExactLength)
  initiateMultipart(ObjectIdentity)
  putPart(MultipartIdentity, PartNumber, ExactLength, ByteStream)
  completeMultipart(MultipartIdentity, CompletedParts)
  abortMultipart(MultipartIdentity)
  inspect/delete/readRange by immutable ObjectIdentity
```

`ObjectIdentity` is a correctly constructed Overseer value containing only immutable Project and Attachment IDs; the R2 adapter derives the private object key. Multipart provider handles and part ETags remain in adapter-owned transfer records. Where a private RPC must round-trip one, its codec exposes only an opaque parsed `TransferReference` and no application/domain code inspects or constructs its raw representation. Byte streams terminate in the transfer adapter and are not passed into domain modules.

Expected transfer failures are values such as `TransferUnavailable`, `LengthMismatch`, `InvalidPart`, and `StoredObjectMismatch`. The Gateway maps them to the settled retry/problem behavior. The application module never retries an externally observable POST under a new key.

`AttachmentReconciliation` uses the same metadata and object ports plus an injected `Clock`. It scans due authoritative rows, performs idempotent object work, records each result, and returns a `ReconciliationReport` containing the optional next wake time. The Project alarm composition root alone translates that value into the native `setAlarm` call; no scheduler port or abstraction exists.

### Gateway project-operation seam

`ProjectOperations` is a Gateway-level Application Module for project-local reads and commands. It receives narrow application-owned ports for Entity-owner resolution (as selected by #53), Catalog admission, Project RPC, and ordinary POST idempotency (as selected by #52). Given a parsed operation, it resolves the owning Project when necessary, obtains current Catalog admission, applies idempotency policy, invokes the owning Project capability, and returns a typed application outcome. This is application policy and effect ordering, not HTTP behavior.

Attachment transfer remains a separate cohesive Application Module because it additionally sequences byte streams and R2. It receives the same narrow Catalog-admission capability and performs admission before metadata/R2 effects. Neither application module sees headers, `Request`/`Response`, bindings, stubs, or problem representations.

### HTTP adapter seam

The shared `HttpApi` declaration owns the wire contract. `gateway-http.ts` supplies handlers that:

1. parse protocol input and request context;
2. invoke `ProjectOperations`, `AttachmentTransfer`, or the Catalog application port with parsed inputs;
3. project direct representations or `{ items, links }` pages;
4. compute strong ETags over exact encoded representations;
5. map expected errors through `problem-response.ts`.

Outer Effect HTTP 404/405/media failures and schema failures are normalized into the same safe JSON problem contract. No route module classifies failures by message text. `conditional-response.ts` owns GET/HEAD, `If-None-Match`, `304`, range-independent cache policy, and ETag headers so route handlers cannot drift.

### Browser query and command seams

`conditional-query.ts` is an application-owned Effect Atom module over a narrow `ConditionalResources` port. The port accepts a parsed canonical resource request and optional `StrongEtag`, then returns `Modified<Representation>` or `NotModified` with typed retry advice. `effect-http-resources.ts` implements it with the generated client and owns `If-None-Match`, `200`/`304`, ETag/header parsing, and `Retry-After` translation. For one exact canonical URL, the application module owns:

```text
ConditionalResource<A> =
  NoValue |
  Success { representation: A; etag: StrongEtag; validatedAt: MonotonicInstant } |
  Refreshing { previous: Success<A>; startedAt } |
  Stale { previous: Success<A>; error; nextRetryAt } |
  Unavailable { error }
```

The module handles `200`/`304`, five-second grace, one in-flight read, completion-based polling, cancellation, and stale-readable state. Retryable failures wait 5, 15, 30, then repeating 60 seconds while honoring a longer `Retry-After`; success resets the schedule. Routine refresh is silent for two seconds, after which presentation receives an `Updating` state. It exposes state and a force-validation action, not cache internals.

`commands.ts` accepts a parsed command, a narrow typed `ResourceCommands` port, and the exact affected query keys. The generated-client adapter implements the port and translates HTTP outcomes; the application module owns pre-write validation, deterministic optimism, rollback, returned-representation installation, and targeted convergence. React feature code renders command/query states and drafts; it does not sequence network Effects itself. TanStack Router owns URL/search parsing and route lifetime only.

`Drafts` is an application-owned browser port:

```text
Drafts.load(DraftIdentity) -> Effect<Draft | null, DraftRecordCorrupt | DraftStorageUnavailable>
Drafts.save(ParsedDraft) -> Effect<DraftSaved, DraftStorageUnavailable>
Drafts.remove(DraftIdentity) -> Effect<DraftRemoved, DraftStorageUnavailable>
```

The IndexedDB adapter parses records on every read. It stores explicit Issue/Comment text, base Revision/context, and timestamps; it never stores canonical query data or an offline mutation queue.

## Call-stack trees

### Authenticated HTTP read

```text
runtime/gateway.fetch(raw Request, raw Env)
└─ adapters/gateway/gateway-http.handle
   ├─ access-principal.parseAndVerify(assertion, parsed Access config)
   ├─ request-context.parse(request) -> principal/request ID
   ├─ contract/http-api route parser -> ReadInput
   └─ application/gateway/project-operations.read (for project-local data)
      ├─ for an Entity-only URL: owner-routing port selected by #53
      ├─ Catalog-admission port
      │  └─ catalog-rpc-client -> Catalog application/SQLite
      └─ Project-read port
         └─ project-rpc-client -> owning application read/Project SQLite
└─ contract/representations project parsed result + applicable links
└─ conditional-response -> 200/304/HEAD or problem-response
```

### Project-local command

```text
runtime/gateway.fetch
└─ gateway-http command handler parses principal/Actor/session/body/key
   └─ application/gateway/project-operations.command
      ├─ resolve owner through #53-selected port when needed
      ├─ admit through narrow Catalog port
      ├─ apply #52-selected idempotency protocol
      └─ invoke narrow Project-command port
         └─ runtime/project RPC root decodes plain tagged input
            └─ owning Project-local application command
               └─ its narrow capability transaction
                  ├─ load parsed aggregate slice
                  ├─ domain module decides transition/invariants/no-op
                  ├─ persist record/Revision/reference changes
                  ├─ append event and every affected Timeline projection
                  └─ commit
      └─ complete #52-selected idempotency protocol
└─ gateway-http projects representation/links or typed problem
```

### Workspace/Project catalog admission

```text
Gateway catalog operation or project-scoped operation
└─ catalog-rpc-client
   └─ Catalog.read/command/admit
      └─ CatalogTransactions.atomically (commands) or exact read
         ├─ parse stored Workspace/Project records
         ├─ resolve immutable Project registry entry
         ├─ derive effective archive context
         ├─ for catalog command: apply move/lifecycle/idempotency atomically
         └─ return ProjectAdmission { projectId, workspaceId, accessState }
└─ Gateway either rejects ancestor_archived or calls Project by ProjectId
```

The admission result is not a lock token. The Project call does not participate in the Catalog transaction. When ingress has only a project-local Entity ID, the owner-resolution step must use [#53](https://github.com/dmmulroy/overseer/issues/53)'s selected mechanism; no module may scan Project namespaces or assume an unrecorded mapping.

### Attachment transfer and finalization

```text
Gateway attachment HTTP entrypoint
├─ parse/authenticate/admit and stream constraints
└─ AttachmentTransfer
   ├─ AttachmentMetadata.begin -> Project RPC -> durable pending row
   ├─ AttachmentObjects.putSimple OR initiate/putPart/complete -> R2 adapter
   ├─ verify exact stored length and provider checksum
   └─ AttachmentMetadata.finalize -> Project RPC
      └─ pending -> ready transaction, no Attachment-specific Timeline event
└─ return ready/pending representation or resumable typed problem

Project alarm entrypoint after interruption
└─ AttachmentReconciliation
   ├─ scan due pending/retention metadata in Project SQLite
   ├─ inspect/abort/delete through R2 AttachmentObjects
   ├─ record idempotent lifecycle result in Project SQLite
   └─ return optional next wake time
Project alarm composition root
└─ call native setAlarm when a next wake time exists
```

### SPA query/mutation convergence

```text
browser/main.tsx
└─ RegistryProvider + ConditionalResources adapter + TanStack Router
   └─ route mounts exact conditional query atom
      ├─ render cached Success immediately when present
      ├─ validate through narrow ConditionalResources port
      │  └─ generated-client adapter owns If-None-Match and 200/304 translation
      ├─ Modified replaces representation/ETag; NotModified advances validatedAt
      └─ wake-signal schedules visible-route 15s/30s validation

feature interaction
└─ command atom
   ├─ if relevant Success is older than 5s: force and await validation
   ├─ if text base diverged: preserve draft and require explicit choice
   ├─ apply supported deterministic optimistic reducer
   ├─ execute through narrow ResourceCommands port
   ├─ failure: rollback canonical view, preserve draft, expose typed error
   └─ success: install returned representation first
      ├─ invalidate owning Issue key
      ├─ conditionally validate affected rendered pages
      ├─ validate visible list when membership/order may change
      └─ mark offscreen affected entries stale without fetching
```

## Effect layer and composition plan

### Version and contract discipline

- Pin `effect`, every `@effect/*` package, and the package-manager override to exactly `4.0.0-beta.98`.
- Keep `effect/unstable/httpapi`, `@effect/sql-sqlite-do`, Web request/response types, and Cloudflare integrations in contract/adapters/runtime modules.
- Generate request schemas, OpenAPI, and browser client from the one `src/contract/http-api.ts` declaration. Do not hand-maintain parallel contract types.
- The compatibility fixture may use `skipLibCheck` for the known dependency declaration conflicts, but application source remains strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `noFallthroughCasesInSwitch`.

### Gateway root

For each invocation, the Gateway root parses stage configuration, establishes request correlation/tracing, wraps exact bindings in Catalog/Project/R2 adapters, and invokes the prebuilt HTTP handler. Request-scoped objects do not enter reusable layers. Static immutable schemas and handler definitions may be reused across invocations.

The Gateway converts every expected error into a safe HTTP response. A rejected Effect or Promise may cross `fetch` only for a defect after logging safe context.

### Durable Object roots

In each Catalog/Project constructor:

1. call `blockConcurrencyWhile`;
2. pass the full `ctx.storage` to the SQLite Effect adapter;
3. run ordered migrations;
4. build the object-local adapters and cohesive application modules;
5. construct and prime the long-lived handler/RPC runtime outside any external request's I/O context;
6. classify and log initialization failure so a rejected constructor callback safely resets the object.

Do not let the first request own lazy layer construction. Keep transactions short, do not issue SQL transaction statements, and do not nest transactions. Effect resources must be eviction-safe; `dispose` is used only where a real lifecycle owner exists, such as tests, never for correctness.

The Project `alarm()` method is another composition root over the already initialized object-local state plus an R2 adapter. It invokes `AttachmentReconciliation`, then passes the returned wake time directly to the native alarm binding. It does not call a public/request-shaped handler or introduce a scheduler interface.

### Browser root

The browser root constructs one generated `AtomHttpApi.Service` over `FetchHttpClient.layer`, one Effect Atom registry, the IndexedDB Drafts adapter, and TanStack Router. Registry lifetime is the authenticated browser application. Promises do not cross transport, query, command, routing, or application interfaces; `promiseExit` is allowed only at an outer browser interaction that truly requires imperative sequencing.

## Test-interface map

The seams below are the agreed interfaces for implementation slices. Lower tests supplement rather than replace the two primary seams.

| Confidence sought | Public seam | Real dependencies | Observable assertions |
|---|---|---|---|
| Agent-client behavior | Authenticated Gateway HTTP in local Cloudflare/workerd | Real Gateway, Catalog/Project objects, SQLite, private-R2-compatible adapter, test Agent-deployment Access identity | REST representation/problem, links, status/headers, ETag/304, persisted result as observed through later REST, Timeline projection, transfer bytes |
| Human behavior | Authenticated browser SPA against that Gateway | Built SPA, real generated client/query pipeline, same local runtime | Role/name-visible UI, URL/search state, keyboard/pointer behavior, focus return, responsive semantics, stale/draft/rollback presentation |
| Domain invariants | Exported pure Domain Module interface | No I/O | Parsed value/error, transition decision, graph/reference/part plan; property checks where stronger than examples |
| SQLite/DO mechanics | Catalog/Project RPC or owning application interface in representative workerd runtime | Full `ctx.storage`, migrations, transactions, interruption | committed/rolled-back observable result, reconstruction survival, constructor priming, typed record-corruption outcome |
| R2 mechanics | Authenticated Attachment HTTP seam; focused adapter check only for provider-specific ranges/multipart | Private local R2-compatible binding | exact content/range headers and bytes, replacement/idempotency, no provider identifiers |
| Client query mechanics | Rendered route and generated-client integration | Effect Atom registry and controllable real HTTP server/Gateway | 200/304, polling, cancellation, stale-readable state, optimism/rollback, targeted convergence |
| Runtime compatibility | Pinned Effect/Cloudflare fixture | workerd versions used by production build | JSON error normalization, transaction rollback/interruption, cold start/abort priming |

No test asserts internal calls, SQL table names, private atom maps, layer construction order through spies, or module layout. Module mocks are forbidden. Tests use ordinary public imports and real/injected ports. Compile-time tests cover public inference where widening would change callers.

## Seam justification and rejected abstractions

| Proposed seam | Why it is real | What is deliberately not added |
|---|---|---|
| Catalog RPC | Gateway and operational tooling call a separately located consistency owner. Transport serialization and object routing vary. | No public Catalog REST inside the object; no Workspace and Project repositories. |
| Project RPC | Gateway and private recovery tooling call one separately located Project consistency owner. | No RPC method per SQL table and no request-shaped Project `fetch`. |
| Project/Catalog state ports | Application policy must be testable apart from SQL while production needs transactional SQLite mechanics. | No repository per Entity, ORM model leakage, or transaction object exposed to callers. |
| AttachmentTransfer | Simple/multipart Gateway handlers share non-transactional SQLite/R2 sequencing and recovery policy. | No direct R2 access, presigned flow, or generic blob service. |
| AttachmentReconciliation | Native alarm and focused tests need the same idempotent due-row behavior. | No scheduler framework, queue, or durable job abstraction. |
| Conditional query | Every route needs the same exact-URL ETag, grace, polling, cancellation, and stale behavior. | No Router data cache, persistent canonical cache, or synchronization engine. |
| Drafts | IndexedDB and an inert test adapter are genuine storage implementations for explicit local drafts. | No generic browser persistence facade or offline mutation queue. |
| Owned generic UI controls | Base UI behavior and app feature composition are distinct, and shadcn source is intentionally owned. | No Base UI mirror, component barrel, Box/Stack DSL, or domain variants. |

A new seam needs an actual second implementation, technology translation, or caller-facing responsibility. Symmetry is not sufficient.
