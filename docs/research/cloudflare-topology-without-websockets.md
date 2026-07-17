# Cloudflare topology without required realtime transport

**Research date:** 2026-07-17  
**Scope:** GitHub issue [#36](https://github.com/dmmulroy/overseer/issues/36), reconsidering only the topology established in [#13](https://github.com/dmmulroy/overseer/issues/13), [#16](https://github.com/dmmulroy/overseer/issues/16), and the [prior research artifact](https://github.com/dmmulroy/overseer/blob/artifact/assess-cloudflare-alchemy/docs/research/cloudflare-alchemy-do.md).

## Executive recommendation

**Keep the persistence and security topology; remove the realtime subsystem; simplify scheduled maintenance.**

The singleton SQLite `Catalog` Durable Object and one SQLite `Project` Durable Object per Project remain the right boundaries. Their purpose is authoritative coordination and project-local relational consistency, not WebSocket hosting. Cloudflare recommends modeling a Durable Object around an “atom” of coordination and explicitly describes a parent object that tracks child objects while each child owns its own SQLite database; each object's storage is private, transactional, and strongly consistent. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [SQLite-backed storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/))

Keep the Access-gated Gateway Worker, two private production R2 buckets (attachments and retained recovery exports), Alchemy ownership of resources and Durable Object class lifecycle, ordered in-object schema migrations, 30-day per-object PITR, and verified exports before destructive operations. Remove WebSocket ingress and handlers, public change-record/replay APIs, event-sequence state used only for replay, and durable client cursors. Do not replace them with D1, Queues, Pub/Sub, another Worker, or another Durable Object.

One further simplification is warranted: **replace Alchemy's general-purpose scheduled-event table with the native single Durable Object alarm for Project attachment reconciliation.** Cloudflare supplies one at-least-once alarm per object; that exactly matches the one remaining recurring wake-up. Alchemy's pinned scheduler adds an `alchemy_scheduled_events` table and advances or deletes rows before returning due events to the application, machinery that is unnecessary for one idempotent scan of authoritative attachment rows. ([Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [Alchemy `2.0.0-beta.62` scheduler source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/ScheduledEvents.ts#L115-L166))

```text
Cloudflare Access
  -> Gateway Worker (React assets, REST, authenticated attachment transfer)
       -> Catalog DO named "default"
            -> private SQLite: Workspace/Project registry and lifecycle
       -> Project DO named by immutable Project ID
            -> private SQLite: project-local authoritative state
            -> one native alarm: attachment reconciliation only
       -> private attachment R2 bucket
       -> private retained recovery R2 bucket
```

Alchemy can continue to deploy the Worker and both Durable Object classes in one stage-specific resource graph; its Worker guide covers bound resources, and its Durable Object guide registers a class and lifecycle metadata with the hosting Worker. ([Alchemy Workers](https://v2.alchemy.run/cloudflare/compute/workers/), [Alchemy Durable Objects](https://v2.alchemy.run/cloudflare/compute/durable-objects/)) The Gateway, Catalog, and Project remain separate composition roots even if one Worker deployment hosts all runtime entrypoints.

## Exact decision deltas

| Standing decision | Decision now | Exact delta |
|---|---|---|
| Singleton SQLite Catalog DO | **Keep** | None. It remains the narrow authority for Workspace/Project registry, membership, moves, archival, and discovery. It must not absorb project-local issue traffic. |
| One SQLite Project DO per Project | **Keep** | Remove transport-owned state only: replay sequence, public change-record log, durable subscriber cursors/acknowledgements, and socket session metadata. Keep project-local relational state, counters, optimistic versions, graph invariants, and any domain timeline/audit rows the product independently requires. |
| Access-gated Gateway Worker | **Keep, simplify** | It is now HTTP-only: assets, REST, Access JWT validation, attachment upload/download, and typed calls to Catalog/Project objects. Delete WebSocket upgrade detection and forwarding. |
| Project `fetch` used for forwarded WebSocket upgrades | **Remove** | The Project public surface becomes narrow RPC methods plus `alarm`; no request-shaped forwarding entrypoint is required. Cloudflare recommends RPC methods for modern Durable Object callers, and Alchemy exposes typed methods from `getByName`. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [Alchemy Durable Objects](https://v2.alchemy.run/cloudflare/compute/durable-objects/)) |
| Hibernatable WebSockets and replay after gaps/deploys | **Remove** | Delete socket acceptance, hibernation rehydration, socket attachments, broadcast logic, gap detection, replay queries, and WebSocket-specific tests/limits. There is no replacement infrastructure. |
| Public Project change-record stream | **Remove** | Ordinary REST reads/writes may return current representations, but no public ordered stream or synchronization feed is retained. A domain timeline, if retained, is queryable history rather than a delivery protocol. |
| Durable sync cursors | **Remove** | No server-side cursor rows, client acknowledgement state, cursor retention policy, or restore-time cursor invalidation remains. |
| Private attachment R2 | **Keep** | Attachment bytes still belong in private object storage; authorization and lifecycle metadata remain in the Project object. Explicit pending/ready recovery remains because R2 I/O is outside the object's SQLite transaction. Cloudflare documents that R2 access is external I/O relative to Durable Object storage and that buckets are private unless public access is explicitly enabled. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)) |
| Private retained recovery R2 | **Keep** | Continue to separate recovery artifacts from runtime attachments and retain the production recovery bucket. Alchemy `RemovalPolicy.retain()` selects the retain policy explicitly. ([Alchemy removal-policy source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/RemovalPolicy.ts#L4-L29)) |
| Alchemy `scheduleEvent` / `processScheduledEvents` for Project reconciliation | **Replace** | Use the Project object's native `setAlarm`/`alarm` directly. On each wake-up, scan authoritative pending attachment rows idempotently and schedule the next wake-up. Reintroduce a multi-event scheduler only if multiple independent scheduled jobs become real requirements. |
| Alchemy-managed Durable Object lifecycle | **Keep** | Continue to let Alchemy exclusively emit class lifecycle migration metadata. The pinned provider computes new SQLite classes, deletes, renames, and transfers. Do not add hand-written Cloudflare `exports`: Cloudflare supports both the declarative `exports` flow and legacy migrations but rejects using both in one Worker configuration. ([Alchemy Worker provider source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/WorkerProvider.ts#L1714-L1839), [Cloudflare class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)) |
| Ordered application schema migrations in each object | **Keep, shrink** | Keep the migration table and constructor initialization under `blockConcurrencyWhile`; omit realtime tables from the initial schema or remove them in a forward migration after export. Cloudflare recommends constructor migrations, notes that `PRAGMA user_version` is unsupported, and shows a dedicated migration table. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/#initialize-storage-and-run-migrations-in-the-constructor)) |
| 30-day PITR plus verified pre-destructive logical exports | **Keep** | Recovery protects authoritative issue/catalog state, not sync state. Export schemas no longer need replay events or cursors, and a restore no longer needs to coordinate cursor resets with clients. |
| No D1 | **Keep** | Removing realtime requirements does not remove the Project's coordination or relational-transaction requirements. Adding D1 solely to replace either existing object would add a datastore and a new consistency boundary rather than simplify the topology. |

## Evidence and consequences

### 1. The Durable Object partition was not justified by WebSockets

Cloudflare distinguishes stateless request handling in Workers from stateful coordination in Durable Objects, recommends one object per logical coordination unit, and presents parent/child objects as the way to combine registry queries with independent child databases. A single object has its own private storage, while deterministic `getByName` routing sends the same name to the same instance. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [Durable Object namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/))

That maps directly to the standing model:

- `Catalog.getByName("default")` is the coordination unit for the small global registry and lifecycle metadata.
- `Project.getByName(projectId)` is the coordination unit for issue numbering, optimistic versions, labels, comments, graph relations, and project-local invariants.
- Different Projects remain independently routable and scalable. The accepted ceiling remains 10 GB and a soft 1,000 requests/second per SQLite-backed object. ([Cloudflare Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/))

WebSockets benefited from this partition, but did not create it. Their removal only narrows the Project object's responsibilities. Collapsing all Projects into Catalog would turn the singleton into the global bottleneck Cloudflare warns against; moving data to D1 would surrender the already chosen per-Project private transactional boundary without eliminating Catalog or the Gateway. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/))

### 2. The Gateway remains necessary, but becomes a simpler HTTP composition root

Cloudflare describes the common pattern as a stateless Worker handling authentication, validation, and response formatting before routing to a stateful Durable Object. Durable Object storage is Workers-only, and Alchemy's `getByName` produces typed RPC stubs. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [Cloudflare: Durable Objects versus D1](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/#sql-in-durable-objects-vs-d1), [Alchemy Durable Objects](https://v2.alchemy.run/cloudflare/compute/durable-objects/))

Therefore the Gateway still owns the public hostname and remains the only public ingress. The simplification is substantial but local:

- no `Upgrade: websocket` branch;
- no forwarding to `Project.fetch`;
- no connection authorization/rehydration state;
- no live broadcast after a mutation;
- no replay/cursor endpoint;
- no WebSocket deployment or message-size concerns in the accepted MVP limits.

Access is independent of transport. Access policies still supply identity-based **Allow** and machine-oriented **Service Auth** actions; service tokens use the standard Client ID/Secret headers. A Worker placed behind Access must still validate the `Cf-Access-Jwt-Assertion` JWT against the account keys, issuer, and application audience. ([Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/), [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/))

Keep the existing human Allow policy, per-agent Service Auth tokens, JWT validation, and one Access application over the whole Gateway hostname.

### 3. R2 boundaries and attachment recovery do not change

R2 remains the appropriate byte store. Buckets are not public unless explicitly exposed, a Worker can access them through a binding, and completed R2 reads/writes/deletes/listings are strongly globally consistent. ([R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/))

Those guarantees do not create a transaction with Project SQLite. Cloudflare's Durable Object guidance states that external I/O such as R2 allows other requests to interleave, while the SQLite storage API's transaction applies to the object's private storage. ([Cloudflare: Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/#avoid-race-conditions-with-non-storage-io), [SQLite-backed storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/))

Consequently, keep immutable attachment keys, Project-owned attachment metadata, explicit pending/ready states, authenticated Gateway streaming, and idempotent reconciliation. None was realtime infrastructure.

### 4. Native alarms are now the deeper scheduling primitive

Cloudflare permits one alarm timestamp per Durable Object, guarantees at-least-once execution, and retries a throwing handler with exponential backoff for up to six retries. It also documents rescheduling from the alarm handler. ([Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/))

The pinned Alchemy scheduler is a multiplexing layer over that primitive: it creates `alchemy_scheduled_events`, chooses the earliest due row, and updates repeating rows or deletes one-shot rows before returning them to user handling. ([Alchemy `2.0.0-beta.62` scheduler source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/ScheduledEvents.ts#L9-L21), [processing source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/ScheduledEvents.ts#L133-L166))

Overseer has only one remaining scheduled concern per Project: wake up and reconcile attachment rows. Direct alarms remove an internal table and avoid treating scheduler rows as work ownership. The Project's attachment rows remain the source of truth; the alarm merely prompts an idempotent scan. If the handler fails, let it throw for Cloudflare retries, while also arranging a future alarm according to the documented finite-retry behavior.

This replaces **Alchemy scheduling**, not Alchemy itself. Keep Alchemy for the stage resource graph, bindings, Access/R2 resources, typed Durable Object stubs, and class lifecycle. Those capabilities are present in its official Worker, Durable Object, R2, and Access resources. ([Alchemy Workers](https://v2.alchemy.run/cloudflare/compute/workers/), [Durable Objects](https://v2.alchemy.run/cloudflare/compute/durable-objects/), [R2 Bucket](https://v2.alchemy.run/providers/cloudflare/r2/bucket/), [Access Application](https://v2.alchemy.run/providers/cloudflare/access/application/)) Continue pinning the standing `2.0.0-beta.62`; that version is confirmed by the official package source. ([Alchemy package source](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/package.json#L1-L4))

### 5. Migrations and recovery remain mandatory

There are still two independent migration layers:

1. **Durable Object class lifecycle.** Cloudflare class deletion permanently removes the namespace and all stored data; its current declarative lifecycle flow supports create, delete, rename, and transfer, while legacy migrations remain supported. ([Cloudflare Durable Object class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/))
2. **SQLite application schema.** Each Catalog or Project instance owns a private database and initializes lazily when accessed, so ordered in-object migrations remain necessary even with fewer tables. ([Durable Object namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/), [Cloudflare migration guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/#initialize-storage-and-run-migrations-in-the-constructor))

SQLite-backed objects support PITR of the entire per-object SQL and KV database to a point within the preceding 30 days; PITR is unavailable in local development. Cloudflare also contrasts Durable Objects with D1 by noting that Durable Object users may need to build database tooling that D1 supplies, including import/export tooling. ([Cloudflare PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api), [Cloudflare: Durable Objects versus D1](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/#sql-in-durable-objects-vs-d1))

Thus the recovery policy remains:

- use PITR for routine recovery inside its 30-day window;
- test Catalog and Project restoration separately;
- before a destructive schema operation or class lifecycle plan, quiesce the affected object's writes, create a versioned logical export in the retained recovery bucket, and verify that artifact before proceeding;
- do not add scheduled long-term exports for the personal MVP;
- accept that loss discovered outside the PITR window may be unrecoverable.

The only simplification is export content: omit replay logs, sequence allocation state, and durable cursor records because they no longer exist.

## Final topology decision

Adopt the following amendment to the resolution in issue #16:

> Overseer retains one SQLite Catalog Durable Object, one SQLite Project Durable Object per Project, one Access-protected HTTP Gateway Worker, private attachment and retained recovery R2 buckets, Alchemy-owned deployment/class lifecycle, in-object SQLite migrations, 30-day PITR, and verified pre-destructive exports. The MVP has no WebSocket route or handlers, no public Project change-record stream, no replay sequence maintained solely for transport, and no durable sync cursors. Project objects expose narrow typed RPC plus a native alarm. Attachment reconciliation uses that single native alarm to trigger an idempotent scan of authoritative attachment rows; Alchemy's scheduled-event table is not used. No replacement realtime or synchronization infrastructure is introduced.

This is a runtime simplification, not a repartitioning of authoritative state.

## Primary sources

### Cloudflare

- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Durable Object namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [SQLite-backed Durable Object storage and PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Access Durable Objects storage / comparison with D1](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Object class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
- [R2 public/private bucket access](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

### Alchemy v2 official docs and source

- [Durable Objects guide](https://v2.alchemy.run/cloudflare/compute/durable-objects/)
- [`2.0.0-beta.62` package](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/package.json#L1-L4)
- [Scheduled-events implementation](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/ScheduledEvents.ts)
- [Worker Durable Object lifecycle implementation](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Workers/WorkerProvider.ts#L1714-L1839)
- [Removal policy implementation](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/RemovalPolicy.ts)
- [Access Application resource](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Access/Application.ts)
- [Access ServiceToken resource](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts)
- [R2 Bucket resource](https://github.com/alchemy-run/alchemy/blob/a5a22a0ce1c960771f176c4653cc5dc2a0c4d7a0/packages/alchemy/src/Cloudflare/R2/Bucket.ts)
