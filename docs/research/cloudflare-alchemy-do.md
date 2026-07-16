# Cloudflare primitives and Alchemy v2 for a DO-first Overseer

**Research date:** 2026-07-16  
**Question:** Can Overseer's agent-first MVP use Durable Objects—not D1—as the system of record for relational issues, graph relations, timelines, realtime updates, attachments, and authenticated human/agent access?

## Decision

**Yes. Use one SQLite-backed `Project` Durable Object per project as the authoritative consistency boundary.** Put every issue, project-local issue number, label, parent/blocking edge, comment, timeline event, mention, attachment record, and realtime subscription for that project in the same object's SQLite database. Put only workspace/project discovery in a small `WorkspaceCatalog` Durable Object. Use one public Worker as the authenticated HTTP/WebSocket composition root and one private R2 bucket for attachment bytes.

This topology matches Cloudflare's guidance to choose a Durable Object per “atom” of coordination rather than one global object. Each object is globally addressable, single-threaded, and has private transactional, strongly consistent storage; SQLite-backed storage and `sql.exec` are GA, not beta. The trade-off is equally important: consistency and SQL joins stop at the object boundary, so the MVP should keep graph edges and timeline queries project-local and avoid workspace-wide relational queries. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [release notes](https://developers.cloudflare.com/durable-objects/release-notes/#2025-04-07), [storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/))

```text
Cloudflare Access
  -> public Worker (authenticate, validate protocol, project lookup)
       -> WorkspaceCatalog DO (workspace/project registry only)
       -> Project DO named by immutable project ID
            -> private SQLite: project + issues + graph + timeline + attachment metadata
            -> hibernatable WebSockets: project event stream
       -> private R2 bucket: attachment bytes
```

No D1 dependency is needed for this MVP.

## Why the project is the right object boundary

A `Project` DO can enforce all current invariants in one local transaction:

- allocate a stable, monotonically increasing project-local issue number;
- compare and increment optimistic versions;
- reject parent and blocking cycles;
- update issue/label/assignee state;
- append the corresponding timeline event and mention cross-references;
- allocate a monotonically increasing project event sequence for replay.

Cloudflare explicitly recommends deterministic names for routing. Address each project object with an immutable project ID (`getByName(projectId)`), never a mutable slug or display name. The namespace API does not provide a method to enumerate object instances; keep the project IDs in `WorkspaceCatalog` rather than relying on namespace discovery. Named-object first use can also require a global uniqueness check of up to a few hundred milliseconds, after which routing is cached. ([namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/))

The catalog and project objects cannot participate in one transaction. Project creation, rename projection, and archival therefore need idempotent, retryable coordination. Make one side canonical and treat the other as a projection. For the personal MVP, the catalog can own discoverability while each project object owns project and issue behavior. Do not place issue rows in the catalog.

**Consequences:**

- Different projects scale independently; one project's load cannot serialize every workspace operation.
- A project is limited to one DO's capacity and storage. A SQLite-backed object has a **10 GB** storage cap and a soft limit of about **1,000 requests/second**; writes fail with `SQLITE_FULL` at the cap while reads and deletes remain available. SQL also limits a row/string/BLOB to 2 MB, tables to 100 columns, statements to 100 KB, and bound parameters to 100. ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/))
- Workspace-wide issue joins, globally atomic cross-project blocking edges, and globally ordered timelines are not available. If those become requirements, add an explicit asynchronous projection or revisit the partition—not ad hoc DO-to-DO pseudo-transactions.
- Location adds latency: an object is placed near its first request and currently does not relocate. Location hints are best effort; jurisdiction restrictions (`eu`, `us`, `fedramp`) are guarantees. ([data location](https://developers.cloudflare.com/durable-objects/reference/data-location/))

## Relational model and optimistic concurrency

Use ordinary normalized SQLite tables inside each project object: `project`, `issue`, `label`, `issue_label`, `parent_edge`, `blocking_edge`, `comment`, `timeline_event`, `mention`, and `attachment`. Store Markdown as text and bytes only in R2. Index issue state/assignee/update time, relation endpoints, timeline issue/sequence, and attachment state.

For issue creation, allocate the number and insert the issue plus creation event in one transaction. A single-row sequence (`next_issue_number`) is explicit and never decreases; soft deletion must not free or reuse a number.

For mutation, require an expected integer version from the client. The core write should be a compare-and-swap such as `UPDATE issue ... SET version = version + 1 WHERE id = ? AND version = ? RETURNING version`, followed in the same transaction by relation changes and timeline insertion. No returned row means conflict. Return an actionable `409 Conflict` (or consistently chosen `412`) containing the expected version, current version, current representation, and a stable error code. This avoids leases and CRDTs while making agent retries deterministic.

Use `transactionSync`/a synchronous storage transaction for multi-statement SQL and consume SQL cursors fully before any `await`; Cloudflare warns that a cursor resumed after an `await` has no stable snapshot and can observe later, even rolled-back, writes. Input/output gates help with storage correctness, but external I/O such as R2 or `fetch()` allows requests to interleave and is not part of the SQLite transaction. ([SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#exec), [DO rules on gates and external I/O](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/#understand-how-input-and-output-gates-work))

## Realtime topology

Use **one hibernatable WebSocket connection per open project view**, terminated by that project's DO. The Worker validates the upgrade and authenticated principal before forwarding it. The DO then uses `acceptWebSocket`, not the standard `accept`, so idle connections survive object eviction without duration billing. Hibernation discards all JavaScript memory and reruns the constructor; recover sockets with `getWebSockets()` and store only compact connection data in `serializeAttachment` (maximum **16,384 bytes**). Received WebSocket messages are limited to **32 MiB**. Code deploys disconnect all WebSockets, so reconnect is normal behavior. ([Cloudflare WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/#compute-billing))

Make the durable timeline the recovery protocol, not the socket:

1. Every committed mutation appends a timeline/event row with a project-wide monotonic `sequence` in the same transaction.
2. A subscriber sends its last observed sequence.
3. The DO sends persisted events after that sequence, then live events.
4. The client detects gaps and reconnects/replays; it never assumes delivery merely because a broadcast was attempted.

This handles hibernation, deployment disconnects, and a crash after commit but before broadcast. Socket attachments should contain only principal/session ID, project subscription, and last acknowledged sequence; durable authorization and events remain in SQLite.

## Attachments in R2

Create one **private** Alchemy-managed R2 bucket. Store random immutable object keys such as `workspace/project/attachment-id`, while the project DO stores authorization-relevant metadata, checksum, media type, size, original filename, and state. R2 is strongly globally consistent for reads, writes, deletes, metadata, and listings, but it is a separate service and cannot commit atomically with DO SQLite. ([R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/))

Use an explicit state machine:

1. The project DO transaction creates a `pending` attachment record and key.
2. The Worker streams bytes to R2 through its binding.
3. After a successful write (and optional checksum/size verification), the project DO transaction marks it `ready` and appends the timeline event.
4. A project alarm or administrative reconciliation removes stale pending rows and orphan objects idempotently.

For the simplest MVP, proxy uploads through the Worker and stream rather than buffer. The Cloudflare account plan limits inbound request bodies to 100 MB on Free/Pro, 200 MB on Business, and 500 MB by default on Enterprise, despite R2 supporting 5 GiB single-part and roughly 5 TiB multipart objects. ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/#request-and-response-limits), [R2 limits](https://developers.cloudflare.com/r2/platform/limits/))

If larger/direct uploads become necessary, issue short-lived S3 presigned `PUT` URLs and verify completion before marking ready. Presigned URLs are bearer credentials, can last from one second to seven days, work only on the R2 S3 endpoint (not custom domains), and `POST` form uploads are unsupported. They require R2 S3 credentials and a SigV4 implementation; an R2 Worker binding alone is not a presigner. ([presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/))

Serve downloads through the authenticated Worker and R2 binding for the MVP. This keeps authorization in one place and avoids making the bucket public or coupling Access to an R2 custom domain.

## Authentication and identity

### Human UI

Protect the Worker's custom hostname with an Alchemy-managed Access `self_hosted` application and an identity-based `allow` policy. Browsers receive an application-scoped `CF_Authorization` cookie. Access adds the application JWT to `Cf-Access-Jwt-Assertion`; the Worker must still validate its RS256 signature and `iss`, `aud`, time claims, and token type against the Access JWKS rather than trusting the header. Use the human token's stable `sub` as actor identity and email only as display/audit data. ([Access cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/), [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/))

### Non-browser agents

Add a second **Service Auth** policy on the same Access application and provision separate Access service tokens for independently revocable agent installations or harnesses. Agents send the standard `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers; Cloudflare explicitly recommends this path for headless coding agents. Do not use a Cloudflare API token as an application credential. ([authenticate coding agents](https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/), [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/#service-auth))

Validate the resulting application JWT exactly as for humans. Service-token JWTs have an empty `sub`; their `common_name` is the service token Client ID. Map that validated value to an application actor. Harness-provided session metadata is untrusted correlation data, never authority. ([application-token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/#service-token-authentication))

Operational details matter:

- If an Access app has only Service Auth policies, the credentials must be sent on every request; using both a human Allow policy and Service Auth policy permits a subsequently issued Access JWT where the client can retain it.
- Access supports putting the service-token pair in one configurable header, but that consumes (for example) `Authorization` with a JSON value. Prefer the standard two headers so Overseer can reserve `Authorization` for future application protocols.
- Rotate and revoke per-agent tokens. Cloudflare reveals the secret only at creation, and deleting the token—not merely revoking sessions—is what prevents a new session.

## Alarms, schema migration, and recovery

### Alarms

Each object can schedule **one** alarm. It is at-least-once, retries failures with exponential backoff starting at two seconds, and stops after six retries unless the handler catches the failure and explicitly schedules again. Store multiple due jobs in SQLite and use the one alarm for the earliest. Every job needs an idempotency key/state because duplicate execution is expected. Alarms are suitable for pending-upload cleanup, deferred projection, and maintenance—not as the only durable backup mechanism. ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/))

### Two different kinds of migration

Do not confuse them:

1. **Class lifecycle migrations** create/rename/delete/transfer a DO namespace. Cloudflare's new declarative `exports` flow replaces the legacy migration array, although existing migration-based Workers continue to work. Deleting a class permanently deletes every object's data. ([class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [release note](https://developers.cloudflare.com/durable-objects/release-notes/#2026-06-30))
2. **Application schema migrations** alter the SQLite schema in every project object. Run ordered, idempotent migrations during object construction under `blockConcurrencyWhile`, using a migration table; `PRAGMA user_version` is unsupported. Since objects wake lazily and the namespace API cannot enumerate instances, expect migration-on-next-use or maintain project IDs in the catalog and explicitly wake them. Prefer expand/contract schema changes across deploys. ([schema guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/#initialize-storage-and-run-migrations-in-the-constructor))

### Recovery and backup constraints

SQLite-backed DOs provide per-object point-in-time recovery for the complete SQL+KV database over the preceding **30 days**. Restore is initiated from inside that object and takes effect on its next restart; PITR is unavailable in local development. This is valuable operational recovery, but it is not a long-term, account-wide independent backup. ([PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api))

Cloudflare documents no D1-like bulk export/import for DO SQLite. Storage is Workers-only, each database is private to one object, and Data Studio requires an object name/ID and currently reads/writes SQL data only. Cloudflare explicitly notes that DO users may need to build database tooling that D1 includes. ([DO versus D1](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/#sql-in-durable-objects-vs-d1), [Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/))

Therefore:

- retain immutable project IDs outside each project's own database (the catalog plus deployment/operator records);
- define and test per-project PITR administration;
- if retention beyond 30 days is required, build an application-level, versioned export to R2 and state its RPO/RTO explicitly;
- do not claim such an export is a transactionally consistent external snapshot unless writes are quiesced or the export is reconstructed from the durable ordered event log.

## Alchemy v2 assessment

Alchemy v2 can compose the recommended stack today:

- `Cloudflare.Worker` with a custom domain;
- a typed `Cloudflare.DurableObject` namespace, `getByName`/RPC, SQLite storage, PITR, alarms, and hibernatable WebSocket wrappers;
- `Cloudflare.R2.Bucket` plus least-capability read/write bindings;
- `Cloudflare.Access.Application`, reusable `Policy`, and `ServiceToken` resources.

The v2 docs demonstrate deploy-time binding followed by runtime handlers, typed DO RPC, hibernation rehydration, R2 bindings, and Access service-token policy composition. ([Workers and bindings](https://v2.alchemy.run/cloudflare/compute/workers), [Durable Objects](https://v2.alchemy.run/cloudflare/compute/durable-objects), [hibernatable WebSockets](https://v2.alchemy.run/cloudflare/compute/hibernatable-websockets), [R2 bucket](https://v2.alchemy.run/providers/cloudflare/r2/bucket), [Access application](https://v2.alchemy.run/providers/cloudflare/access/application), [service token](https://v2.alchemy.run/providers/cloudflare/access/servicetoken))

Recommended composition discipline:

- The public Worker is the HTTP/Access/R2 composition root: validate Access JWTs, parse external input, turn bindings into application-owned ports, choose the project stub, and map domain failures to HTTP.
- The `Project` DO constructor/handlers are a separate composition root: adapt `DurableObjectState.storage` to project repositories and expose narrow project commands/queries. Domain/application code must not receive `Env`, binding names, raw requests, R2 buckets, or DO storage.
- Keep R2 transfer policy in an attachment application service; keep object serialization in an R2 adapter; keep SQL/schema/version logic in a DO SQLite adapter.
- WebSocket and alarm handlers are distinct runtime entrypoints and must assemble the same project services rather than reaching around them.

### Current gaps and risks

1. **Alchemy itself is beta.** The inspected current package is `2.0.0-beta.62`, so pin an exact version and expect API/state-format movement. ([package source at `a5a22a0`](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/package.json#L1-L4))
2. **Alchemy still emits legacy DO migration metadata.** It defaults new classes to `newSqliteClasses` and computes rename/delete/transfer migrations rather than using Cloudflare's new `exports` lifecycle. Legacy migrations remain supported, but do not mix an Alchemy-owned Worker with hand-written `exports`; verify destructive plans carefully, especially class removal or host movement. ([Alchemy provider source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/WorkerProvider.ts#L1714-L1839))
3. **The storage wrapper is broad but not complete/safely typed for domain errors.** It exposes SQL, KV, alarms, transactions, and PITR, plus raw `SqlStorage`, but does not expose `transactionSync` directly; its SQL effects declare `never` error even though quota, constraint, and `SQLITE_FULL` exceptions exist. Keep a binding adapter that catches/parses platform exceptions (or deliberately uses the raw state API) into application errors. ([Alchemy storage source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/DurableObjectStorage.ts#L28-L40), [storage interface](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/DurableObjectStorage.ts#L123-L180))
4. **Access's optional single-header service-token setting is not exposed by the inspected `ApplicationProps`.** The resource covers the self-hosted domain, IdPs, duration, and policies, while the service-token resource covers creation/rotation. Use the standard two headers, or treat any out-of-band application setting as an explicit drift risk. ([Application source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Access/Application.ts#L53-L160), [ServiceToken source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts#L47-L118))
5. **Service-token secrets enter Alchemy state.** Alchemy retains the one-time secret as a redacted value so it can survive reads and rotate declaratively. Redaction is not a substitute for secure state storage; restrict and encrypt the state backend and deliver credentials to agents through a secret manager. ([Alchemy source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts#L55-L83))
6. **No Alchemy abstraction removes cross-resource atomicity or backup limits.** R2 presigning, DO-to-R2 reconciliation, long-term export, replay protocol, and per-object schema migrations remain application responsibilities.

## Build guardrails for the final specification

- Scope issue graph relations and structured issue queries to one project for the MVP.
- Make project IDs immutable routing keys and issue numbers monotonic/non-reusable.
- Require expected versions on every mutable REST operation; append timeline and event sequence atomically.
- Treat WebSockets as an invalidation/event transport with sequence replay, never as durable delivery.
- Keep attachment bytes out of SQLite and model pending/ready/orphan reconciliation explicitly.
- Put both human Allow and agent Service Auth policies in front of the same Worker; validate the Access JWT again in the Worker.
- Pin Alchemy v2, inspect every DO lifecycle plan, and test production seams against the representative Cloudflare runtime.
- Document the 10 GB/project, ~1,000 requests/sec/object, Worker upload-size, one-alarm/object, deployment-disconnect, 30-day PITR, and no-bulk-export constraints as accepted MVP limits.

**Conclusion:** a DO-first Overseer is technically sound and preferable to D1 for the stated project-local relational and realtime invariants. Its success depends on honoring the project partition, making replay and R2 reconciliation explicit, and treating Alchemy v2 as a capable but beta composition layer—not as a substitute for platform lifecycle, error, and recovery design.
