import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { CommandAttribution } from "../../domain/actor.ts";
import {
  IssueId,
  type LabelId,
  makeIssueId,
  makeTimelineEventId,
  type ProjectId,
} from "../../domain/entity-id.ts";
import type { IdempotencyKey } from "../../domain/idempotency.ts";
import {
  InternalReferenceAddedTimelineEvent,
  Issue,
  IssueCreatedTimelineEvent,
  IssueNumber,
  IssueRevision,
  IssueTimelineEntry,
  IssueTimestamp,
  RevisionNumber,
  TimelinePosition,
  type Assignee,
  type IssueBody,
  type IssueReference,
  type IssueTitle,
} from "../../domain/issue.ts";
import type {
  IssueAssigneeStatusFilter,
  IssueBlockingStatusFilter,
  IssueCursor,
  IssueLabelMatchFilter,
  IssueLifecycleFilter,
  IssuePageLimit,
  IssueSort,
  TimelineCursor,
  TimelinePageLimit,
  IssueSortDirection,
  IssueStateFilter,
} from "../../domain/pagination.ts";
import { UlidGeneratorService } from "../ulid-generator.ts";

/** A requested Issue does not exist in its owning Project. */
export class IssueNotFound extends Schema.TaggedErrorClass<IssueNotFound>()("IssueNotFound", {
  issueId: Schema.optionalKey(Issue.fields.id),
  number: Schema.optionalKey(Issue.fields.number),
}) {
  /** Stable safe diagnostic message. */
  override readonly message = "The requested Issue does not exist";
}

/** An Issue page cursor is malformed or bound to another list request. */
export class IssueCursorInvalid extends Schema.TaggedErrorClass<IssueCursorInvalid>()(
  "IssueCursorInvalid",
  { reason: Schema.Literals(["malformed", "rebound"]) },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The Issue page cursor is invalid for this collection request";
}

/** A Timeline page cursor is malformed or belongs to another Issue. */
export class TimelineCursorInvalid extends Schema.TaggedErrorClass<TimelineCursorInvalid>()(
  "TimelineCursorInvalid",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The Timeline page cursor is invalid for this Issue";
}

/** An Issue creation key already identifies another Project-local result. */
export class ProjectIdempotencyKeyReused extends Schema.TaggedErrorClass<ProjectIdempotencyKeyReused>()(
  "ProjectIdempotencyKeyReused",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The idempotency key identifies another Project-local operation";
}

/** A stored Project record failed parsing. */
export class ProjectStoredRecordCorrupt extends Schema.TaggedErrorClass<ProjectStoredRecordCorrupt>()(
  "ProjectStoredRecordCorrupt",
  { recordType: Schema.String, cause: Schema.Defect() },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A stored Project record could not be decoded";
}

/** A Project persistence operation failed. */
export class ProjectPersistenceUnavailable extends Schema.TaggedErrorClass<ProjectPersistenceUnavailable>()(
  "ProjectPersistenceUnavailable",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A Project persistence operation failed";
}

/** Detailed persistence failures retained inside the Project Durable Object. */
export type ProjectPersistenceError = ProjectStoredRecordCorrupt | ProjectPersistenceUnavailable;

/** Input for atomically creating one numbered Issue. */
export type CreateIssueInput = {
  readonly projectId: ProjectId;
  readonly title: IssueTitle;
  readonly body: Option.Option<IssueBody>;
  readonly idempotencyKey: IdempotencyKey;
  readonly attribution: CommandAttribution;
};

/** Successful Issue creation, including whether an object-local result was replayed. */
export type CreateIssueResult = {
  readonly issue: Issue;
  readonly replayed: boolean;
};

/** Complete normalized filters and ordering selecting one Project Issue page. */
export type ListIssuesInput = {
  readonly projectId: ProjectId;
  readonly state: IssueStateFilter;
  readonly lifecycle: IssueLifecycleFilter;
  readonly assignee: Option.Option<Assignee>;
  readonly assigneeStatus: IssueAssigneeStatusFilter;
  readonly labelIds: ReadonlyArray<LabelId>;
  readonly labelMatch: IssueLabelMatchFilter;
  readonly parent: Option.Option<"root" | IssueId>;
  readonly blockingStatus: IssueBlockingStatusFilter;
  readonly number: Option.Option<IssueNumber>;
  readonly sort: IssueSort;
  readonly direction: IssueSortDirection;
  readonly cursor: Option.Option<IssueCursor>;
  readonly limit: IssuePageLimit;
};

/** One exact Project Issue page with opaque bidirectional keyset cursors. */
export type IssuePage = {
  readonly issues: ReadonlyArray<Issue>;
  readonly previousCursor: Option.Option<IssueCursor>;
  readonly nextCursor: Option.Option<IssueCursor>;
};

/** Values committed atomically for one Issue creation. */
export type InsertIssueCreationInput = {
  readonly issue: Issue;
  readonly titleRevision: IssueRevision;
  readonly bodyRevision: IssueRevision;
  readonly event: IssueCreatedTimelineEvent;
  readonly idempotencyKey: IdempotencyKey;
};

/** Values committed atomically for one Issue reference. */
export type InsertIssueReferenceInput = {
  readonly reference: IssueReference;
  readonly event: InternalReferenceAddedTimelineEvent;
  readonly sourcePosition: TimelinePosition;
  readonly targetPosition: TimelinePosition;
};

/** Inputs selecting one ascending keyset page from an Issue Timeline. */
export type ReadIssueTimelineInput = {
  readonly issueId: IssueId;
  readonly cursor: Option.Option<TimelineCursor>;
  readonly limit: TimelinePageLimit;
};

/** One exact ascending Issue Timeline page. */
export type IssueTimelinePage = {
  readonly entries: ReadonlyArray<IssueTimelineEntry>;
  readonly previousCursor: Option.Option<TimelineCursor>;
  readonly nextCursor: Option.Option<TimelineCursor>;
};

/** Current incoming and outgoing references for one Issue. */
export type IssueReferences = {
  readonly outgoing: ReadonlyArray<IssueReference>;
  readonly incoming: ReadonlyArray<IssueReference>;
};

/** Transactional Project state required by Issue discovery. */
export type IssueDiscoveryState = {
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProjectPersistenceError, R>;
  readonly findRecordedIssueCreation: (
    key: IdempotencyKey,
  ) => Effect.Effect<Option.Option<Issue>, ProjectIdempotencyKeyReused | ProjectPersistenceError>;
  readonly allocateIssueNumber: () => Effect.Effect<IssueNumber, ProjectPersistenceError>;
  readonly findIssue: (
    issueId: IssueId,
  ) => Effect.Effect<Option.Option<Issue>, ProjectPersistenceError>;
  readonly listIssues: (
    input: ListIssuesInput,
  ) => Effect.Effect<IssuePage, IssueCursorInvalid | ProjectPersistenceError>;
  readonly findIssueByNumber: (
    number: IssueNumber,
  ) => Effect.Effect<Option.Option<Issue>, ProjectPersistenceError>;
  readonly insertIssueCreation: (
    input: InsertIssueCreationInput,
  ) => Effect.Effect<void, ProjectPersistenceError>;
  readonly allocateTimelinePosition: (
    issueId: IssueId,
  ) => Effect.Effect<TimelinePosition, ProjectPersistenceError>;
  readonly insertIssueReference: (
    input: InsertIssueReferenceInput,
  ) => Effect.Effect<void, ProjectPersistenceError>;
  readonly readIssueRevisions: (
    issueId: IssueId,
  ) => Effect.Effect<ReadonlyArray<IssueRevision>, ProjectPersistenceError>;
  readonly readIssueTimeline: (
    input: ReadIssueTimelineInput,
  ) => Effect.Effect<IssueTimelinePage, TimelineCursorInvalid | ProjectPersistenceError>;
  readonly readTimelineEvent: (
    issueId: IssueId,
    eventId: IssueTimelineEntry["event"]["id"],
  ) => Effect.Effect<Option.Option<IssueTimelineEntry["event"]>, ProjectPersistenceError>;
  readonly readIssueReferences: (
    issueId: IssueId,
  ) => Effect.Effect<IssueReferences, ProjectPersistenceError>;
};

/** Effect service for transactional Project Issue state. */
export class IssueDiscoveryStateService extends Context.Service<
  IssueDiscoveryStateService,
  IssueDiscoveryState
>()("@overseer/application/IssueDiscoveryState") {}

/** Project-local Issue creation and read operations. */
export type IssueDiscovery = {
  readonly createIssue: (
    input: CreateIssueInput,
  ) => Effect.Effect<CreateIssueResult, ProjectIdempotencyKeyReused | ProjectPersistenceError>;
  readonly readIssue: (
    issueId: IssueId,
  ) => Effect.Effect<Issue, IssueNotFound | ProjectPersistenceError>;
  readonly listIssues: (
    input: ListIssuesInput,
  ) => Effect.Effect<IssuePage, IssueCursorInvalid | ProjectPersistenceError>;
  readonly readIssueByNumber: (
    number: IssueNumber,
  ) => Effect.Effect<Issue, IssueNotFound | ProjectPersistenceError>;
  readonly readIssueRevisions: (
    issueId: IssueId,
  ) => Effect.Effect<ReadonlyArray<IssueRevision>, IssueNotFound | ProjectPersistenceError>;
  readonly readIssueTimeline: (
    input: ReadIssueTimelineInput,
  ) => Effect.Effect<
    IssueTimelinePage,
    TimelineCursorInvalid | IssueNotFound | ProjectPersistenceError
  >;
  readonly readTimelineEvent: (
    issueId: IssueId,
    eventId: IssueTimelineEntry["event"]["id"],
  ) => Effect.Effect<IssueTimelineEntry["event"], IssueNotFound | ProjectPersistenceError>;
  readonly readIssueReferences: (
    issueId: IssueId,
  ) => Effect.Effect<IssueReferences, IssueNotFound | ProjectPersistenceError>;
};

/** Effect service for object-local Issue discovery operations. */
export class IssueDiscoveryService extends Context.Service<IssueDiscoveryService, IssueDiscovery>()(
  "@overseer/application/IssueDiscovery",
) {}

type MarkdownIssueMentions = {
  readonly numbers: ReadonlyArray<IssueNumber>;
  readonly issueIds: ReadonlyArray<IssueId>;
};

function markdownIssueMentions(
  body: Option.Option<IssueBody>,
  projectId: ProjectId,
): MarkdownIssueMentions {
  if (Option.isNone(body)) return { numbers: [], issueIds: [] };
  const withoutCode = body.value
    .replace(
      /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?(?:\n[ \t]{0,3}\2[ \t]*(?=\n|$)|$))/g,
      "$1 ",
    )
    .replace(/^(?: {4}|\t).*$/gm, " ")
    .replace(/(`+)[\s\S]*?\1/g, " ")
    .replace(/\\#/g, " ");
  const numbers = new Set<number>();
  const numberMention =
    /(?<![\p{L}\p{N}_])(?:(project_[0-9A-HJKMNP-TV-Z]{26}))?#([1-9][0-9]*)(?![\p{L}\p{N}_])/gu;
  for (const match of withoutCode.matchAll(numberMention)) {
    const qualifier = match[1];
    const value = Number(match[2]);
    if ((qualifier === undefined || qualifier === projectId) && Number.isSafeInteger(value))
      numbers.add(value);
  }
  const issueIds = new Set<IssueId>();
  const canonicalMention = /\/api\/issues\/(issue_[0-9A-HJKMNP-TV-Z]{26})(?![\p{L}\p{N}_])/gu;
  for (const match of withoutCode.matchAll(canonicalMention)) {
    const issueId = Schema.decodeUnknownOption(IssueId)(match[1]);
    if (Option.isSome(issueId)) issueIds.add(issueId.value);
  }
  return {
    numbers: Array.from(numbers).map((number) => IssueNumber.make(number)),
    issueIds: Array.from(issueIds),
  };
}

/** Construct Project-local Issue discovery policy from state and ID services. */
export const make = Effect.gen(function* () {
  const state = yield* IssueDiscoveryStateService;
  const ulids = yield* UlidGeneratorService;

  const requireIssue = Effect.fn("IssueDiscovery.requireIssue")(function* (issueId: IssueId) {
    const found = yield* state.findIssue(issueId);
    if (Option.isNone(found)) return yield* new IssueNotFound({ issueId });
    return found.value;
  });

  return IssueDiscoveryService.of({
    createIssue: Effect.fn("IssueDiscovery.createIssue")(function* (input) {
      return yield* state.transaction(
        Effect.gen(function* () {
          const recorded = yield* state.findRecordedIssueCreation(input.idempotencyKey);
          if (Option.isSome(recorded)) return { issue: recorded.value, replayed: true };
          const number = yield* state.allocateIssueNumber();
          const timestamp = IssueTimestamp.make(DateTime.formatIso(yield* DateTime.now));
          const issue = Issue.make({
            id: makeIssueId(yield* ulids.next()),
            projectId: input.projectId,
            number,
            title: input.title,
            body: input.body,
            state: "open",
            lifecycle: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          const titleRevision = IssueRevision.make({
            field: "title",
            number: RevisionNumber.make(1),
            value: input.title,
            actor: input.attribution.actor,
            agentSession: input.attribution.agentSession,
            createdAt: timestamp,
          });
          const bodyRevision = IssueRevision.make({
            field: "body",
            number: RevisionNumber.make(1),
            value: input.body,
            actor: input.attribution.actor,
            agentSession: input.attribution.agentSession,
            createdAt: timestamp,
          });
          const creationEvent = IssueCreatedTimelineEvent.make({
            id: makeTimelineEventId(yield* ulids.next()),
            kind: "issue_created",
            sourceIssueId: issue.id,
            actor: input.attribution.actor,
            agentSession: input.attribution.agentSession,
            createdAt: timestamp,
          });
          yield* state.insertIssueCreation({
            issue,
            titleRevision,
            bodyRevision,
            event: creationEvent,
            idempotencyKey: input.idempotencyKey,
          });

          const mentions = markdownIssueMentions(input.body, input.projectId);
          const targets = new Map<IssueId, Issue>();
          for (const targetNumber of mentions.numbers) {
            const target = yield* state.findIssueByNumber(targetNumber);
            if (Option.isSome(target)) targets.set(target.value.id, target.value);
          }
          for (const targetIssueId of mentions.issueIds) {
            const target = yield* state.findIssue(targetIssueId);
            if (Option.isSome(target)) targets.set(target.value.id, target.value);
          }
          targets.delete(issue.id);

          for (const target of targets.values()) {
            const event = InternalReferenceAddedTimelineEvent.make({
              id: makeTimelineEventId(yield* ulids.next()),
              kind: "internal_reference_added",
              sourceIssueId: issue.id,
              targetIssueId: target.id,
              actor: input.attribution.actor,
              agentSession: input.attribution.agentSession,
              createdAt: timestamp,
            });
            yield* state.insertIssueReference({
              reference: { sourceIssueId: issue.id, targetIssueId: target.id },
              event,
              sourcePosition: yield* state.allocateTimelinePosition(issue.id),
              targetPosition: yield* state.allocateTimelinePosition(target.id),
            });
          }
          return { issue, replayed: false };
        }),
      );
    }),
    readIssue: Effect.fn("IssueDiscovery.readIssue")(requireIssue),
    listIssues: Effect.fn("IssueDiscovery.listIssues")((input) => state.listIssues(input)),
    readIssueByNumber: Effect.fn("IssueDiscovery.readIssueByNumber")(function* (number) {
      const found = yield* state.findIssueByNumber(number);
      if (Option.isNone(found)) return yield* new IssueNotFound({ number });
      return found.value;
    }),
    readIssueRevisions: Effect.fn("IssueDiscovery.readIssueRevisions")(function* (issueId) {
      yield* requireIssue(issueId);
      return yield* state.readIssueRevisions(issueId);
    }),
    readIssueTimeline: Effect.fn("IssueDiscovery.readIssueTimeline")(function* (input) {
      yield* requireIssue(input.issueId);
      return yield* state.readIssueTimeline(input);
    }),
    readTimelineEvent: Effect.fn("IssueDiscovery.readTimelineEvent")(function* (issueId, eventId) {
      yield* requireIssue(issueId);
      const event = yield* state.readTimelineEvent(issueId, eventId);
      if (Option.isNone(event)) return yield* new IssueNotFound({ issueId });
      return event.value;
    }),
    readIssueReferences: Effect.fn("IssueDiscovery.readIssueReferences")(function* (issueId) {
      yield* requireIssue(issueId);
      return yield* state.readIssueReferences(issueId);
    }),
  });
});

/** Production Project-local Issue discovery policy layer. */
export const layer = Layer.effect(IssueDiscoveryService, make);
