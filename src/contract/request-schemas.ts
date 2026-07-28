import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { WorkspaceId } from "../domain/entity-id.ts";
import { IdempotencyKey } from "../domain/idempotency.ts";
import { IssueBody, IssueTitle } from "../domain/issue.ts";
import { ProjectName } from "../domain/project.ts";
import { WorkspaceName } from "../domain/workspace.ts";

/** Body accepted when creating or renaming a Workspace. */
export const WorkspaceNameRequest = Schema.Struct({ name: WorkspaceName }).pipe(
  Schema.flip,
  Schema.check(
    Schema.makeFilter((body) => Object.keys(body).length === 1, {
      expected: "an object containing only the name field",
    }),
  ),
  Schema.flip,
);

/** Body accepted when creating or renaming a Workspace. */
export interface WorkspaceNameRequest extends Schema.Schema.Type<typeof WorkspaceNameRequest> {}

/** Body accepted when creating or renaming a Project. */
export const ProjectNameRequest = Schema.Struct({ name: ProjectName }).pipe(
  Schema.flip,
  Schema.check(
    Schema.makeFilter((body) => Object.keys(body).length === 1, {
      expected: "an object containing only the name field",
    }),
  ),
  Schema.flip,
);

/** Body accepted when creating or renaming a Project. */
export interface ProjectNameRequest extends Schema.Schema.Type<typeof ProjectNameRequest> {}

/** Body accepted when moving a Project to another Workspace. */
export const MoveProjectRequest = Schema.Struct({ workspace_id: WorkspaceId }).pipe(
  Schema.flip,
  Schema.check(
    Schema.makeFilter((body) => Object.keys(body).length === 1, {
      expected: "an object containing only the workspace_id field",
    }),
  ),
  Schema.flip,
);

/** Body accepted when moving a Project to another Workspace. */
export interface MoveProjectRequest extends Schema.Schema.Type<typeof MoveProjectRequest> {}

/** Body accepted when creating an Issue with optional Markdown. */
export const CreateIssueRequest = Schema.Struct({
  title: IssueTitle,
  body: Schema.optionalKey(Schema.NullOr(IssueBody)),
}).pipe(
  Schema.flip,
  Schema.check(
    Schema.makeFilter(
      (body) => Object.keys(body).every((key) => key === "title" || key === "body"),
      {
        expected: "an object containing only title and optional body fields",
      },
    ),
  ),
  Schema.flip,
);

/** Body accepted when creating an Issue with optional Markdown. */
export interface CreateIssueRequest extends Schema.Schema.Type<typeof CreateIssueRequest> {}

const createWorkspaceRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({
    headers: Schema.Struct({ "idempotency-key": IdempotencyKey }),
    body: WorkspaceNameRequest,
  }),
).schema;
const renameWorkspaceRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({ body: WorkspaceNameRequest }),
).schema;
const createProjectRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({
    headers: Schema.Struct({ "idempotency-key": IdempotencyKey }),
    body: ProjectNameRequest,
  }),
).schema;
const renameProjectRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({ body: ProjectNameRequest }),
).schema;
const moveProjectRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({
    headers: Schema.Struct({ "idempotency-key": IdempotencyKey }),
    body: MoveProjectRequest,
  }),
).schema;
const createIssueRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({
    headers: Schema.Struct({ "idempotency-key": IdempotencyKey }),
    body: CreateIssueRequest,
  }),
).schema;
const JsonString = Schema.fromJsonString(Schema.Json);

function canonicalize(value: Schema.Json): Schema.Json {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function contentHash(document: unknown): string {
  const json = canonicalize(Schema.decodeUnknownSync(Schema.Json)(document));
  const encoded = Schema.encodeSync(JsonString)(json);
  return `sha256-${bytesToHex(sha256(utf8ToBytes(encoded)))}`;
}

function requestSchema(name: string, document: Readonly<Record<string, unknown>>) {
  const hash = contentHash(document);
  return {
    name,
    hash,
    path: `/api/schemas/${hash}/${name}`,
    document,
  };
}

const createWorkspace = requestSchema("create_workspace", createWorkspaceRequestSchema);
const renameWorkspace = requestSchema("rename_workspace", renameWorkspaceRequestSchema);
const createProject = requestSchema("create_project", createProjectRequestSchema);
const renameProject = requestSchema("rename_project", renameProjectRequestSchema);
const moveProject = requestSchema("move_project", moveProjectRequestSchema);
const createIssue = requestSchema("create_issue", createIssueRequestSchema);
const requestSchemas = [
  createWorkspace,
  renameWorkspace,
  createProject,
  renameProject,
  moveProject,
  createIssue,
] as const;

/** Content-addressed request-schema paths derived from their schema documents. */
export const WorkspaceSchemaPaths = {
  create: createWorkspace.path,
  rename: renameWorkspace.path,
} as const;

/** Content-addressed Issue request-schema paths. */
export const IssueSchemaPaths = {
  create: createIssue.path,
} as const;

/** Content-addressed Project request-schema paths. */
export const ProjectSchemaPaths = {
  create: createProject.path,
  rename: renameProject.path,
  move: moveProject.path,
} as const;

/** Build a published request schema when the content hash and name match. */
export function requestSchemaDocument(
  hash: string,
  name: string,
): Option.Option<Readonly<Record<string, unknown>>> {
  const found = requestSchemas.find((entry) => entry.hash === hash && entry.name === name);
  return found === undefined
    ? Option.none()
    : Option.some({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: found.path,
        ...found.document,
      });
}
