# Overseer

Overseer is a personal issue tracker built from generic work-tracking primitives that agents and humans can compose into workflows such as Wayfinder.

## Language

**Workspace**:
The top-level organizational container for projects.
_Avoid_: Organization, tenant

**Project**:
A workspace-owned container that owns issues and a stable, project-local issue number space. A project is not inherently a board or workflow.
_Avoid_: Repository, board

**Issue**:
A unit of tracked work owned by exactly one project, identified by a stable project-local number, and either open or closed.
_Avoid_: Ticket, card, task

**Parent issue**:
The optional issue that groups an issue as one of its sub-issues. An issue has at most one parent.
_Avoid_: Epic

**Sub-issue**:
An issue grouped beneath a parent issue.
_Avoid_: Child ticket

**Blocking relation**:
A directed prerequisite between issues: one issue is blocked by another, and the other blocks it. Blocking relations cannot form cycles.
_Avoid_: Dependency (when the direction is unspecified)

**Assignee**:
An optional free-form identity string indicating who has cooperatively claimed an issue. An unassigned issue is unclaimed.
_Avoid_: Owner, lease

**Label**:
Project-defined metadata that can be attached to issues for classification and workflow conventions.
_Avoid_: Tag

**Comment**:
A markdown message appended to an issue's discussion.
_Avoid_: Note, reply

**Timeline**:
The chronological history of an issue's comments, content changes, and workflow changes.
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
