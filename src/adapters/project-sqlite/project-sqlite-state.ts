import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  IssueCursorInvalid,
  IssueDiscoveryStateService,
  ProjectIdempotencyKeyReused,
  type IssuePage,
  type ListIssuesInput,
  ProjectPersistenceUnavailable,
  ProjectStoredRecordCorrupt,
} from "../../application/issues/issue-discovery.ts";
import { Actor, AgentSession } from "../../domain/actor.ts";
import { IssueId, LabelId, ProjectId, TimelineEventId } from "../../domain/entity-id.ts";
import {
  Assignee,
  Issue,
  IssueBody,
  IssueNumber,
  IssueRevision,
  IssueTimestamp,
  IssueTitle,
  RevisionNumber,
  TimelinePosition,
  type Issue as IssueType,
  type IssueTimelineEntry,
  type IssueTimelineEvent,
} from "../../domain/issue.ts";
import {
  IssueAssigneeStatusFilter,
  IssueBlockingStatusFilter,
  IssueCursor,
  IssueLabelMatchFilter,
  IssueLifecycleFilter,
  IssuePageLimit,
  IssueSort,
  IssueSortDirection,
  IssueStateFilter,
} from "../../domain/pagination.ts";

const ActorJson = Schema.fromJsonString(Actor);
const AgentSessionJson = Schema.fromJsonString(Schema.OptionFromNullOr(AgentSession));

type IssueRow = {
  readonly id: unknown;
  readonly project_id: unknown;
  readonly issue_number: unknown;
  readonly title: unknown;
  readonly body: unknown;
  readonly state: unknown;
  readonly lifecycle: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
};

type NumberRow = { readonly value: unknown };

type IdempotencyRow = { readonly result_type: unknown; readonly issue_id: unknown };

type RevisionRow = {
  readonly field: unknown;
  readonly revision_number: unknown;
  readonly value: unknown;
  readonly actor_json: unknown;
  readonly agent_session_json: unknown;
  readonly created_at: unknown;
};

type TimelineRow = {
  readonly position: unknown;
  readonly id: unknown;
  readonly kind: unknown;
  readonly source_issue_id: unknown;
  readonly target_issue_id: unknown;
  readonly actor_json: unknown;
  readonly agent_session_json: unknown;
  readonly created_at: unknown;
};

type ReferenceRow = { readonly source_issue_id: unknown; readonly target_issue_id: unknown };

const IssueRowSchema = Schema.Struct({
  id: IssueId,
  project_id: ProjectId,
  issue_number: IssueNumber,
  title: IssueTitle,
  body: Schema.OptionFromNullOr(IssueBody),
  state: Schema.Literal("open"),
  lifecycle: Schema.Literal("active"),
  created_at: IssueTimestamp,
  updated_at: IssueTimestamp,
});

const revisionRowFields = {
  revision_number: RevisionNumber,
  actor_json: ActorJson,
  agent_session_json: AgentSessionJson,
  created_at: IssueTimestamp,
};

const RevisionRowSchema = Schema.Union([
  Schema.Struct({
    ...revisionRowFields,
    field: Schema.Literal("title"),
    value: IssueTitle,
  }),
  Schema.Struct({
    ...revisionRowFields,
    field: Schema.Literal("body"),
    value: Schema.OptionFromNullOr(IssueBody),
  }),
]);

const timelineRowFields = {
  position: TimelinePosition,
  id: TimelineEventId,
  source_issue_id: IssueId,
  actor_json: ActorJson,
  agent_session_json: AgentSessionJson,
  created_at: IssueTimestamp,
};

const TimelineRowSchema = Schema.Union([
  Schema.Struct({
    ...timelineRowFields,
    kind: Schema.Literal("issue_created"),
    target_issue_id: Schema.Null,
  }),
  Schema.Struct({
    ...timelineRowFields,
    kind: Schema.Literal("internal_reference_added"),
    target_issue_id: IssueId,
  }),
]);

const ReferenceRowSchema = Schema.Struct({ source_issue_id: IssueId, target_issue_id: IssueId });

const IssueCursorBinding = Schema.Struct({
  projectId: ProjectId,
  state: IssueStateFilter,
  lifecycle: IssueLifecycleFilter,
  assignee: Schema.NullOr(Assignee),
  assigneeStatus: IssueAssigneeStatusFilter,
  labelIds: Schema.Array(LabelId),
  labelMatch: IssueLabelMatchFilter,
  parent: Schema.NullOr(Schema.Union([Schema.Literal("root"), IssueId])),
  blockingStatus: IssueBlockingStatusFilter,
  number: Schema.NullOr(IssueNumber),
  sort: IssueSort,
  direction: IssueSortDirection,
  limit: IssuePageLimit,
});
const issueCursorBindingEquals = Schema.toEquivalence(IssueCursorBinding);
const IssueCursorState = Schema.Struct({
  binding: IssueCursorBinding,
  mode: Schema.Literals(["after", "before"]),
  issueId: IssueId,
  number: IssueNumber,
  createdAt: IssueTimestamp,
  updatedAt: IssueTimestamp,
});
const IssueCursorJson = Schema.fromJsonString(IssueCursorState);
type IssueCursorState = typeof IssueCursorState.Type;

function issueCursorBinding(input: ListIssuesInput): typeof IssueCursorBinding.Type {
  return IssueCursorBinding.make({
    projectId: input.projectId,
    state: input.state,
    lifecycle: input.lifecycle,
    assignee: Option.getOrNull(input.assignee),
    assigneeStatus: input.assigneeStatus,
    labelIds: input.labelIds,
    labelMatch: input.labelMatch,
    parent: Option.getOrNull(input.parent),
    blockingStatus: input.blockingStatus,
    number: Option.getOrNull(input.number),
    sort: input.sort,
    direction: input.direction,
    limit: input.limit,
  });
}

function decodeIssueCursor(cursor: IssueCursor): Option.Option<IssueCursorState> {
  const decoded = Encoding.decodeBase64UrlString(cursor);
  return Result.isSuccess(decoded)
    ? Schema.decodeUnknownOption(IssueCursorJson)(decoded.success)
    : Option.none();
}

function encodeIssueCursor(
  input: ListIssuesInput,
  mode: "after" | "before",
  issue: IssueType,
): IssueCursor {
  return IssueCursor.make(
    Encoding.encodeBase64Url(
      Schema.encodeSync(IssueCursorJson)(
        IssueCursorState.make({
          binding: issueCursorBinding(input),
          mode,
          issueId: issue.id,
          number: issue.number,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
        }),
      ),
    ),
  );
}

type IssueListSort = {
  readonly column: "issue_number" | "created_at" | "updated_at";
  readonly cursorValue: (cursor: IssueCursorState) => IssueNumber | IssueTimestamp;
};

type IssueListSqlQuery = {
  readonly statement: string;
  readonly parameters: ReadonlyArray<unknown>;
  readonly reversePage: boolean;
};

function parseRequestedIssueCursor(
  input: ListIssuesInput,
): Effect.Effect<Option.Option<IssueCursorState>, IssueCursorInvalid> {
  return Effect.gen(function* () {
    const requestedCursor = Option.flatMap(input.cursor, decodeIssueCursor);
    if (Option.isSome(input.cursor) && Option.isNone(requestedCursor)) {
      return yield* new IssueCursorInvalid({ reason: "malformed" });
    }
    if (
      Option.isSome(requestedCursor) &&
      !issueCursorBindingEquals(requestedCursor.value.binding, issueCursorBinding(input))
    ) {
      return yield* new IssueCursorInvalid({ reason: "rebound" });
    }
    return requestedCursor;
  });
}

function issueListSort(sort: ListIssuesInput["sort"]): IssueListSort {
  switch (sort) {
    case "number":
      return { column: "issue_number", cursorValue: (cursor) => cursor.number };
    case "created_at":
      return { column: "created_at", cursorValue: (cursor) => cursor.createdAt };
    case "updated_at":
      return { column: "updated_at", cursorValue: (cursor) => cursor.updatedAt };
  }
}

function issueListFilterSql(input: ListIssuesInput): {
  readonly clauses: Array<string>;
  readonly parameters: Array<unknown>;
} {
  const clauses: Array<string> = [];
  const parameters: Array<unknown> = [];
  if (input.state === "closed" || input.lifecycle === "deleted") clauses.push("0 = 1");
  if (Option.isSome(input.assignee) || input.assigneeStatus === "assigned") clauses.push("0 = 1");
  if (input.labelIds.length > 0) clauses.push("0 = 1");
  if (Option.isSome(input.parent) && input.parent.value !== "root") clauses.push("0 = 1");
  if (input.blockingStatus === "blocked") clauses.push("0 = 1");
  if (Option.isSome(input.number)) {
    clauses.push("issue_number = ?");
    parameters.push(input.number.value);
  }
  return { clauses, parameters };
}

function issueListCursorSql(
  input: ListIssuesInput,
  cursor: IssueCursorState,
  sort: IssueListSort,
): { readonly clause: string; readonly parameters: ReadonlyArray<unknown> } {
  const followsDisplayOrder = cursor.mode === "after";
  const ascendingComparison =
    (input.direction === "asc" && followsDisplayOrder) ||
    (input.direction === "desc" && !followsDisplayOrder);
  const operator = ascendingComparison ? ">" : "<";
  const sortValue = sort.cursorValue(cursor);
  return {
    clause: `(${sort.column} ${operator} ? OR (${sort.column} = ? AND id ${operator} ?))`,
    parameters: [sortValue, sortValue, cursor.issueId],
  };
}

function issueListQueryDirection(input: ListIssuesInput, reversePage: boolean): "ASC" | "DESC" {
  const ascending = reversePage ? input.direction !== "asc" : input.direction === "asc";
  return ascending ? "ASC" : "DESC";
}

function issueListSqlQuery(
  input: ListIssuesInput,
  requestedCursor: Option.Option<IssueCursorState>,
): IssueListSqlQuery {
  const sort = issueListSort(input.sort);
  const { clauses, parameters } = issueListFilterSql(input);
  if (Option.isSome(requestedCursor)) {
    const cursorSql = issueListCursorSql(input, requestedCursor.value, sort);
    clauses.push(cursorSql.clause);
    parameters.push(...cursorSql.parameters);
  }

  const reversePage = Option.exists(requestedCursor, (cursor) => cursor.mode === "before");
  const queryDirection = issueListQueryDirection(input, reversePage);
  parameters.push(input.limit + 1);
  return {
    statement: `SELECT id, project_id, issue_number, title, body, state, lifecycle, created_at, updated_at
                FROM issues
                ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
                ORDER BY ${sort.column} ${queryDirection}, id ${queryDirection}
                LIMIT ?`,
    parameters,
    reversePage,
  };
}

function buildIssuePage(
  input: ListIssuesInput,
  requestedCursor: Option.Option<IssueCursorState>,
  parsedIssues: ReadonlyArray<IssueType>,
  reversePage: boolean,
): IssuePage {
  const bounded = parsedIssues.slice(0, input.limit);
  const issues = reversePage ? bounded.toReversed() : bounded;
  const first = issues[0];
  const last = issues.at(-1);
  const hasPrevious =
    Option.exists(requestedCursor, (cursor) => cursor.mode === "after") ||
    (reversePage && parsedIssues.length > input.limit);
  const hasNext =
    Option.exists(requestedCursor, (cursor) => cursor.mode === "before") ||
    (!reversePage && parsedIssues.length > input.limit);
  return {
    issues,
    previousCursor:
      hasPrevious && first !== undefined
        ? Option.some(encodeIssueCursor(input, "before", first))
        : Option.none(),
    nextCursor:
      hasNext && last !== undefined
        ? Option.some(encodeIssueCursor(input, "after", last))
        : Option.none(),
  };
}

function parseStored<A>(
  schema: Schema.Decoder<A>,
  input: unknown,
  recordType: string,
): Effect.Effect<A, ProjectStoredRecordCorrupt> {
  return Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((cause) => new ProjectStoredRecordCorrupt({ recordType, cause })),
  );
}

function issueFromRow(row: IssueRow): Effect.Effect<IssueType, ProjectStoredRecordCorrupt> {
  return parseStored(IssueRowSchema, row, "issue").pipe(
    Effect.map((stored) =>
      Issue.make({
        id: stored.id,
        projectId: stored.project_id,
        number: stored.issue_number,
        title: stored.title,
        body: stored.body,
        state: stored.state,
        lifecycle: stored.lifecycle,
        createdAt: stored.created_at,
        updatedAt: stored.updated_at,
      }),
    ),
  );
}

const unavailable = (operation: string) => (cause: unknown) =>
  Effect.fail(new ProjectPersistenceUnavailable({ operation, cause }));

/** Construct SQLite-backed Project Issue persistence. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const findIssue = Effect.fn("ProjectSqliteState.findIssue")(
    function* (issueId) {
      const rows = yield* sql<IssueRow>`
        SELECT id, project_id, issue_number, title, body, state, lifecycle, created_at, updated_at
        FROM issues
        WHERE id = ${issueId}
      `;
      const row = rows[0];
      return row === undefined ? Option.none() : Option.some(yield* issueFromRow(row));
    },
    Effect.catchTag("SqlError", unavailable("findIssue")),
  );
  const findIssueByNumber = Effect.fn("ProjectSqliteState.findIssueByNumber")(
    function* (number) {
      const rows = yield* sql<IssueRow>`
        SELECT id, project_id, issue_number, title, body, state, lifecycle, created_at, updated_at
        FROM issues
        WHERE issue_number = ${number}
      `;
      const row = rows[0];
      return row === undefined ? Option.none() : Option.some(yield* issueFromRow(row));
    },
    Effect.catchTag("SqlError", unavailable("findIssueByNumber")),
  );

  return IssueDiscoveryStateService.of({
    transaction: Effect.fn("ProjectSqliteState.transaction")(
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        sql.withTransaction(effect).pipe(Effect.catchTag("SqlError", unavailable("transaction"))),
    ),
    findRecordedIssueCreation: Effect.fn("ProjectSqliteState.findRecordedIssueCreation")(
      function* (key) {
        const rows = yield* sql<IdempotencyRow>`
          SELECT result_type, issue_id
          FROM project_idempotency_keys
          WHERE idempotency_key = ${key}
        `;
        const row = rows[0];
        if (row === undefined) return Option.none();
        if (row.result_type !== "issue_creation") return yield* new ProjectIdempotencyKeyReused();
        const issueId = yield* parseStored(IssueId, row.issue_id, "idempotency");
        const issue = yield* findIssue(issueId);
        if (Option.isNone(issue))
          return yield* new ProjectStoredRecordCorrupt({
            recordType: "idempotency",
            cause: "Issue creation key references a missing Issue",
          });
        return issue;
      },
      Effect.catchTag("SqlError", unavailable("findRecordedIssueCreation")),
    ),
    allocateIssueNumber: Effect.fn("ProjectSqliteState.allocateIssueNumber")(
      function* () {
        const rows = yield* sql<NumberRow>`
          UPDATE project_counters
          SET next_issue_number = next_issue_number + 1
          WHERE singleton = 1
          RETURNING next_issue_number - 1 AS value
        `;
        const row = rows[0];
        if (row === undefined)
          return yield* new ProjectStoredRecordCorrupt({
            recordType: "counter",
            cause: "Project Issue counter is missing",
          });
        return yield* parseStored(IssueNumber, row.value, "counter");
      },
      Effect.catchTag("SqlError", unavailable("allocateIssueNumber")),
    ),
    findIssue,
    listIssues: Effect.fn("ProjectSqliteState.listIssues")(
      function* (input) {
        const requestedCursor = yield* parseRequestedIssueCursor(input);
        const query = issueListSqlQuery(input, requestedCursor);
        const rows = yield* sql.unsafe<IssueRow>(query.statement, query.parameters);
        const issues = yield* Effect.forEach(rows, issueFromRow);
        return buildIssuePage(input, requestedCursor, issues, query.reversePage);
      },
      Effect.catchTag("SqlError", unavailable("listIssues")),
    ),
    findIssueByNumber,
    insertIssueCreation: Effect.fn("ProjectSqliteState.insertIssueCreation")(
      function* ({ issue, titleRevision, bodyRevision, event, idempotencyKey }) {
        yield* sql`
          INSERT INTO issues (
            id, project_id, issue_number, title, body, state, lifecycle,
            created_at, updated_at, next_timeline_position
          )
          VALUES (
            ${issue.id}, ${issue.projectId}, ${issue.number}, ${issue.title},
            ${Option.getOrNull(issue.body)}, 'open', 'active', ${issue.createdAt},
            ${issue.updatedAt}, 2
          )
        `;

        for (const revision of [titleRevision, bodyRevision]) {
          const value =
            revision.field === "title" ? revision.value : Option.getOrNull(revision.value);
          yield* sql`
            INSERT INTO issue_revisions (
              issue_id, field, revision_number, value, actor_json,
              agent_session_json, created_at
            )
            VALUES (
              ${issue.id}, ${revision.field}, ${revision.number}, ${value},
              ${Schema.encodeSync(ActorJson)(revision.actor)},
              ${Schema.encodeSync(AgentSessionJson)(revision.agentSession)},
              ${revision.createdAt}
            )
          `;
        }

        yield* sql`
          INSERT INTO timeline_events (
            id, kind, source_issue_id, target_issue_id, actor_json,
            agent_session_json, created_at
          )
          VALUES (
            ${event.id}, ${event.kind}, ${event.sourceIssueId}, ${null},
            ${Schema.encodeSync(ActorJson)(event.actor)},
            ${Schema.encodeSync(AgentSessionJson)(event.agentSession)},
            ${event.createdAt}
          )
        `;
        yield* sql`
          INSERT INTO timeline_entries (issue_id, position, event_id)
          VALUES (${issue.id}, 1, ${event.id})
        `;
        yield* sql`
          INSERT INTO project_idempotency_keys (idempotency_key, result_type, issue_id)
          VALUES (${idempotencyKey}, 'issue_creation', ${issue.id})
        `;
      },
      Effect.catchTag("SqlError", unavailable("insertIssueCreation")),
    ),
    allocateTimelinePosition: Effect.fn("ProjectSqliteState.allocateTimelinePosition")(
      function* (issueId) {
        const rows = yield* sql<NumberRow>`
          UPDATE issues
          SET next_timeline_position = next_timeline_position + 1
          WHERE id = ${issueId}
          RETURNING next_timeline_position - 1 AS value
        `;
        const row = rows[0];
        if (row === undefined)
          return yield* new ProjectStoredRecordCorrupt({
            recordType: "timeline_counter",
            cause: "Timeline owner is missing",
          });
        return yield* parseStored(TimelinePosition, row.value, "timeline_counter");
      },
      Effect.catchTag("SqlError", unavailable("allocateTimelinePosition")),
    ),
    insertIssueReference: Effect.fn("ProjectSqliteState.insertIssueReference")(
      function* ({ reference, event, sourcePosition, targetPosition }) {
        yield* sql`
          INSERT INTO issue_references (source_issue_id, target_issue_id)
          VALUES (${reference.sourceIssueId}, ${reference.targetIssueId})
        `;
        yield* sql`
          INSERT INTO timeline_events (
            id, kind, source_issue_id, target_issue_id, actor_json,
            agent_session_json, created_at
          )
          VALUES (
            ${event.id}, ${event.kind}, ${event.sourceIssueId}, ${event.targetIssueId},
            ${Schema.encodeSync(ActorJson)(event.actor)},
            ${Schema.encodeSync(AgentSessionJson)(event.agentSession)},
            ${event.createdAt}
          )
        `;
        yield* sql`
          INSERT INTO timeline_entries (issue_id, position, event_id)
          VALUES (${reference.sourceIssueId}, ${sourcePosition}, ${event.id})
        `;
        yield* sql`
          INSERT INTO timeline_entries (issue_id, position, event_id)
          VALUES (${reference.targetIssueId}, ${targetPosition}, ${event.id})
        `;
      },
      Effect.catchTag("SqlError", unavailable("insertIssueReference")),
    ),
    readIssueRevisions: Effect.fn("ProjectSqliteState.readIssueRevisions")(
      function* (issueId) {
        const rows = yield* sql<RevisionRow>`
          SELECT field, revision_number, value, actor_json, agent_session_json, created_at
          FROM issue_revisions
          WHERE issue_id = ${issueId}
          ORDER BY field, revision_number
        `;
        const revisions: Array<IssueRevision> = [];
        for (const row of rows) {
          const stored = yield* parseStored(RevisionRowSchema, row, "revision");
          const attribution = {
            number: stored.revision_number,
            actor: stored.actor_json,
            agentSession: stored.agent_session_json,
            createdAt: stored.created_at,
          };
          revisions.push(
            stored.field === "title"
              ? IssueRevision.make({ ...attribution, field: "title", value: stored.value })
              : IssueRevision.make({ ...attribution, field: "body", value: stored.value }),
          );
        }
        return revisions;
      },
      Effect.catchTag("SqlError", unavailable("readIssueRevisions")),
    ),
    readIssueTimeline: Effect.fn("ProjectSqliteState.readIssueTimeline")(
      function* (issueId) {
        const rows = yield* sql<TimelineRow>`
          SELECT
            te.position, ev.id, ev.kind, ev.source_issue_id, ev.target_issue_id,
            ev.actor_json, ev.agent_session_json, ev.created_at
          FROM timeline_entries te
          JOIN timeline_events ev ON ev.id = te.event_id
          WHERE te.issue_id = ${issueId}
          ORDER BY te.position
        `;
        const entries: Array<IssueTimelineEntry> = [];
        for (const row of rows) {
          const stored = yield* parseStored(TimelineRowSchema, row, "timeline");
          const eventAttribution = {
            id: stored.id,
            sourceIssueId: stored.source_issue_id,
            actor: stored.actor_json,
            agentSession: stored.agent_session_json,
            createdAt: stored.created_at,
          };
          const event: IssueTimelineEvent =
            stored.kind === "issue_created"
              ? { ...eventAttribution, kind: "issue_created" }
              : {
                  ...eventAttribution,
                  kind: "internal_reference_added",
                  targetIssueId: stored.target_issue_id,
                };
          entries.push({ position: stored.position, event });
        }
        return entries;
      },
      Effect.catchTag("SqlError", unavailable("readIssueTimeline")),
    ),
    readIssueReferences: Effect.fn("ProjectSqliteState.readIssueReferences")(
      function* (issueId) {
        const outgoingRows = yield* sql<ReferenceRow>`
          SELECT source_issue_id, target_issue_id
          FROM issue_references
          WHERE source_issue_id = ${issueId}
          ORDER BY target_issue_id
        `;
        const incomingRows = yield* sql<ReferenceRow>`
          SELECT source_issue_id, target_issue_id
          FROM issue_references
          WHERE target_issue_id = ${issueId}
          ORDER BY source_issue_id
        `;
        const parseReferences = (rows: ReadonlyArray<ReferenceRow>) =>
          Effect.forEach(rows, (row) =>
            parseStored(ReferenceRowSchema, row, "reference").pipe(
              Effect.map((stored) => ({
                sourceIssueId: stored.source_issue_id,
                targetIssueId: stored.target_issue_id,
              })),
            ),
          );
        return {
          outgoing: yield* parseReferences(outgoingRows),
          incoming: yield* parseReferences(incomingRows),
        };
      },
      Effect.catchTag("SqlError", unavailable("readIssueReferences")),
    ),
  });
});

/** SQLite-backed Project Issue persistence layer. */
export const layer = Layer.effect(IssueDiscoveryStateService, make);
