import * as Schema from "effect/Schema";
import { WorkspaceId } from "./entity-id.ts";

const hasMinimumLength = Schema.makeFilter(
  (name: string) => Array.from(name).length >= 1,
  {
    expected: "at least 1 Unicode character",
    meta: { _tag: "isMinLength", minLength: 1 },
  },
);
const hasMaximumLength = Schema.makeFilter(
  (name: string) => Array.from(name).length <= 200,
  {
    expected: "at most 200 Unicode characters",
    meta: { _tag: "isMaxLength", maxLength: 200 },
  },
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

/** Exact, nonblank, single-line display name for a Workspace. */
export const WorkspaceName = Schema.String.check(
  hasMinimumLength,
  hasMaximumLength,
  containsNonWhitespace,
  isSingleLineWithoutControls,
).pipe(Schema.brand("WorkspaceName"));

/** Exact, nonblank, single-line display name for a Workspace. */
export type WorkspaceName = typeof WorkspaceName.Type;

/** UTC RFC 3339 timestamp used by Workspace persistence. */
export const WorkspaceTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  isCanonicalUtcTimestamp,
).pipe(Schema.brand("WorkspaceTimestamp"));

/** UTC RFC 3339 timestamp used by Workspace persistence. */
export type WorkspaceTimestamp = typeof WorkspaceTimestamp.Type;

/** Active Workspace state persisted by the Catalog. */
export const Workspace = Schema.Struct({
  id: WorkspaceId,
  name: WorkspaceName,
  lifecycle: Schema.Literal("active"),
  createdAt: WorkspaceTimestamp,
  updatedAt: WorkspaceTimestamp,
});

/** Active Workspace state persisted by the Catalog. */
export interface Workspace extends Schema.Schema.Type<typeof Workspace> {}

