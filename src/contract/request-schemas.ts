import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { IdempotencyKey } from "../domain/idempotency.ts";
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

const createWorkspaceRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({
    headers: Schema.Struct({ "idempotency-key": IdempotencyKey }),
    body: WorkspaceNameRequest,
  }),
).schema;
const renameWorkspaceRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({ body: WorkspaceNameRequest }),
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
const requestSchemas = [createWorkspace, renameWorkspace] as const;

/** Content-addressed request-schema paths derived from their schema documents. */
export const WorkspaceSchemaPaths = {
  create: createWorkspace.path,
  rename: renameWorkspace.path,
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
