# ADR-0001: MVP system architecture

**Status:** Proposed review artifact for [#50](https://github.com/dmmulroy/overseer/issues/50). The product and topology constraints come from [#49](https://github.com/dmmulroy/overseer/issues/49); this document does not reopen them.

The public system is one Access-protected hostname. A Gateway Worker serves the static React SPA and the `/api` REST interface. The Gateway calls one singleton Workspace Registry Durable Object and one Project Durable Object per Project through typed RPC. Project SQLite owns project-local metadata; private R2 owns file bytes, never authorization or lifecycle.

## Decision boundary

### Settled constraints

The following are fixed by #49 and are not implementation choices:

- one Gateway Worker is the only public ingress;
- one singleton SQLite Workspace Registry Durable Object owns Workspace and Project registry state;
- one SQLite Project Durable Object per Project owns all project-local state;
- one private attachment R2 bucket and one private retained-recovery R2 bucket exist per deployed stage;
- one native Project alarm drives Attachment reconciliation;
- Cloudflare Access authenticates the human and independently credentialed Agent deployments;
- Alchemy exclusively owns each stage's Worker, Durable Object, R2, Access, domain, and class-lifecycle resources;
- the same-origin REST interface is rooted at `/api` and the pinned Effect HTTP declaration is its single contract source;
- the browser uses ordinary conditional REST reads, not realtime or a synchronization protocol;
- transactions stop at one Durable Object.

### Local, reversible choices made by the program design

These choices may change without changing the product contract or topology:

- source directories and file names;
- the exact operation-specific private RPC methods added by each implemented slice;
- SQL table and index names, migration function names, and query plans;
- Effect layer names and whether an immutable adapter is reused or constructed per invocation;
- in-memory cache eviction limits, provided the observable freshness policy remains unchanged;
- tracing provider and safe span names.

A change to public routes, domain behavior, authentication, storage ownership, client freshness, or UI direction is not a local choice. A contradiction in one of those areas requires a focused decision Issue.

### Focused contradictions

[#51](https://github.com/dmmulroy/overseer/issues/51) records one genuine contradiction exposed by this architecture. The settled mention behavior asks a qualified Issue mention in Project A to create a reciprocal backlink and one event projected onto the source and target Issues. If the target is in Project B, that requires one logical mutation across two authoritative Project Durable Objects. The settled topology forbids cross-object transactions and pseudo-transactions, and no failure/reconciliation contract exists.

This artifact does not silently choose new behavior. Same-Project Issue references remain atomic inside one Project object; Project mentions and external URLs remain source-side derived values. The cross-Project Issue case awaits #51's backlink, Timeline, and failure semantics. This does not block same-Project references or Attachment work.

[#52](https://github.com/dmmulroy/overseer/issues/52) is resolved by authoritative-object-local key ownership. The object that commits a create records the caller's key and created entity in the same local transaction. The same key may identify a different result in another Durable Object; there is no cross-object reservation or conflict detection. Workspace and Project creation currently share one namespace because the singleton Workspace Registry owns both operations.

[#53](https://github.com/dmmulroy/overseer/issues/53) records a third contradiction. Canonical project-local Entity URLs contain only a global Entity ID, but that prefixed ULID does not identify the owning Project Durable Object. Workspace Registry has no settled Entity-to-Project locator, namespace enumeration is unavailable for discovery, and publishing such a locator would need cross-object interruption/repair semantics. Slice 2's first canonical Issue URL and later canonical Label, Comment, Event, and Attachment URLs await #53.

## Topology

```mermaid
flowchart TB
  Human[Human browser] --> Access[Cloudflare Access]
  Agent[Agent deployment] --> Access
  Access --> Gateway[Gateway Worker]
  Gateway --> Assets[Static React SPA assets]
  Gateway --> WorkspaceRegistry[Workspace Registry Durable Object\nWORKSPACE_REGISTRY_SINGLETON_NAME]
  Gateway --> Project[Project Durable Object\nname: project_id]
  Gateway --> Attachments[(Private attachment R2)]
  Project --> Attachments
  Project --> Alarm[One native Project alarm]
  Alarm --> Project
  Operations[Operational recovery entrypoint] --> WorkspaceRegistry
  Operations --> Project
  Operations --> Recovery[(Private retained recovery R2)]
  WorkspaceRegistry --> WorkspaceRegistrySql[(Workspace Registry SQLite)]
  Project --> ProjectSql[(Project SQLite)]
  Alchemy[Alchemy stage graph] -. provisions .-> Access
  Alchemy -. provisions .-> Gateway
  Alchemy -. provisions .-> WorkspaceRegistry
  Alchemy -. provisions .-> Project
  Alchemy -. provisions .-> Attachments
  Alchemy -. provisions .-> Recovery
```

The Gateway, Workspace Registry constructor/RPC handler, Project constructor/RPC handler, Project alarm, browser bootstrap, Attachment transfer handler, and operational recovery command are separate composition roots even when Cloudflare hosts several of them in one Worker deployment.

## Component ownership and trust

| Part                              | Owns                                                                                                                                                                                                                              | Authoritative data                                                                                                                                                                                                                                                 | Ingress                                                    | Trust boundary                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Access                 | Admission policy and credential lifecycle                                                                                                                                                                                         | Human Allow policy, one Service Auth credential per Agent deployment, application audience                                                                                                                                                                         | Public hostname                                            | Establishes that a request passed Access, but the Gateway still validates the Access JWT, issuer, audience, signature, time, and identity claims.   |
| Gateway Worker                    | Public HTTP protocol, media negotiation, Access assertion parsing, human Origin checks, Agent-session header checks, request IDs, REST representation rendering, conditional responses, SPA/static delivery, Attachment streaming | No durable domain data                                                                                                                                                                                                                                             | Access-protected HTTP only                                 | Only public application ingress. Converts untrusted HTTP into parsed Overseer values and typed calls. Never trusts caller-supplied Actor fields.    |
| Static React SPA                  | Human interaction, URL state, session-memory canonical reads, explicit local drafts                                                                                                                                               | Current URL and persisted Issue/Comment drafts only; server resources are never authoritative in the browser                                                                                                                                                       | Gateway asset routes and authenticated `/api` calls        | Browser data, IndexedDB, focus/visibility, and network state are untrusted. Human unsafe requests must have the configured exact Origin.            |
| Workspace Registry Durable Object | Workspace/Project registry, membership, Project moves, archive lifecycle, workspace registry admission                                                                                                                            | Workspace records, Project records and immutable Project registry, migration ledger, and object-local creation keys                                                                                                                                                | Binding-only typed RPC from a composition root             | One-object SQLite transaction boundary. It neither accepts public HTTP nor owns project-local content.                                              |
| Project Durable Object            | Project-local consistency and invariant enforcement                                                                                                                                                                               | Issues and number counter, Labels, Comments, Revisions, Parent/Sub-issue and Blocking relations, Label assignments, Assignees, references, Timeline events/projections/positions, Attachment metadata/lifecycle, migration ledger, and Project-local creation keys | Binding-only typed RPC and its native `alarm()` entrypoint | One Project and one SQLite transaction boundary. A Project ID selects the object; mutable names and Issue numbers never do.                         |
| Attachment R2 bucket              | Opaque file bytes and R2 multipart mechanics                                                                                                                                                                                      | Attachment objects, internal multipart upload IDs/part ETags, final opaque object ETag                                                                                                                                                                             | Gateway transfer adapter and Project-alarm R2 adapter only | Private binding. It has no public/custom domain, presigned URL, authorization policy, or authoritative lifecycle metadata.                          |
| Recovery R2 bucket                | Retained logical export objects                                                                                                                                                                                                   | Versioned verified export bytes and manifests                                                                                                                                                                                                                      | Operational recovery adapter only                          | Private retained binding. It is not an application datastore or attachment fallback.                                                                |
| Native Project alarm              | At-least-once wake-up                                                                                                                                                                                                             | No independent work queue or schedule records beyond the platform alarm timestamp                                                                                                                                                                                  | Cloudflare calls `alarm()`                                 | A prompt to scan authoritative Attachment rows. The scan is idempotent; correctness does not depend on a single delivery.                           |
| Alchemy stage graph               | Provisioning and class lifecycle                                                                                                                                                                                                  | Encrypted deployment state and declared resource graph                                                                                                                                                                                                             | Deployment command                                         | Resource-management boundary, never a runtime domain interface. Stages have distinct hostnames, namespaces, buckets, Access applications, and data. |

## Entity and record ownership

An Entity is written only by its authoritative object. Other parts may hold identifiers, projections, immutable Actor snapshots, or cache entries but may not duplicate authority.

| Record family                                                                                                       | Authoritative owner                                       | Notes                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace and Project entities                                                                                      | Workspace Registry SQLite                                 | A Project move changes only Workspace Registry membership. Its Entity ID and Project Durable Object name remain unchanged.                                                                                                             |
| Issue, Label, Comment, and Timeline event entities                                                                  | Owning Project SQLite                                     | Project-local Issue numbers are allocated atomically from the owning Project's monotonic counter.                                                                                                                                      |
| Attachment entity metadata                                                                                          | Owning Project SQLite                                     | R2 contains bytes and provider metadata only. Public pending/ready/deleted lifecycle is Project state.                                                                                                                                 |
| Revisions, Parent/Sub-issue, Blocking, Label assignment, Assignee, Mention/reference, and Timeline position records | Owning Project SQLite                                     | These are values or relations, not independently identified entities. Shared events have one Entity ID and one immutable projection position on every same-Project affected Issue. Cross-Project Issue projection semantics await #51. |
| Actor and Agent-session snapshots                                                                                   | Owning Project SQLite on the Comment/event they attribute | The Gateway derives the Actor from Access; caller session metadata is parsed but grants no authority.                                                                                                                                  |
| Attachment bytes and multipart provider records                                                                     | Attachment R2                                             | Keys derive only from immutable Project and Attachment IDs. R2 upload IDs, keys, and part ETags never cross an application or public interface.                                                                                        |
| Browser canonical resources and ETags                                                                               | No durable owner in the browser                           | Session-memory copies are disposable observations. Only explicit drafts and their base revision/context persist in IndexedDB.                                                                                                          |
| Logical exports                                                                                                     | Recovery R2                                               | Export manifests identify source object, schema version, creation time, and verification result; they do not become live authority until an explicit restore procedure.                                                                |

## Trust and admission order

Every public request follows this order before protected data is disclosed:

1. Cloudflare Access admits the request.
2. The Gateway validates the injected Access JWT itself and parses an `AuthenticatedPrincipal`.
3. For an unsafe human request, the Gateway checks the exact configured Origin. For an Agent-deployment mutation, it parses the required `Overseer-Session-Id` and optional `Overseer-Harness`.
4. The HTTP adapter parses path, query, headers, media type, and body into the operation's contract type. Authentication and parse failures are not entered into idempotency storage.
5. Project-scoped operations ask Workspace Registry for current routing/admission state. Commands admitted after an effective archive are rejected; an already-admitted command may finish.
6. The Gateway invokes the authoritative object's operation-specific typed RPC method and projects its success or typed failure.

The inbound HTTP adapter owns steps 1–4's protocol/authentication parsing and final response projection. A Gateway-composed `ProjectOperations` Application Module owns Entity-owner resolution, Workspace Registry admission, and Project invocation for steps 5–6; the authoritative object owns idempotency in its transaction. `AttachmentTransfer` owns the equivalent admission and cross-store transfer sequence. Raw HTTP and bindings remain outside both modules.

Workspace Registry admission is a guard against writes to archived ancestry, not a distributed transaction or lock. No Workspace Registry lock is held while Project work runs.

## Important paths

### Authenticated discovery and read

```mermaid
sequenceDiagram
  actor C as Browser or Agent client
  participant A as Cloudflare Access
  participant G as Gateway HTTP root
  participant CDO as Workspace Registry DO
  participant PDO as Project DO

  C->>A: GET /api or linked resource
  A->>G: request + Access JWT assertion
  G->>G: validate JWT and parse principal and request
  alt GET /api, schema, or OpenAPI
    G->>G: render from the shared HTTP contract
  else Workspace/Project workspace registry read
    G->>CDO: operation-specific Workspace Registry RPC
    CDO->>CDO: read Workspace Registry SQLite
    CDO-->>G: plain success or typed tagged failure
  else project-local read
    G->>G: resolve owning Project using the issue 53 mechanism
    G->>CDO: admit/read Project registry entry
    CDO-->>G: Project admission
    G->>PDO: operation-specific Project RPC
    PDO->>PDO: read Project SQLite
    PDO-->>G: plain success or typed tagged failure
  end
  G->>G: render representation, links, cache policy, strong ETag
  G-->>C: 200 JSON or typed problem
```

The Gateway may construct a Project stub directly from a parsed Project ID only after Workspace Registry confirms the immutable registry entry and current archive context. A canonical URL containing only a project-local Entity ID must first use the routing mechanism selected by #53. Namespace enumeration is never discovery, and this artifact does not assume a hidden locator.

### Project-local mutation and Timeline projection

```mermaid
sequenceDiagram
  actor C as Browser or Agent client
  participant G as Gateway HTTP root
  participant CDO as Workspace Registry DO
  participant PDO as Project DO
  participant SQL as Project SQLite

  C->>G: mutation + headers/body
  G->>G: authenticate and parse Actor/session/input/idempotency
  G->>CDO: admit project command
  CDO-->>G: active admission or ancestor_archived
  G->>PDO: ProjectCommandEnvelope including creation key
  PDO->>SQL: begin transaction and look up the creation key
  PDO->>SQL: load parsed aggregate state when the key is unused
  PDO->>PDO: apply domain decisions and target-state semantics
  PDO->>SQL: persist decided entity/relation/revision changes
  PDO->>SQL: append decided event and affected Issue projections
  PDO->>SQL: advance aggregate Issue updated_at values
  PDO->>SQL: record the successful key-to-entity result and commit once
  PDO-->>G: current primary representation or tagged failure
  G->>G: project links and expected errors to REST
  G-->>C: 200/201 representation + fresh ETag
```

A no-op performs no Revision, event, timestamp, association, or idempotent relation change. A shared graph/reference event and all of its Issue-local projection positions commit in the same Project transaction. Creation and key recording commit together in the authoritative object's transaction.

### Conditional read and ETag response

```mermaid
sequenceDiagram
  actor C as Client
  participant G as Gateway
  participant O as Workspace Registry or Project DO

  C->>G: GET/HEAD canonical URL + If-None-Match
  G->>O: typed exact read (including filters/cursor)
  O-->>G: current parsed representation/page
  G->>G: encode canonical response bytes and strong ETag
  alt validator matches
    G-->>C: 304 + ETag + cache headers, no body
  else changed or no validator
    G-->>C: 200 + exact representation + ETag
  end
```

An ETag validates one exact representation or filtered/ordered page, including its pagination links. It is never an entity concurrency version and is never accepted as a mutation precondition.

### Attachment simple and multipart transfer/finalization

```mermaid
sequenceDiagram
  actor C as Client
  participant G as Gateway transfer root
  participant CDO as Workspace Registry DO
  participant PDO as Project DO
  participant R2 as Private attachment R2

  C->>G: authenticated upload request
  G->>G: parse metadata, principal, length, and operation
  G->>CDO: admit Project mutation
  CDO-->>G: active admission
  alt Simple upload (1..95 MiB)
    G->>PDO: begin idempotent pending Attachment
    PDO-->>G: Attachment ID + internal transfer instruction
    G->>R2: stream raw body to immutable object key
    R2-->>G: stored length + opaque ETag
    G->>PDO: finalize exact length/checksum
    PDO->>PDO: pending -> ready in SQLite transaction
    PDO-->>G: ready Attachment representation
    G-->>C: 201 ready Attachment + Location
  else Multipart (>95 MiB..1 GiB)
    G->>PDO: initiate idempotent pending Attachment
    PDO-->>G: pending representation + part plan
    G-->>C: 201 pending Attachment
    loop concurrent or out-of-order numbered parts
      C->>G: PUT exact part bytes
      G->>R2: upload/replace internal multipart part
      R2-->>G: internal part ETag
      G->>PDO: record uploaded part outcome
      PDO-->>G: current pending progress
      G-->>C: 200 pending Attachment
    end
    C->>G: POST complete
    G->>PDO: validate exact part set and lengths
    PDO-->>G: finalization instruction
    G->>R2: complete multipart upload
    R2-->>G: final size + opaque ETag
    G->>PDO: finalize ready metadata
    PDO-->>G: ready Attachment representation
    G-->>C: 200 ready Attachment
  end
```

SQLite and R2 do not form a transaction. A durable pending Attachment row is the reconciliation source of work if streaming or finalization is interrupted. Provider instructions and identifiers are adapter records, not public or domain values. Completion and abort use dedicated state/part idempotency; ordinary POST initiation uses the settled `Idempotency-Key` rules.

### Alarm-driven reconciliation

```mermaid
sequenceDiagram
  participant CF as Cloudflare alarm delivery
  participant P as Project alarm root
  participant SQL as Project SQLite adapter
  participant R2 as Attachment R2 adapter

  CF->>P: alarm() (at least once)
  P->>P: compose clock, Project state, and R2 adapters
  P->>SQL: scan due pending, never-associated, and retention rows
  loop each due authoritative row
    P->>R2: inspect/abort/delete idempotently
    R2-->>P: typed object outcome
    P->>SQL: apply lifecycle/cleanup result atomically
  end
  P->>SQL: compute next due wake-up
  P->>CF: set the one next native alarm
```

Pending uploads and ready Attachments never associated with Markdown expire after seven days. Explicitly deleted bytes are restorable for thirty days. The alarm owns no independent job table and can safely repeat after interruption. It uses the native Project `alarm()` entrypoint and direct alarm storage calls, not Alchemy `ScheduledEvents` or a scheduler abstraction. Infrastructure cleanup does not invent Attachment-specific Timeline events.

## Contracts and projections

### REST contract source

One shared, exactly pinned Effect `HttpApi`/Schema declaration owns:

- every stable route, method, path/query/header/body parser, success representation, expected problem variant, and media type;
- generated OpenAPI 3.1 at `/api/openapi.json`;
- content-addressed JSON Schema 2020-12 request documents under `/api/schemas/...`;
- the generated browser and Agent-client types.

The declaration is a wire-contract module, not a domain module. It imports protocol projections built from parsed Overseer values. It does not expose Effect internals, SQL rows, Durable Object stubs, R2 records, or Cloudflare bindings.

### Internal RPC contracts

Workspace Registry and future Project RPC are private, same-deployment Alchemy schemaless protocols. One application-owned TypeScript shape is shared by each Durable Object declaration and its caller adapter. Every caller-visible operation is its own method with a plain structured-clone-safe payload, plain success result, and precise Effect error channel. The implemented Workspace Registry surface is:

```text
listWorkspaces(input) -> WorkspacePage | typed list failures
readWorkspace(workspaceId) -> Workspace | typed read failures
createWorkspace(input) -> WorkspaceCreation | typed create failures
renameWorkspace(input) -> Workspace | typed rename failures
listProjects(input) -> ProjectPage | typed list failures
readProject(projectId) -> Project | typed read failures
createProject(input) -> ProjectCreation | typed create failures
renameProject(input) -> Project | typed rename failures
```

There is no generic read/command dispatcher, generic operation string, or cross-operation outcome union. Requests and results contain parsed Entity IDs and domain values—not `Request`, `Response`, `Env`, SQL rows, namespaces, stubs, or R2 types. Expected failures cross Alchemy's bridge as safe plain tagged records in Effect's error channel. Schemaless RPC strips prototypes, so callers match `_tag` with Effect combinators and never use `instanceof`.

The Durable Object boundary logs safe, detailed persistence classifications and translates local failures to cause-free remote tags. Defects reject native RPC. Alchemy's caller proxy turns those rejections into `RpcCallError`; the Gateway adapter represents that transport failure explicitly even though Alchemy's generated stub type omits it.

Both sides deploy together, so successful internal values are trusted rather than decoded again. Public HTTP and persisted SQLite remain independently parsed boundaries. `RpcDurableObject` and an Effect `RpcGroup` are not used; they become candidates only if cross-deployment validation or class reconstruction becomes a real requirement.

A future DO-to-DO call captures the required namespace in the caller's Alchemy outer constructor, then resolves a named stub and invokes its operation-specific method from a handler. It uses the same schemaless bridge as Worker-to-DO calls. Namespace capture is not admission, locking, or a cross-object transaction.

### Idempotency ownership

- A caller-supplied key identifies the first successful create result in one authoritative Durable Object and does not expire in the current implementation.
- Entity creation and key recording commit in the same object-local SQLite transaction. Invalid requests and failed transactions do not reserve keys.
- Replays ignore changed bodies, authenticated principals, and target paths. They return `201`, the current entity representation, its canonical `Location`, and `Idempotency-Replayed: true`.
- A key recorded for another result type in the same object namespace returns `409 idempotency_key_reused`. Workspace and Project creation therefore conflict in the current shared Registry namespace.
- The same key may be used independently in another Durable Object. Future Project-owned creates use Project-local key storage; no deployment-global coordination exists.
- Multipart part replacement, completion, and abort use their dedicated state/part semantics.

### Expected errors

Domain and application modules return precise tagged failures. Adapters classify Access, HTTP, SQL, RPC, R2, and configuration failures before those values cross inward. Private RPC preserves expected failures in Effect's typed error channel and sends only safe cloneable fields. The Gateway alone maps expected failures to RFC 9457 `application/problem+json`, preserving the stable code, request ID, retryability, field errors/details, and safe recovery links.

Unexpected defects are logged/traced with safe context and become `500`; raw SQL causes, R2 keys/upload IDs, Access assertions, service-token secrets, and unbounded caller input never appear in responses or telemetry.

### Client freshness boundary

The browser's conditional-query module owns `{ representation, etag, validated_at }` for each exact canonical URL in session memory. TanStack Router owns URLs and route lifetime, not canonical data. IndexedDB owns only explicit Issue/Comment drafts and their base revision/context.

The active Issue validates every 15 seconds and the active exact Issue-list page every 30 seconds. Only visible rendered routes poll. Completion schedules the next poll; duplicate demand coalesces; navigation cancels orphaned work. A result validated within five seconds may satisfy navigation, wake-up, or pre-mutation validation. `200` replaces representation and ETag; `304` advances only local `validated_at`. A failed validation leaves cached content readable but disables server writes. Retryable failures wait 5, 15, 30, then repeating 60 seconds and honor a longer `Retry-After`; success resets the backoff. Routine refresh stays quiet for two seconds before showing `Updating…`. Mutation success installs the returned representation before targeted conditional convergence.

## Migration and recovery responsibility

| Concern                                                           | Owner                                                                   | Rule                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Durable Object class creation/rename/transfer/deletion | Alchemy stage graph                                                     | Alchemy is exclusive owner. Review destructive plans; never mix hand-written class lifecycle declarations.                                                                                                                                                                                                  |
| Workspace Registry/Project SQLite schema                          | Each Durable Object constructor composition root and its SQLite adapter | Ordered forward-only migrations use a migration table, run inside Alchemy's bridge-owned constructor `blockConcurrencyWhile`, and receive full `ctx.storage`. Application constructors do not add a nested concurrency guard. No `PRAGMA user_version`, raw transaction statements, or nested transactions. |
| SQLite client and service Layers                                  | Each Durable Object activation                                          | The runtime creates exactly one `@effect/sql-sqlite-do` client from `state.raw.storage`, then provides a SQLite-backed application-owned persistence service Layer. Raw storage and SQL clients do not cross inward.                                                                                        |
| Handler/layer initialization                                      | Each Durable Object constructor                                         | Yield persistence, ID, and other application services; migrate and prime the long-lived handler before external work. Use Effect Clock for time. Correctness cannot depend on an eviction finalizer or manual bridge-scope management.                                                                      |
| Routine recovery                                                  | Cloudflare per-object PITR                                              | Maintain and test separate Workspace Registry and Project restore procedures within the 30-day window.                                                                                                                                                                                                      |
| Destructive change safety                                         | Operational recovery composition root                                   | Quiesce the affected object, create a versioned logical export in retained recovery R2, verify its manifest/content, then permit the destructive plan. This is operational RPC, not public REST.                                                                                                            |
| Attachment cleanup recovery                                       | Project alarm application module                                        | Reconcile from durable Attachment rows; repeat safely and schedule the next due alarm.                                                                                                                                                                                                                      |

A Workspace Registry export cannot atomically snapshot every Project, and no design pretends otherwise. A stage-level export is a manifest of independently quiesced and verified object exports.

## Explicitly rejected architecture

- **A second public Durable Object API:** rejected. Public REST terminates at the Gateway; Durable Objects expose binding-only typed RPC.
- **Direct browser-to-R2 access:** rejected. All upload and content delivery passes through authenticated Gateway routes; there are no public buckets, custom domains, or presigned URLs.
- **Cross-object pseudo-transactions:** rejected. Workspace Registry admission and Project execution are separate operations. No distributed lock, compensating fiction, cross-Project relation, or cross-object join is introduced. #51 and #53 must resolve references and canonical routing without silently assuming exceptions; #52 is resolved by local key ownership.
- **Public realtime/sync infrastructure:** rejected. There are no WebSockets, change-record feeds, replay sequences maintained for transport, durable client cursors, long polling, Queues, or Pub/Sub.
- **Raw runtime dependencies below composition roots/adapters:** rejected. `Env`, Cloudflare bindings, `Request`/`Response`, Durable Object state/stubs, Alchemy resource types, SQL rows/clients, and R2 records remain in runtime roots or their owning adapters.
- **Additional infrastructure:** rejected. No D1, `ScheduledEvents`, scheduler abstraction, extra Worker, prematurely deployed Project Durable Object, or repository-per-table persistence layer is added.
- **Schema-based or generic DO dispatch:** rejected for the same-deployment private seam. No `RpcDurableObject`, generic read/command protocol, or cross-object pseudo-transaction is introduced.
