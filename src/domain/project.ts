import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { ProjectId, WorkspaceId } from "./entity-id.ts";

const hasMinimumLength = Schema.makeFilter((name: string) => Array.from(name).length >= 1, {
  expected: "at least 1 Unicode character",
  meta: { _tag: "isMinLength", minLength: 1 },
});
const hasMaximumLength = Schema.makeFilter((name: string) => Array.from(name).length <= 200, {
  expected: "at most 200 Unicode characters",
  meta: { _tag: "isMaxLength", maxLength: 200 },
});
const containsNonWhitespace = Schema.isPattern(/\S/u);
const isSingleLineWithoutControls = Schema.isPattern(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u);
const isCanonicalUtcTimestamp = Schema.makeFilter(
  (value: string) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  },
  { expected: "a valid canonical UTC RFC 3339 timestamp" },
);

/** Exact, nonblank, single-line display name for a Project. */
export const ProjectName = Schema.String.check(
  hasMinimumLength,
  hasMaximumLength,
  containsNonWhitespace,
  isSingleLineWithoutControls,
).pipe(Schema.brand("ProjectName"));

/** Exact, nonblank, single-line display name for a Project. */
export type ProjectName = typeof ProjectName.Type;

/** UTC RFC 3339 timestamp used by Project persistence. */
export const ProjectTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  isCanonicalUtcTimestamp,
).pipe(Schema.brand("ProjectTimestamp"));

/** UTC RFC 3339 timestamp used by Project persistence. */
export type ProjectTimestamp = typeof ProjectTimestamp.Type;

/** Active Project state persisted by the Workspace Registry. */
export const Project = Schema.Struct({
  id: ProjectId,
  workspaceId: WorkspaceId,
  name: ProjectName,
  lifecycle: Schema.Literal("active"),
  createdAt: ProjectTimestamp,
  updatedAt: ProjectTimestamp,
});

/** Active Project state persisted by the Workspace Registry. */
export interface Project extends Schema.Schema.Type<typeof Project> {}

/** Choose a Project update timestamp that strictly advances persisted time. */
export function advanceProjectTimestamp(
  current: ProjectTimestamp,
  candidate: ProjectTimestamp,
): ProjectTimestamp {
  if (candidate > current) return candidate;
  return ProjectTimestamp.make(
    DateTime.makeUnsafe(current).pipe(DateTime.add({ milliseconds: 1 }), DateTime.formatIso),
  );
}
