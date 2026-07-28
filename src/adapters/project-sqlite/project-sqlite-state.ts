import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  IssueDiscoveryStateService,
  ProjectIdempotencyKeyReused,
  ProjectPersistenceUnavailable,
  ProjectStoredRecordCorrupt,
} from "../../application/issues/issue-discovery.ts";
import { Actor, AgentSession } from "../../domain/actor.ts";
import { IssueId, ProjectId, TimelineEventId } from "../../domain/entity-id.ts";
import {
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

const ActorJson = Schema.fromJsonString(Actor);
const AgentSessionJson = Schema.fromJsonString(Schema.NullOr(AgentSession));

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
  body: Schema.NullOr(IssueBody),
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
    value: Schema.NullOr(IssueBody),
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
      const row =
        (yield* sql<IssueRow>`SELECT id, project_id, issue_number, title, body, state, lifecycle, created_at, updated_at FROM issues WHERE id = ${issueId}`)[0];
      return row === undefined ? Option.none() : Option.some(yield* issueFromRow(row));
    },
    Effect.catchTag("SqlError", unavailable("findIssue")),
  );
  const findIssueByNumber = Effect.fn("ProjectSqliteState.findIssueByNumber")(
    function* (number) {
      const row =
        (yield* sql<IssueRow>`SELECT id, project_id, issue_number, title, body, state, lifecycle, created_at, updated_at FROM issues WHERE issue_number = ${number}`)[0];
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
        const row =
          (yield* sql<IdempotencyRow>`SELECT result_type, issue_id FROM project_idempotency_keys WHERE idempotency_key = ${key}`)[0];
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
        const row =
          (yield* sql<NumberRow>`UPDATE project_counters SET next_issue_number = next_issue_number + 1 WHERE singleton = 1 RETURNING next_issue_number - 1 AS value`)[0];
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
    findIssueByNumber,
    insertIssueCreation: Effect.fn("ProjectSqliteState.insertIssueCreation")(
      function* ({ issue, titleRevision, bodyRevision, event, idempotencyKey }) {
        yield* sql`INSERT INTO issues (id, project_id, issue_number, title, body, state, lifecycle, created_at, updated_at, next_timeline_position) VALUES (${issue.id}, ${issue.projectId}, ${issue.number}, ${issue.title}, ${issue.body}, 'open', 'active', ${issue.createdAt}, ${issue.updatedAt}, 2)`;
        for (const revision of [titleRevision, bodyRevision]) {
          yield* sql`INSERT INTO issue_revisions (issue_id, field, revision_number, value, actor_json, agent_session_json, created_at) VALUES (${issue.id}, ${revision.field}, ${revision.number}, ${revision.value}, ${Schema.encodeSync(ActorJson)(revision.actor)}, ${Schema.encodeSync(AgentSessionJson)(revision.agentSession)}, ${revision.createdAt})`;
        }
        yield* sql`INSERT INTO timeline_events (id, kind, source_issue_id, target_issue_id, actor_json, agent_session_json, created_at) VALUES (${event.id}, ${event.kind}, ${event.sourceIssueId}, ${event.targetIssueId}, ${Schema.encodeSync(ActorJson)(event.actor)}, ${Schema.encodeSync(AgentSessionJson)(event.agentSession)}, ${event.createdAt})`;
        yield* sql`INSERT INTO timeline_entries (issue_id, position, event_id) VALUES (${issue.id}, 1, ${event.id})`;
        yield* sql`INSERT INTO project_idempotency_keys (idempotency_key, result_type, issue_id) VALUES (${idempotencyKey}, 'issue_creation', ${issue.id})`;
      },
      Effect.catchTag("SqlError", unavailable("insertIssueCreation")),
    ),
    allocateTimelinePosition: Effect.fn("ProjectSqliteState.allocateTimelinePosition")(
      function* (issueId) {
        const row =
          (yield* sql<NumberRow>`UPDATE issues SET next_timeline_position = next_timeline_position + 1 WHERE id = ${issueId} RETURNING next_timeline_position - 1 AS value`)[0];
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
        yield* sql`INSERT INTO issue_references (source_issue_id, target_issue_id) VALUES (${reference.sourceIssueId}, ${reference.targetIssueId})`;
        yield* sql`INSERT INTO timeline_events (id, kind, source_issue_id, target_issue_id, actor_json, agent_session_json, created_at) VALUES (${event.id}, ${event.kind}, ${event.sourceIssueId}, ${event.targetIssueId}, ${Schema.encodeSync(ActorJson)(event.actor)}, ${Schema.encodeSync(AgentSessionJson)(event.agentSession)}, ${event.createdAt})`;
        yield* sql`INSERT INTO timeline_entries (issue_id, position, event_id) VALUES (${reference.sourceIssueId}, ${sourcePosition}, ${event.id})`;
        yield* sql`INSERT INTO timeline_entries (issue_id, position, event_id) VALUES (${reference.targetIssueId}, ${targetPosition}, ${event.id})`;
      },
      Effect.catchTag("SqlError", unavailable("insertIssueReference")),
    ),
    readIssueRevisions: Effect.fn("ProjectSqliteState.readIssueRevisions")(
      function* (issueId) {
        const rows =
          yield* sql<RevisionRow>`SELECT field, revision_number, value, actor_json, agent_session_json, created_at FROM issue_revisions WHERE issue_id = ${issueId} ORDER BY field, revision_number`;
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
        const rows =
          yield* sql<TimelineRow>`SELECT te.position, ev.id, ev.kind, ev.source_issue_id, ev.target_issue_id, ev.actor_json, ev.agent_session_json, ev.created_at FROM timeline_entries te JOIN timeline_events ev ON ev.id = te.event_id WHERE te.issue_id = ${issueId} ORDER BY te.position`;
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
              ? { ...eventAttribution, kind: "issue_created", targetIssueId: null }
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
        const outgoingRows =
          yield* sql<ReferenceRow>`SELECT source_issue_id, target_issue_id FROM issue_references WHERE source_issue_id = ${issueId} ORDER BY target_issue_id`;
        const incomingRows =
          yield* sql<ReferenceRow>`SELECT source_issue_id, target_issue_id FROM issue_references WHERE target_issue_id = ${issueId} ORDER BY source_issue_id`;
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
