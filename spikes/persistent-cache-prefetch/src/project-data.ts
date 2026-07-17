import { Schema } from "effect";

/** Deployment identity used to partition the throwaway cache. */
export const DEPLOYMENT = "local-spike";
/** Authenticated identity used to partition the throwaway cache. */
export const IDENTITY = "human:dmmulroy";
/** Representative seeded Project identity. */
export const PROJECT_ID = "project-seeded";
/** Number of Issues in the representative Project. */
export const PROJECT_ISSUE_COUNT = 400;

/** One cached timeline item. */
export const TimelineItem = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
});
/** Runtime type for one cached timeline item. */
export type TimelineItem = typeof TimelineItem.Type;

/** Canonical Issue snapshot stored by the sync submodel. */
export const IssueSnapshot = Schema.Struct({
  key: Schema.String,
  projectId: Schema.String,
  issueNumber: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  version: Schema.Number,
  eventSequence: Schema.Number,
  cachedAt: Schema.Number,
  accessedAt: Schema.Number,
  byteSize: Schema.Number,
});
/** Runtime type for a canonical Issue snapshot. */
export type IssueSnapshot = typeof IssueSnapshot.Type;

/** First cached timeline page for one Issue. */
export const TimelinePage = Schema.Struct({
  key: Schema.String,
  issueKey: Schema.String,
  page: Schema.Number,
  items: Schema.Array(TimelineItem),
  accessedAt: Schema.Number,
  byteSize: Schema.Number,
});
/** Runtime type for a first timeline page. */
export type TimelinePage = typeof TimelinePage.Type;

/** Cached membership of one structured query. */
export const QueryMembership = Schema.Struct({
  key: Schema.String,
  issueNumbers: Schema.Array(Schema.Number),
  accessedAt: Schema.Number,
  byteSize: Schema.Number,
});
/** Runtime type for a cached query membership. */
export type QueryMembership = typeof QueryMembership.Type;

/** One REST read containing canonical Issue detail and its first timeline page. */
export const IssueRead = Schema.Struct({
  snapshot: IssueSnapshot,
  timeline: TimelinePage,
});
/** Runtime type for one parsed REST Issue read. */
export type IssueRead = typeof IssueRead.Type;

/** Durable last-applied Project event sequence. */
export const ProjectCursor = Schema.Struct({
  projectId: Schema.String,
  sequence: Schema.Number,
});
/** Runtime type for a Project event cursor. */
export type ProjectCursor = typeof ProjectCursor.Type;

/** A local Markdown draft, stored independently from canonical cache data. */
export const Draft = Schema.Struct({
  key: Schema.String,
  projectId: Schema.String,
  issueNumber: Schema.Number,
  markdown: Schema.String,
  updatedAt: Schema.Number,
});
/** Runtime type for a migrated draft. */
export type Draft = typeof Draft.Type;

/** Legacy draft shape used solely to exercise the draft migration. */
export const LegacyDraft = Schema.Struct({
  key: Schema.String,
  projectId: Schema.String,
  issueNumber: Schema.Number,
  markdown: Schema.String,
});
/** Runtime type for a legacy draft. */
export type LegacyDraft = typeof LegacyDraft.Type;

/** A self-contained title change in the Project event stream. */
export const IssueTitleChanged = Schema.Struct({
  _tag: Schema.Literal("IssueTitleChanged"),
  projectId: Schema.String,
  issueNumber: Schema.Number,
  sequence: Schema.Number,
  title: Schema.String,
  version: Schema.Number,
});
/** Runtime type for a self-contained Project event. */
export type IssueTitleChanged = typeof IssueTitleChanged.Type;

/** Stable key for one scoped Issue snapshot. */
export function issueKey(issueNumber: number): string {
  return `${DEPLOYMENT}|${IDENTITY}|${PROJECT_ID}|${issueNumber}`;
}

/** Build one deterministic representative Issue snapshot. */
export function makeIssueSnapshot(issueNumber: number, now = Date.now()): IssueSnapshot {
  const body = `Issue ${issueNumber} body. ${"Representative seeded content. ".repeat(48)}`;
  return {
    key: issueKey(issueNumber),
    projectId: PROJECT_ID,
    issueNumber,
    title: `Seeded Issue ${issueNumber}`,
    body,
    version: 10,
    eventSequence: 10,
    cachedAt: now,
    accessedAt: now,
    byteSize: body.length * 2 + 256,
  };
}

/** Build the first representative timeline page for one Issue. */
export function makeTimelinePage(issueNumber: number, now = Date.now()): TimelinePage {
  const items = Array.from({ length: 20 }, (_, index) => ({
    id: `${issueNumber}:${index + 1}`,
    body: `Timeline entry ${index + 1} for Issue ${issueNumber}. ${"History. ".repeat(12)}`,
  }));
  return {
    key: `${issueKey(issueNumber)}|timeline|1`,
    issueKey: issueKey(issueNumber),
    page: 1,
    items,
    accessedAt: now,
    byteSize: JSON.stringify(items).length * 2,
  };
}
