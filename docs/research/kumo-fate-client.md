# Kumo and Fate for Overseer's React client

**Status:** recommendation

**Researched:** 2026-07-16

**Question:** Can Kumo and Fate support Overseer's issue-list/detail SPA, typed routes and data, Markdown/uploads, optimistic concurrency, realtime reconnect, and accessible responsive UI simply enough for the MVP?

## Decision

**Adopt Kumo and TanStack Router. Keep Fate as a bounded experiment, not an MVP dependency.**

- **Kumo** is a good default for visual primitives and a useful source-owned starting point for page layouts. It covers the controls, feedback, semantic tables, and responsive layout pieces this SPA needs, but it is not an issue UI, Markdown system, uploader, data client, or accessibility guarantee.
- **TanStack Router** should own URLs, typed path/search parameters, navigation, route loading boundaries, and coordination with whichever data client is selected. Fate does not route.
- **The MVP client sync module** should initially own the typed REST client, version/precondition headers, actionable conflict results, optimistic state, upload requests, SSE lifecycle, reconnect repair, and cache/list reconciliation.
- **Fate** should receive one time-boxed issue-list/detail spike behind a removable composition boundary. It has unusually relevant normalized-cache, optimistic-mutation, and live-view features, including a Cloudflare Durable Object adapter, but its official documentation still says it is alpha and not production ready. More importantly, adopting it would add a second Fate-specific protocol and server data-view model beside Overseer's agent-facing REST API.

This split does not preclude promoting Fate later. It makes Fate earn ownership of server state without coupling routing, UI, uploads, or the public REST contract to the experiment.

## What the libraries actually own

### Kumo

Kumo is Cloudflare's React component library. Its maintained package components are content-agnostic primitives; its CLI-installed “blocks” are copied into the application and become application-owned code ([components vs. blocks](https://kumo-ui.com/components-vs-blocks.md)). Version 2.8.0 supports React 18 and 19, can be imported granularly, provides standalone or Tailwind v4 styles, and re-exports Base UI primitives ([installation](https://kumo-ui.com/installation/); [package manifest at the researched revision](https://github.com/cloudflare/kumo/blob/ff8ad54101b21181e2344a5a2232aa2fce741deb/packages/kumo/package.json)).

That scope is appropriate: Overseer should compose issue-specific screens from Kumo rather than expect Kumo to understand issues.

### Fate

Fate is a **typed server-data client/framework**, not a router or component library. Its model is Relay-like: components declare composable field selections (“views”); requests fetch by ID, lists, or roots; returned entities are data-masked and stored in a normalized `__typename:id` cache ([core concepts](https://fate.technology/guide/core-concepts); [requests](https://fate.technology/guide/requests); [server conventions](https://fate.technology/integrations/server)). Its Vite plugin generates a typed client from a server module, and its native protocol, tRPC adapter, or GraphQL transport supplies data ([server integration](https://fate.technology/integrations/server)).

The current package is 1.3.2 and requires React 19.2+, while the official getting-started page explicitly warns that Fate is “currently in alpha and not production ready” ([package manifest](https://github.com/nkzw-tech/fate/blob/874075163bace33d2f2163be461b06260c388aff/packages/react-fate/package.json); [getting started](https://fate.technology/guide/getting-started)). Treat the warning—not the major version—as the maturity signal.

### TanStack Router overlap

TanStack Router owns route matching, nested layouts, typed navigation, typed and validated path/search parameters, route loaders, pending/error boundaries, preloading, and a small SWR route cache ([overview](https://tanstack.com/router/latest/docs/framework/react/overview); [type safety](https://tanstack.com/router/latest/docs/framework/react/guide/type-safety); [data loading](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading)). It intentionally coordinates external data stores that can return promises ([external data loading](https://tanstack.com/router/latest/docs/framework/react/guide/external-data-loading)).

The overlap is therefore only **screen data loading and caching**:

- Router knows the destination before render and can preload critical data.
- Fate knows entity identity, selected fields, shared records, mutations, and live subscriptions.
- Router's cache is route-keyed, has coarse invalidation, and has no built-in mutation or cache-level optimistic API ([router cache tradeoffs](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#to-router-cache-or-not-to-router-cache)).
- Fate has no URL matching/navigation/search-param responsibility.

They are complementary, not substitutes. A Fate spike should be called from or coordinated by TanStack route loaders; it should not invent a second routing layer.

## Requirement assessment

| MVP need | Assessment | Ownership / gap |
|---|---|---|
| Issue list and detail SPA | **Yes.** Kumo has semantic tables, badges, inputs, empty/loading states, pagination, surfaces, dialogs, banners, and a responsive Resource List block. Fate can request lists, records by ID, nested relations, and cursor connections. | Router owns `/projects/$projectId/issues` and `/projects/$projectId/issues/$issueNumber`; app code owns the issue/timeline composition. The Resource List block is copied code, not a maintained issue screen ([block docs](https://kumo-ui.com/blocks/resource-list.md)). |
| Typed routes and filters | **Yes with TanStack Router.** Route paths, params, navigation, and validated JSON-first search params are inferred and typed ([search params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params); [navigation](https://tanstack.com/router/latest/docs/framework/react/guide/navigation)). | Fate does not help here. Model list filters, sort, cursor, open/closed state, labels, and assignee in route search schemas and pass only data-relevant values through `loaderDeps`. |
| Typed data access | **Yes, but Fate is not a generic REST client.** Fate gives typed views, roots, mutations, masking, and normalized records. | Fate expects `byId`/list/root conventions and either its native endpoint, tRPC, or GraphQL. Overseer's public REST API would remain separate, so full adoption duplicates transport/server integration. Keep the REST contract authoritative. |
| Markdown body/comments | **Partly.** Kumo `InputArea` supplies an accessible multiline editor shell, labels, errors, and auto-resize ([InputArea](https://kumo-ui.com/components/input-area.md)). React supports controlled textareas and demonstrates a Markdown preview composition ([React textarea](https://react.dev/reference/react-dom/components/textarea)). | Neither library parses, sanitizes, previews, or renders Markdown. The application must select and configure that pipeline and preserve semantic output. |
| First-party file uploads | **Not through Fate.** React supports file inputs and `FormData`; form data can be sent directly as a fetch body ([React input](https://react.dev/reference/react-dom/components/input); [React form](https://react.dev/reference/react-dom/components/form)). Kumo has no dedicated upload component. | Use a native labeled `<input type="file">` styled/composed with Kumo and a dedicated REST upload endpoint. Fate's native HTTP mutation transport JSON-stringifies operations and sends `application/json`, so `File`/`FormData` is not an upload path ([transport source](https://github.com/nkzw-tech/fate/blob/874075163bace33d2f2163be461b06260c388aff/packages/fate/src/httpTransport.ts#L300-L326)). Insert the returned attachment URL into Markdown separately. |
| Optimistic mutation | **Yes in Fate or React.** Fate applies normalized optimistic records/inserts, reconciles temporary IDs, and rolls back records and lists on failure ([Fate actions](https://fate.technology/guide/actions)). React's `useOptimistic` provides temporary state and falls back to the base value when an Action fails ([React `useOptimistic`](https://react.dev/reference/react/useOptimistic)). | Optimism is presentation, not concurrency control. The app/API still owns expected version, precondition, canonical result, and retry semantics. |
| Actionable conflict state | **Gap in Fate's native protocol.** Fate treats HTTP 409 and 412 as call-site mutation errors in its client implementation ([classification source](https://github.com/nkzw-tech/fate/blob/874075163bace33d2f2163be461b06260c388aff/packages/fate/src/mutation.ts#L329-L363)), but the native per-operation error envelope exposes only a small code/message/issues shape with no `CONFLICT`, server version, or canonical entity ([protocol source](https://github.com/nkzw-tech/fate/blob/874075163bace33d2f2163be461b06260c388aff/packages/fate/src/protocol.ts#L136-L219)). | Keep conflict handling in the typed REST client. On conflict: roll back optimism, retain “your changes,” show current server state/version, and offer reload/reapply/cancel. Do not encode conflict as a generic thrown error or force it through Fate until a spike proves a typed conflict envelope end to end. |
| Realtime entity/list updates | **Promising in Fate.** `useLiveView` and `useLiveListView` merge entity and connection events into the same normalized cache over one SSE stream; list events can append/prepend/delete/invalidate ([live views](https://fate.technology/guide/live-views)). | Every write path must publish the correct entity fields and affected filtered connections. This is application integration work, not automatic change capture. |
| Reconnect and missed updates | **Reconnect yes; catch-up no by default.** Fate resubscribes with the last event ID, but its in-memory bus does not replay. The Cloudflare adapter uses a Durable Object for connections/topics but explicitly provides at-most-once delivery and no durable replay ([live views](https://fate.technology/guide/live-views#emitting-events); [Cloudflare semantics](https://fate.technology/integrations/cloudflare#semantics)). | On every reconnect, authoritatively refetch/invalidate active issue and list data, or add application-owned replay storage. Fate exposes `onLiveError` but no documented React connection-status hook, so an accessible offline/reconnecting indicator remains app-owned. |
| Accessible responsive UI | **Good foundation, not automatic conformance.** Kumo/Base UI handles many roles, ARIA attributes, pointer/keyboard interaction, and focus behavior, while its docs explicitly leave accessible names, focus appearance, and contrast/application testing to developers ([accessibility](https://kumo-ui.com/accessibility.md)). Grid variants collapse across breakpoints, Table uses semantic elements, and wide tables require an overflow strategy ([Grid](https://kumo-ui.com/components/grid.md); [Table](https://kumo-ui.com/components/table.md)). | App code owns landmarks, heading order, route-change focus, live-region announcements, conflict/reconnect messaging, touch targets, responsive information hierarchy, and end-to-end keyboard/screen-reader testing. Prefer a stacked issue list on narrow screens over merely shrinking a desktop table. |

## Fate fit for Overseer's model

Fate's happy path maps well to the read side:

- `IssueSummaryView` can back filtered/paginated project issue lists.
- `IssueDetailView` can compose labels, parent/blocking references, assignee, and counts.
- A cursor connection can represent the issue timeline and support live prepend/append/invalidation.
- Normalization can keep list summaries and open detail records coherent.
- A route loader can call Fate's promise API before rendering, while components use masked views; TanStack Router is explicitly designed to coordinate external caches.

The costs are material:

1. **Parallel protocol.** The MVP already needs a stable REST API for agents. Fate's native endpoint is selection-driven JSON RPC, not that API. Supporting both means duplicate boundary contracts and likely duplicate query/mutation wiring.
2. **Server coupling.** The Vite plugin reads the server module; Fate requires data views, roots, entity IDs, list conventions, and mutation resolvers. Its Prisma/Drizzle adapters do not directly match an Effect service over project-scoped Durable Objects, so Overseer would need custom source/resolver integration.
3. **Uploads bypass it.** Native Fate requests are JSON. Uploads remain REST/multipart regardless.
4. **Conflict semantics are weaker than the MVP requirement.** Automatic rollback is useful, but a version conflict is a successful domain-level refusal requiring structured recovery data, not merely a failed request.
5. **Realtime is at-most-once.** `cf-fate` is impressively close to Overseer's platform, but it adds its own live Durable Object and requires `nodejs_compat`; it does not remove the need for reconnect repair or replay decisions ([Cloudflare integration](https://fate.technology/integrations/cloudflare)).
6. **Maturity.** The explicit alpha warning, React 19.2 floor, fast-moving generated integration, and broad server/runtime surface make Fate the highest-churn part of this proposed client.

None of these invalidate Fate's design. They argue against making an alpha experiment the only path to Overseer's public API and concurrency guarantees.

## Smallest recommended ownership split

### Commit now

1. **TanStack Router — navigation and route lifecycle**
   - Typed list/detail paths and URL-backed structured filters.
   - Loader orchestration, cancellation, preload, pending/not-found/error boundaries.
   - No entity mutation or realtime logic in route files.

2. **Kumo — maintained visual primitives**
   - Inputs, `InputArea`, buttons, badges, dialogs, banners, toasts, tables, surfaces, grid/sidebar primitives.
   - Copy the Resource List block only if it saves work, then treat it as application code.
   - Bridge Kumo's `LinkProvider` to TanStack Router rather than leaking router imports through all visual components ([Kumo Link integration](https://kumo-ui.com/components/link.md#framework-integration-linkprovider)).

3. **Application client/sync module — server-state policy**
   - Generated or schema-derived typed REST calls.
   - Entity/list cache sufficient for issue summary/detail/timeline coherence.
   - Version token/precondition on every concurrent edit.
   - A discriminated conflict result containing current server data/version and the attempted edit.
   - Optimistic overlays and rollback; React Actions/`useOptimistic` are sufficient initially.
   - One SSE connection, connection state, reconnect backoff, active-query invalidation/refetch, and optional replay cursor.
   - Separate `FormData` upload flow.

4. **Application feature/UI code — product semantics**
   - Issue list/detail/timeline composition, Markdown editor/preview/rendering, upload affordance, conflict resolution panel, and reconnect banner.
   - Accessibility and responsive behavior at the page level.

### Time-box the Fate experiment

Build no product dependency on the outcome. In a spike branch or feature-flagged adapter:

1. Expose a removable `/fate` read endpoint over the same domain services—not a second source of truth.
2. Implement only project issue list, issue detail, and one timeline page with composable views.
3. Preload through TanStack Router; keep route definitions unchanged if Fate is removed.
4. Exercise one optimistic edit that deliberately receives a stale-version conflict. Require a typed, actionable conflict state without corrupting Fate's entity cache.
5. Exercise `cf-fate` disconnect/reconnect and prove an authoritative refetch repairs a missed issue update and a missed filtered-list membership change.
6. Keep uploads on REST and verify they compose cleanly with the editor.

**Promotion gate:** Fate may take ownership of normalized reads, mutations, and live cache updates only if the spike (a) reuses domain services without compromising REST, (b) represents conflict recovery cleanly, (c) repairs missed events deterministically, (d) has acceptable Worker/DO operational cost, and (e) materially removes more client code than its server/codegen integration adds. Otherwise delete the adapter and retain the baseline split.

## Bottom line

Kumo can comfortably support the visual shell, provided Overseer owns issue-specific composition and accessibility validation. TanStack Router is the clear route owner. Fate is technically capable of the read model, optimistic cache updates, and live entity/list updates, and its Cloudflare adapter makes it worth a real experiment. It is not yet the simplest safe foundation for uploads, optimistic-concurrency conflicts, reconnect correctness, or an agent-first REST architecture. Keep those policies in an application-owned typed sync boundary and let a bounded Fate spike prove whether it should replace that boundary later.
