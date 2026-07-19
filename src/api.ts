import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

/** One Issue representation used by the prototype wire contract. */
export const IssueSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  current_title_revision: Schema.Number,
  updated_at: Schema.String,
});

/** Decoded Issue representation. */
export type Issue = typeof IssueSchema.Type;

/** One exact Project Issue-list page. */
export const IssueCollectionSchema = Schema.Struct({
  items: Schema.Array(IssueSchema),
  links: Schema.Struct({
    self: Schema.Struct({ href: Schema.String }),
  }),
});

/** Decoded Project Issue-list page. */
export type IssueCollection = typeof IssueCollectionSchema.Type;

/** Actionable problem response used by the failure lab. */
export const ProblemSchema = Schema.Struct({
  type: Schema.String,
  title: Schema.String,
  status: Schema.Number,
  code: Schema.String,
  detail: Schema.String,
  request_id: Schema.String,
  retryable: Schema.Boolean,
}).pipe(HttpApiSchema.status(503));

/** Decoded actionable problem response. */
export type Problem = typeof ProblemSchema.Type;

const NotModifiedSchema = HttpApiSchema.Empty(304);
const ConditionalHeaders = {
  "if-none-match": Schema.optionalKey(Schema.String),
};

const Issues = HttpApiGroup.make("issues")
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:projectId/issues", {
      params: { projectId: Schema.String },
      headers: ConditionalHeaders,
      success: [IssueCollectionSchema, NotModifiedSchema],
      error: ProblemSchema,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", "/api/issues/:issueId", {
      params: { issueId: Schema.String },
      headers: ConditionalHeaders,
      success: [IssueSchema, NotModifiedSchema],
      error: ProblemSchema,
    }),
  )
  .add(
    HttpApiEndpoint.patch("update", "/api/issues/:issueId", {
      params: { issueId: Schema.String },
      payload: Schema.Struct({ title: Schema.String }),
      success: IssueSchema,
      error: ProblemSchema,
    }),
  )
  .add(
    HttpApiEndpoint.post("close", "/api/issues/:issueId/close", {
      params: { issueId: Schema.String },
      headers: { "idempotency-key": Schema.String },
      success: IssueSchema,
      error: ProblemSchema,
    }),
  )
  .add(
    HttpApiEndpoint.post("reopen", "/api/issues/:issueId/reopen", {
      params: { issueId: Schema.String },
      headers: { "idempotency-key": Schema.String },
      success: IssueSchema,
      error: ProblemSchema,
    }),
  );

/** Shared Effect HTTP declaration from which the browser client is generated. */
export const OverseerApi = HttpApi.make("OverseerApi").add(Issues);
