# Overseer

Overseer is a personal issue tracker built from generic work-tracking primitives that agents and humans can compose into workflows such as Wayfinder.

## Language

**Entity ID**:
An immutable, globally unique identity for an independently addressable Workspace, Project, Issue, Label, Comment, Attachment, or structured Timeline event. Display names never serve as identity; relation and value records do not receive IDs.

**Workspace**:
The top-level organizational container for projects, with a required non-empty mutable name and no other intrinsic metadata in the MVP. Its name need not be unique. It can be archived and later restored.
_Avoid_: Organization, tenant

**Project**:
A container that belongs to exactly one workspace at a time and may move atomically between workspaces with its identity and all owned content unchanged. It owns issues and a stable, project-local issue number space, and has a required non-empty mutable name with no other intrinsic metadata in the MVP. Its name need not be unique. It can be archived and later restored. A project is not inherently a board or workflow.
_Avoid_: Repository, board

**Archive**:
A reversible state of a Workspace or Project. An archived container and all of its descendants are read-only and absent from default listings, without changing descendant states. Content must be restored before it can be moved out.

**Issue**:
A unit of tracked work permanently owned by exactly one project, with a required non-empty title and optional Markdown body. It is identified for display by an immutable project-local number assigned atomically from that Project's monotonic counter, and is independently either open or closed. Numbering starts at 1, may contain gaps, is never reused, and is unaffected by moving or archiving the Project. Closing never cascades and is allowed despite open sub-issues or blockers. It can be soft-deleted into a reversible, read-only tombstone without freeing its number or changing its open/closed state. Deletion does not delete its sub-issues; a deleted Issue and its Comments are absent from default views.
_Avoid_: Ticket, card, task

**Parent issue**:
The optional same-project issue that groups an issue as one of its sub-issues. An issue has at most one parent. Hierarchy rejects self-links, duplicate links, and cycles.
_Avoid_: Epic

**Sub-issue**:
An issue grouped beneath a parent issue in an explicit user-controlled order. Order belongs to the parent relation and survives deletion and restoration. While its parent is deleted, the sub-issue behaves as a root Issue without losing that preserved relationship.
_Avoid_: Child ticket

**Blocking relation**:
A directed prerequisite between issues in the same project: one issue is blocked by another, and the other blocks it. Blocking relations reject self-links, duplicates, and cycles, including through preserved relations to deleted Issues. Hierarchy and blocking are independent graphs, so the same Issue pair may participate in both and cycles are checked separately. A relation touching a deleted Issue is inactive until restoration. A closed blocker also makes the relation inactive; reopening it reactivates the relation.
_Avoid_: Dependency (when the direction is unspecified)

**Authenticated principal**:
A verified request identity: either the single human or one independently managed Agent deployment. Every Authenticated principal has equal authority in the MVP; it is not a User account.
_Avoid_: User, account

**Agent deployment**:
An independently credentialed device, runner, or integration under which many concurrent Agent sessions may operate. Replacing its credential identity creates a new Agent deployment; prior attribution is not migrated.
_Avoid_: Agent, user

**Agent session**:
One logical agent run or conversation on an Agent deployment, correlated by a caller-provided session ID that remains stable across requests and reconnects. Its optional harness name and session ID are untrusted metadata, never authority.
_Avoid_: Request ID, credential

**Actor**:
An immutable attribution value captured on a Comment or Timeline event, identifying either the human or an Agent deployment. Agent-session metadata is captured separately, and an Actor is not an independently addressable entity.
_Avoid_: User, author

**Assignee**:
An optional free-form identity string indicating who has cooperatively claimed an Issue. It is not tied to an Actor or enforced as ownership; an unassigned Issue is unclaimed, and Agent clients conventionally use `<harness-or-agent>/<session-id>`.
_Avoid_: Owner, lease

**Label**:
Project-defined metadata that can be attached only to issues in its project for classification and workflow conventions. It has a mutable non-empty name, optional description, and optional RGB color. Its name need not be unique, and it carries no built-in workflow behavior; seeded labels are ordinary editable Labels. It may be attached at most once to each Issue. Soft-deleting it deactivates but preserves all of its Issue assignments until restoration.
_Avoid_: Tag

**Comment**:
A required non-empty Markdown message permanently owned by one Issue. It may be reversibly soft-deleted into a timeline tombstone with its body and revisions hidden, but cannot move between Issues.
_Avoid_: Note, reply

**Revision**:
An immutable snapshot in the ordered text history of an Issue title, Issue body, or Comment. A Revision is a value of its owner rather than an independently identified entity.

**Timeline event**:
An immutable, independently identified record of a meaningful Issue change. One event may be projected onto every Issue it affects.

**Project change record**:
An immutable, self-contained record of exactly one committed, non-noop Project-local mutation that changes REST-observable state and is used to synchronize clients. Project change records form one contiguous Project-wide sequence beginning at 1, with 0 representing no records. They are retained for the Project's lifetime in the MVP and describe domain mutations rather than generic storage patches. They are distinct from Timeline events, which they may reference when a mutation creates one.

**Timeline**:
The ordered projection of an Issue's Comments and Timeline events. Each projected item has a permanent Issue-local position.
_Avoid_: Activity log, audit log

**Mention**:
A reference written in an Issue body or Comment that resolves to another Issue or Project. It is derived from current Markdown and has no independent identity.
_Avoid_: Link (when referring to tracker entities)

**Internal reference**:
The reciprocal Issue-to-Issue connection created by a resolved Mention. It is visible from both Issues and has no independent identity.
_Avoid_: External reference

**External reference**:
A typed connection derived from a URL in an Issue body or Comment and pointing outside Overseer. It has no independent identity; URL is the only MVP type.
_Avoid_: Mention, internal reference

**Attachment**:
An independently addressable file permanently owned by one Issue. Its bytes, display filename, and declared media type become immutable when its upload completes; replacement creates a new Attachment. It progresses from pending to ready and may be soft-deleted and restored while retained. Current Markdown in its owning Issue body or Comments may associate with it, but it cannot be associated with another Issue.
_Avoid_: External reference
