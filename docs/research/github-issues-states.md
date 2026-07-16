# GitHub Issues states and reference behavior

Research for [#11](https://github.com/dmmulroy/overseer/issues/11), in the context of the agent-first MVP map in [#10](https://github.com/dmmulroy/overseer/issues/10).

## Executive answer

GitHub's useful core is smaller than its feature surface: an issue has a stable repository-local number, open/closed lifecycle, Markdown body, comments, labels, assignees, a chronological activity stream, one parent with nested children, directed dependencies, and references that become links and backlinks. The core UI makes current state, hierarchy, blockers, and history visible together.

Overseer should copy those information properties, not GitHub's full state machine. For the MVP:

- keep only `open` and `closed`, plus a separate soft-deleted tombstone;
- make the optional free-form assignee a single cooperative claim and labels project-scoped conventions;
- support one same-project parent and directed same-project blocking edges, reject cycles, and derive inverse edges and progress;
- resolve `#123` within the current project and absolute Overseer issue URLs across projects; create reciprocal timeline references for resolved internal links, while leaving ordinary external URLs as links only;
- retain an ordered timeline of comments and structured changes, stable actor/time metadata, and optimistic versions;
- expose attachments as first-party resources referenced from Markdown; and
- return explicit, machine-readable errors. Never silently drop requested metadata as GitHub's API sometimes does.

Defer closure reasons, multiple assignees, issue types, milestones, subscriptions, reactions, locks, pins, transfer, dependency ordering, revision-diff UI, custom autolinks, and a graph canvas. These omissions do not impair the planned agent workflow.

## Observed GitHub behavior

### 1. Issue and UI states

GitHub's primary issue lifecycle is `open` or `closed`. A closed issue also carries a reason: the REST schema currently allows `completed`, `not_planned`, or `duplicate`; reopening is represented by `reopened` in `state_reason` and by a timeline event. The web UI lets the closer select a reason, and search can distinguish completed from not-planned closures. [[REST issues](https://docs.github.com/en/rest/issues/issues#get-an-issue)] [[Closing an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/closing-an-issue)] [[Filtering issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests#about-search-terms)]

Several orthogonal flags can alter presentation without being lifecycle states:

- `locked` and `active_lock_reason` govern participation;
- labels, assignees, milestone, and issue type describe or route work;
- parent, sub-issue progress, and dependency summaries describe graph position; and
- repository-level conditions such as archived/disabled or lost visibility can make an issue effectively read-only or unavailable.

The current REST issue representation exposes these independently rather than flattening them into one workflow status. It also exposes `sub_issues_summary`, `parent_issue_url`, and `issue_dependencies_summary`. [[REST issue schema](https://docs.github.com/en/rest/issues/issues#get-an-issue)]

GitHub's hierarchy UI shows a parent link beneath a child's title, an expandable child tree, and completion counts/percentages. Dependencies appear in a **Relationships** sidebar, while blocked issues receive a blocked icon in issue lists and project boards. [[Browsing sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/browsing-sub-issues)] [[Creating dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)]

### 2. Timeline and event model

GitHub has two similarly named REST resources. The issue-events endpoint reports structured activity; the timeline endpoint is the richer read model and additionally includes comments and incoming cross-references. Agents reconstructing the visible conversation should use the timeline, not assume the issue-events endpoint is complete. Both are paginated. [[Issue events](https://docs.github.com/en/rest/issues/events)] [[Timeline events](https://docs.github.com/en/rest/issues/timeline)]

Issue-relevant timeline activity includes:

| Area | GitHub events/data |
|---|---|
| Conversation | `commented` with stable comment ID, body, author, created/updated times; comment-deleted and pin/unpin activity |
| Lifecycle | `closed`, `reopened`, `marked_as_duplicate`, `unmarked_as_duplicate`, `converted_to_discussion` |
| Content | `renamed`; body/comment edits are revision history rather than ordinary timeline rows |
| Classification | `labeled`, `unlabeled`, issue-type changes, `milestoned`, `demilestoned` |
| Ownership | `assigned`, `unassigned` |
| Graph | parent/sub-issue added/removed; blocked-by/blocking added/removed |
| References | incoming `cross-referenced`; commit `referenced`; PR connection/disconnection |
| Moderation/attention | locked/unlocked, pinned/unpinned, subscribed/unsubscribed |
| Location | `transferred` |

The canonical event-type reference documents the common stable event ID, actor, timestamp, event discriminator, and event-specific payloads. The timeline schema adds parent/sub-issue and both dependency-direction payloads. [[Issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types)] [[Timeline schema](https://docs.github.com/en/rest/issues/timeline#list-timeline-events-for-an-issue)]

Two robustness details matter to agents: event schemas can permit a null actor or null related-issue payload, and GitHub's Issues APIs may return pull requests because every pull request is also an issue. Consumers must discriminate by event type and resource shape rather than assuming every row has one uniform schema. [[Issue events schema](https://docs.github.com/en/rest/issues/events#list-issue-events)] [[Issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types)]

**Direct observation (2026-07-16).** The public REST representation of this ticket reported an open issue with parent #10, zero children, and two outgoing blocking relationships. Its timeline returned `labeled`, `parent_issue_added`, two `blocking_added`, and—after the required claim—`assigned`. The other perspectives received counterpart events: #10 has `sub_issue_added`, while #18 and #23 have `blocked_by_added`. This confirms that current relation summaries and perspective-specific relation events are visible independently. [[Issue JSON](https://api.github.com/repos/dmmulroy/overseer/issues/11)] [[#11 timeline](https://api.github.com/repos/dmmulroy/overseer/issues/11/timeline)] [[#10 timeline](https://api.github.com/repos/dmmulroy/overseer/issues/10/timeline)] [[#18 timeline](https://api.github.com/repos/dmmulroy/overseer/issues/18/timeline)]

### 3. Editing and comments

A title change creates a timeline entry. Issue descriptions and comments instead have edit histories. Anyone with repository read access can inspect comment revisions; the author or someone with write access can remove a revision's content, while the editor and edit time remain visible. GitHub applies the same history behavior to issue descriptions. [[Editing an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue)] [[Tracking comment changes](https://docs.github.com/en/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment)]

The REST comment model exposes the current Markdown body, stable ID, author, `created_at`, `updated_at`, and optional rendered text/HTML. Comments are listed in ascending ID order and can be created, updated, and hard-deleted; deletion returns `204 No Content`. The REST contract does not expose revision bodies through these endpoints. Deleting a comment creates a visible timeline event, but the deleter is anonymized for readers without write access; the issue's initial body cannot be deleted independently. [[Issue comments](https://docs.github.com/en/rest/issues/comments)] [[Managing disruptive comments](https://docs.github.com/en/communities/moderating-comments-and-conversations/managing-disruptive-comments#deleting-a-comment)]

This yields three distinct concepts worth preserving: the immutable position/identity of a conversation item, its mutable current content, and its revision/audit metadata. GitHub preserves a deletion event, not the deleted comment as an ordinary readable resource.

### 4. Labels and assignees

Labels are repository-scoped resources. They may be used only within their repository; changing or deleting a same-named label in another repository has no effect. Deleting a label removes it from issues and pull requests. Applying/removing a label creates corresponding timeline activity. [[Managing labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels)] [[Issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types#labeled)]

GitHub supports up to ten assignees. Eligible assignees include the caller, commenters, users with write access, and organization members with read access. Assignment changes also produce timeline events. [[Assigning issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/assigning-issues-and-pull-requests-to-other-github-users)] [[Assignee API](https://docs.github.com/en/rest/issues/assignees)]

There are agent-facing mutation traps:

- `PATCH`ing an issue's `labels` or `assignees` replaces the whole set, while dedicated endpoints add/remove incrementally;
- setting labels, assignees, milestones, fields, or type without sufficient permission can be silently ignored on create/update; and
- the assignee-check endpoint deliberately uses `404` for an ineligible user.

These behaviors are explicitly documented in the issue and assignee endpoints. [[Update an issue](https://docs.github.com/en/rest/issues/issues#update-an-issue)] [[Add assignees](https://docs.github.com/en/rest/issues/assignees#add-assignees-to-an-issue)]

### 5. Parent/sub-issues and dependencies

GitHub gives an issue at most one parent. A parent can have up to 100 direct sub-issues, and nesting can reach eight levels. Existing children may come from another repository, while the REST add endpoint constrains a child to the same repository owner as the parent. Children are ordered and can be reprioritized. Reparenting is explicit via `replace_parent`. [[Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)] [[Sub-issue API](https://docs.github.com/en/rest/issues/sub-issues)]

Dependencies are directed and exposed from both views: issues this issue is `blocked_by`, and issues this issue is `blocking`. Add/remove mutations operate on the blocked-by edge; the inverse is a derived view. The UI and CLI display both directions. [[Dependency API](https://docs.github.com/en/rest/issues/issue-dependencies)] [[Creating dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)]

GitHub's public docs enumerate validation failures but do not state a complete cycle policy for either graph. Overseer should therefore treat cycle rejection as its own domain invariant, not as a claim about GitHub.

### 6. Issue references, cross-references, and URLs

Within GitHub conversations, these forms become issue links:

- `#26` and `GH-26` resolve in the current repository;
- `owner/repository#26` resolves across repositories; and
- a full GitHub issue/PR URL resolves to that target.

A reference in a list unfurls title and state. The shorthand is contextual: files and wikis do not receive issue autolinks. Ordinary standard URLs become links. Issue numbers remain repository-local even when GitHub Projects aggregate issues from multiple repositories; Projects do not add a separate project-local issue-number namespace. [[Autolinked references and URLs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls)] [[About Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)]

A person/team `@mention` is different: it identifies and may notify an eligible GitHub user/team, rather than creating an issue-to-issue edge. [[Mentioning people and teams](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#mentioning-people-and-teams)]

By default, a GitHub issue/PR reference also generates a backlink on the target. The timeline represents that target-side row as `cross-referenced` with the source issue/PR. GitHub documents `redirect.github.com` as an escape hatch that suppresses the backlink, showing that link rendering and reciprocal reference creation are related but separable behaviors. Only cross-references originating from issues or pull requests are returned as timeline cross-reference events; an arbitrary external URL has no reciprocal GitHub timeline. [[Autolink backlink behavior](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls#avoiding-backlinks-to-linked-references)] [[Cross-referenced event](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types#cross-referenced)]

**Direct observation.** The body of [`github/docs#1096`](https://github.com/github/docs/issues/1096) references #1000. The [target #1000 timeline](https://api.github.com/repos/github/docs/issues/1000/timeline) contains a `cross-referenced` row whose source is #1096; the source retains its body link but does not receive a mirrored `cross-referenced` row. GitHub is navigable in both directions, but the event itself is target-side.

GitHub's docs do not fully specify backlink deduplication or what happens to historical backlink rows after the source text is edited/deleted. Those details should not become accidental Overseer semantics; ticket #18 should define reconciliation and history explicitly.

### 7. Deleted, transferred, unavailable, and missing actors

GitHub issue deletion is permanent and permission-restricted, not soft deletion. A normal viewer visiting the deleted URL sees not found; admins can additionally see who deleted it and when. The REST get endpoint is more precise when authorized:

- `301 Moved Permanently` for a transfer;
- `410 Gone` when the issue was deleted from a repository the caller can read; and
- `404 Not Found` when the issue was transferred to or deleted from a repository the caller cannot read.

The deliberate `404` ambiguity avoids disclosing private resources. [[Deleting an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/deleting-an-issue)] [[Get an issue](https://docs.github.com/en/rest/issues/issues#get-an-issue)]

Transfers retain comments and assignees, conditionally retain labels/milestones that match in the destination, redirect the old URL, and show an inaccessible-transfer banner to viewers lacking destination access. Transfers are limited to repositories under the same owner, and only open issues can transfer. [[Transferring an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/transferring-an-issue-to-another-repository)]

If a GitHub account is deleted, its issues/comments in repositories owned by others remain but become associated with the `ghost` user. Consumers therefore cannot assume every historical actor is still a live assignable identity. [[Personal account management](https://docs.github.com/en/account-and-profile/concepts/account-management#about-deletion-of-your-personal-account)]

### 8. Attachments

In the GitHub UI, selecting an attachment uploads it immediately and inserts an anonymized URL into the Markdown field. Public-repository uploads are publicly readable; private/internal-repository uploads require repository access. Limits are currently 10 MB for images/GIFs, 10 or 100 MB for video depending on plan, and 25 MB for other supported files. GitHub restricts uploads to an explicit extension list. [[Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)]

The important model is not the exact limits: upload identity/access/lifecycle is separate from the issue or comment Markdown that references the resulting URL. Upload-before-save also means an implementation must decide how to clean up abandoned uploads.

### 9. Errors and operational behavior relevant to agents

| GitHub behavior | Agent consequence |
|---|---|
| Private or inaccessible resources commonly return `404`, not `403` | Do not conclude that a resource never existed from `404` alone. |
| Deleted readable issues return `410`; transfers return `301` | Preserve distinct gone/moved handling where the domain supports it. |
| Malformed JSON returns `400`; invalid fields generally return `422` with error codes | Parse structured errors, not human message strings. |
| Some issue mutations silently drop unauthorized metadata | Re-read after mutation if exact state matters. |
| Primary/secondary limits return `403` or `429` | Honor `retry-after`, `x-ratelimit-reset`, then back off exponentially. |
| List endpoints default to the first 30 items | Follow pagination; never treat one page as complete. |
| Issue/comment/dependency creation may trigger secondary limiting | Avoid blind tight retries that can duplicate content. |
| Documented endpoints can return `503` | Classify as retryable, bounded by a client retry policy. |

GitHub documents these response and retry rules in its REST troubleshooting, issue, comment, sub-issue, and dependency references. [[REST troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)] [[Pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)]

The documented issue/comment `PATCH` contracts do not include an expected-version parameter, and GitHub says conditional requests for unsafe methods are unsupported unless a specific endpoint documents otherwise. That is an observation about the public contract, not a recommendation: Overseer's map already requires optimistic concurrency and should improve on this behavior. [[Update an issue](https://docs.github.com/en/rest/issues/issues#update-an-issue)] [[Update a comment](https://docs.github.com/en/rest/issues/comments#update-an-issue-comment)] [[REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate)]

## Recommendation for Overseer's smaller MVP

### Domain and visible state

Use one canonical issue record with stable `(project_id, number)` and never reuse a number.

- `state`: `open | closed` only.
- `deleted_at`/`deleted_by`: separate soft-deletion metadata, not a third workflow state.
- `title`, Markdown `body`, creator, created/updated timestamps, and monotonic `version`.
- zero or more project-scoped labels.
- one optional free-form `assignee` string, interpreted as a cooperative claim.
- at most one same-project parent; child list is derived.
- directed same-project `blocked_by` edges; `blocking` is derived.

Render a deleted issue as an authorized tombstone that preserves number, relation/reference integrity, actor/time metadata, and timeline position. Exclude it from normal lists by default. Reject ordinary edits/comments/graph mutations against it with a specific gone/deleted error. Whether restore is allowed must be explicit in #15; number reuse and physical deletion should remain out of scope.

### Timeline and revisions

The detail page and API should expose one cursor-paginated chronological stream containing:

- comments (stable ID, author/session metadata, created/updated time, version, deletion marker);
- issue created, title/body edited, opened/closed, soft-deleted/restored if supported;
- label added/removed and assignee claimed/released/reassigned;
- parent and blocker edge added/removed; and
- incoming and outgoing internal-reference events.

Store enough immutable event metadata to explain who changed what and when. For the MVP, expose current text plus edit markers and versions; a GitHub-style revision-diff viewer and revision redaction UI can wait. Soft-delete comments into tombstones rather than removing a timeline position. Sensitive hard purge is a later administrative concern.

### Mentions and references

Use a deliberately small grammar:

1. `#123` resolves only within the issue's project.
2. An absolute Overseer issue URL resolves across projects/workspaces after authorization.
3. Other valid `http(s)` URLs remain external links.

Do not add rename-sensitive `project#123` shorthand, custom autolinks, commit references, or notification-producing `@mentions` yet. On saving an issue body or comment, parse references server-side, resolve authorized internal targets by stable ID, and atomically reconcile a deduplicated source-to-target reference set. Show the source link in its own Markdown and an incoming cross-reference on the target timeline. Define in #18 whether removing source text removes only the live edge while retaining historical events; do not inherit GitHub's undocumented edge cases.

For unresolved, deleted, or newly inaccessible targets, preserve the literal Markdown and return/render an explicit unresolved or unavailable reference rather than failing the entire write or leaking hidden metadata.

### Graph UI

The minimal detail view needs:

- parent breadcrumb;
- compact child list with open/total progress;
- separate **Blocked by** and **Blocking** lists with target state;
- a derived blocked indicator when unresolved blockers exist; and
- add/remove controls with actionable validation failures.

The issue list only needs parent/blocked indicators and structured filters. Omit a graph canvas, drag ordering, eight-level tree browser, project board, and cross-project graph edges. Reject self-links, duplicate edges, a second parent, and cycles transactionally; return the discovered cycle path when practical.

Closing an issue should not silently remove graph edges. Progress and unresolved-blocker counts are derived from current issue state, so agents can distinguish completion from relationship removal.

### Labels, claims, and comments

Keep label resources project-scoped and free-form. Preserve add/remove operations rather than a replacement-only API, and emit timeline changes. Well-known Wayfinder labels are seed conventions, not enum variants.

Keep the map's single free-form assignee instead of GitHub's ten identity-bound assignees. Claim/release/reassign must be explicit compare-and-set operations so two agents cannot both believe they claimed the issue. Return the current claimant on conflict.

Comments need create/edit/soft-delete, Markdown, stable IDs, optimistic versions, and optional harness-generic actor/session metadata. Omit reactions, pinning, minimization, locking, subscriptions, and notifications.

### Attachments

Model an attachment as a first-party resource with owner/workspace, content type, size, checksum, storage key, lifecycle state, and access-controlled download URL. Markdown references attachment IDs/URLs; authorization must not depend on obscurity. Define size/type limits, upload-finalization, abandoned-upload cleanup, and deleted-reference retention in #21. GitHub's plan-dependent limits need not be copied.

### Agent-facing API errors

Use one error envelope with stable `code`, human `message`, field/relation details, request ID, and retry metadata. At minimum distinguish:

- `unauthenticated` (`401`) and `forbidden` (`403`);
- `not_found` (`404`) and `deleted`/`gone` (`410`) where disclosure is safe;
- `version_conflict`, `claim_conflict`, and duplicate idempotency conflict (`409`);
- `validation_failed`, `cycle_detected`, `invalid_parent`, `invalid_reference`, `unsupported_attachment_type`, and `attachment_too_large` (`422` or a consistently documented alternative);
- `rate_limited` (`429` with retry delay); and
- transient `unavailable` (`503`).

Every successful mutation must return the authoritative new resource/version. Never silently ignore requested labels, claims, or graph edges. Support an idempotency key for create/comment/upload-finalization operations and an expected version (`If-Match` or explicit version) for mutable records. A conflict response should include the current version and enough state for an agent to re-read, merge, and retry.

## MVP inclusion boundary

| Include now | Explicitly omit/defer |
|---|---|
| Open/closed and soft-deleted tombstone | Completed/not-planned/duplicate reasons |
| Markdown issue/body comments and edit markers | Full revision-diff/redaction UI |
| Project labels and one free-form claim | Multiple identity-bound assignees, issue types, milestones |
| One parent, child progress, directed blockers, cycle rejection | Ordering, cross-project graph, graph canvas |
| Same-project `#N`, absolute internal URLs, reciprocal references, external URLs | Custom autolinks, commit/PR semantics, `@mention` notifications |
| First-party attachment resources | GitHub's complete extension/plan matrix |
| Structured timeline, pagination, versions, idempotency | Reactions, locks, pins, subscriptions, transfers, discussion conversion |
| Explicit structured errors | Silent metadata drops and ambiguous success |

This boundary preserves the agent-critical properties—stable addressing, claim coordination, dependency traversal, context history, retry safety, and human inspectability—without reproducing GitHub's long tail.
