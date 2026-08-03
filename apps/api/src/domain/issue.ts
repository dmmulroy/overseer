import { Schema } from "effect";
import { Project } from "./project.ts";
import { Ulid } from "./ulid.ts";

/** Stable Issue identity composed of the `issue_` prefix and a canonical ULID. */
export const IssueId = Schema.TemplateLiteral(["issue_", Ulid]).pipe(Schema.brand("IssueId"));

/** Stable Issue identity. */
export type IssueId = typeof IssueId.Type;

/** Workflow state retained by an Issue server. */
export const IssueState = Schema.Literals(["open", "blocked", "closed"]);

/** Issue workflow state. */
export type IssueState = typeof IssueState.Type;

/** Issue domain entity owned by one Project. */
export const Issue = Schema.Struct({
  id: IssueId,
  projectId: Project.fields.id,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.OptionFromNullOr(Schema.String),
  state: IssueState,
  blockedBy: Schema.OptionFromNullOr(IssueId),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

/** Parsed Issue domain entity. */
export interface Issue extends Schema.Schema.Type<typeof Issue> {}
