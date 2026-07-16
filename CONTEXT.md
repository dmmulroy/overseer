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

**Assignee**:
An optional free-form identity string indicating who has cooperatively claimed an issue. An unassigned issue is unclaimed.
_Avoid_: Owner, lease

**Label**:
Project-defined metadata that can be attached only to issues in its project for classification and workflow conventions. It has a mutable non-empty name, optional description, and optional RGB color. Its name need not be unique, and it carries no built-in workflow behavior; seeded labels are ordinary editable Labels. It may be attached at most once to each Issue. Soft-deleting it deactivates but preserves all of its Issue assignments until restoration.
_Avoid_: Tag

**Comment**:
An editable Markdown message permanently owned by one Issue. It may be reversibly soft-deleted into a timeline tombstone with its body hidden, but cannot move between Issues. Edits, deletion, and restoration are recorded as structured events.
_Avoid_: Note, reply

**Timeline**:
The chronological projection of an Issue's independently identified Comments and immutable structured events for content and workflow changes.
_Avoid_: Activity log, audit log

**Mention**:
A reference written in an issue body or comment that connects the source content to another issue or project.
_Avoid_: Link (when referring to tracker entities)

**External reference**:
A typed connection from an issue to a resource outside Overseer; the initial type is a URL.
_Avoid_: Mention

**Attachment**:
A file uploaded to Overseer and associated with issue content.
_Avoid_: External reference
