import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { Actor, AgentSession } from "./actor.ts";
import { IssueId, ProjectId, TimelineEventId } from "./entity-id.ts";

const hasUnicodeLength = (minimum: number, maximum: number) =>
  Schema.makeFilter(
    (value: string) => {
      const length = Array.from(value).length;
      return length >= minimum && length <= maximum;
    },
    { expected: `between ${minimum} and ${maximum} Unicode characters` },
  );
const containsNonWhitespace = Schema.isPattern(/\S/u);
const isSingleLineWithoutControls = Schema.isPattern(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u);
const isCanonicalUtcTimestamp = Schema.makeFilter(
  (value: string) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  },
  { expected: "a valid canonical UTC RFC 3339 timestamp" },
);

/** Exact nonblank single-line Issue title, limited to 500 Unicode characters. */
export const IssueTitle = Schema.String.check(
  hasUnicodeLength(1, 500),
  containsNonWhitespace,
  isSingleLineWithoutControls,
).pipe(Schema.brand("IssueTitle"));

/** Exact nonblank single-line Issue title, limited to 500 Unicode characters. */
export type IssueTitle = typeof IssueTitle.Type;

/** Exact Issue Markdown body, limited to 65,536 Unicode characters. */
export const IssueBody = Schema.String.check(hasUnicodeLength(0, 65_536)).pipe(
  Schema.brand("IssueBody"),
);

/** Exact Issue Markdown body, limited to 65,536 Unicode characters. */
export type IssueBody = typeof IssueBody.Type;

/** Exact cooperative Issue claim, preserved without normalization. */
export const Assignee = Schema.String.check(
  hasUnicodeLength(1, 200),
  containsNonWhitespace,
  Schema.isPattern(/^[^\p{Cc}]*$/u),
).pipe(Schema.brand("Assignee"));

/** Exact cooperative Issue claim, preserved without normalization. */
export type Assignee = typeof Assignee.Type;

/** Immutable positive Project-local Issue number. */
export const IssueNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("IssueNumber"),
);

/** Immutable positive Project-local Issue number. */
export type IssueNumber = typeof IssueNumber.Type;

const CanonicalIssueNumberString = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/));

/** Parse a canonical positive decimal path value into a Project-local Issue number. */
export const IssueNumberFromString = CanonicalIssueNumberString.pipe(
  Schema.decodeTo(
    IssueNumber,
    SchemaTransformation.transform({
      decode: (value) => Number(value),
      encode: (value) => String(value),
    }),
  ),
);

/** Immutable positive owner-local Revision number. */
export const RevisionNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("RevisionNumber"),
);

/** Immutable positive owner-local Revision number. */
export type RevisionNumber = typeof RevisionNumber.Type;

/** Immutable positive Issue-local Timeline position. */
export const TimelinePosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("TimelinePosition"),
);

/** Immutable positive Issue-local Timeline position. */
export type TimelinePosition = typeof TimelinePosition.Type;

/** UTC RFC 3339 timestamp used by Issue persistence. */
export const IssueTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  isCanonicalUtcTimestamp,
).pipe(Schema.brand("IssueTimestamp"));

/** UTC RFC 3339 timestamp used by Issue persistence. */
export type IssueTimestamp = typeof IssueTimestamp.Type;

/** Live open Issue state returned by the first Issue discovery slice. */
export const Issue = Schema.Struct({
  id: IssueId,
  projectId: ProjectId,
  number: IssueNumber,
  title: IssueTitle,
  body: Schema.OptionFromNullOr(IssueBody),
  state: Schema.Literal("open"),
  lifecycle: Schema.Literal("active"),
  createdAt: IssueTimestamp,
  updatedAt: IssueTimestamp,
});

/** Live open Issue state returned by the first Issue discovery slice. */
export interface Issue extends Schema.Schema.Type<typeof Issue> {}

const issueRevisionFields = {
  number: RevisionNumber,
  actor: Actor,
  agentSession: Schema.OptionFromNullOr(AgentSession),
  createdAt: IssueTimestamp,
};

/** Immutable snapshot in one Issue text field's ordered history. */
export const IssueRevision = Schema.Union([
  Schema.Struct({ ...issueRevisionFields, field: Schema.Literal("title"), value: IssueTitle }),
  Schema.Struct({
    ...issueRevisionFields,
    field: Schema.Literal("body"),
    value: Schema.OptionFromNullOr(IssueBody),
  }),
]);

/** Immutable snapshot in one Issue text field's ordered history. */
export type IssueRevision = typeof IssueRevision.Type;

const issueTimelineEventFields = {
  id: TimelineEventId,
  sourceIssueId: IssueId,
  actor: Actor,
  agentSession: Schema.OptionFromNullOr(AgentSession),
  createdAt: IssueTimestamp,
};

/** Issue creation event projected into its Issue Timeline. */
export const IssueCreatedTimelineEvent = Schema.Struct({
  ...issueTimelineEventFields,
  kind: Schema.Literal("issue_created"),
});

/** Issue creation event projected into its Issue Timeline. */
export type IssueCreatedTimelineEvent = typeof IssueCreatedTimelineEvent.Type;

/** Internal-reference event projected into both affected Issue Timelines. */
export const InternalReferenceAddedTimelineEvent = Schema.Struct({
  ...issueTimelineEventFields,
  kind: Schema.Literal("internal_reference_added"),
  targetIssueId: IssueId,
});

/** Internal-reference event projected into both affected Issue Timelines. */
export type InternalReferenceAddedTimelineEvent = typeof InternalReferenceAddedTimelineEvent.Type;

/** Structured event projected into one or more Issue Timelines. */
export const IssueTimelineEvent = Schema.Union([
  IssueCreatedTimelineEvent,
  InternalReferenceAddedTimelineEvent,
]);

/** Structured event projected into one or more Issue Timelines. */
export type IssueTimelineEvent = typeof IssueTimelineEvent.Type;

/** Placement of a structured event in one Issue's Timeline. */
export const IssueTimelineEntry = Schema.Struct({
  position: TimelinePosition,
  event: IssueTimelineEvent,
});

/** Placement of a structured event in one Issue's Timeline. */
export interface IssueTimelineEntry extends Schema.Schema.Type<typeof IssueTimelineEntry> {}

/** Current same-Project Issue-to-Issue reference derived from Markdown. */
export const IssueReference = Schema.Struct({
  sourceIssueId: IssueId,
  targetIssueId: IssueId,
});

/** Current same-Project Issue-to-Issue reference derived from Markdown. */
export interface IssueReference extends Schema.Schema.Type<typeof IssueReference> {}

/** Choose an Issue timestamp that strictly advances persisted time. */
export function advanceIssueTimestamp(
  current: IssueTimestamp,
  candidate: IssueTimestamp,
): IssueTimestamp {
  if (candidate > current) return candidate;
  return IssueTimestamp.make(
    DateTime.makeUnsafe(current).pipe(DateTime.add({ milliseconds: 1 }), DateTime.formatIso),
  );
}
