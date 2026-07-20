import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  DiscoveryDocument,
  DiscoveryPaths,
  SchemaIndex,
  WorkspaceNameRequest,
  WorkspaceSchemaPaths,
} from "./http-api.ts";
import { IdempotencyKey } from "../domain/idempotency.ts";

/** Build the stable API discovery representation. */
export function discoveryDocument(): DiscoveryDocument {
  return DiscoveryDocument.make({
    name: "Overseer",
    links: {
      self: { href: DiscoveryPaths.root },
      workspaces: { href: DiscoveryPaths.workspaces },
      projects: { href: DiscoveryPaths.projects },
      schemas: { href: DiscoveryPaths.schemas },
      openapi: { href: DiscoveryPaths.openapi },
    },
  });
}

/** Build the content-addressed request-schema index. */
export function schemaIndex(): SchemaIndex {
  return SchemaIndex.make({
    items: [
      { href: WorkspaceSchemaPaths.create },
      { href: WorkspaceSchemaPaths.rename },
    ],
    links: {
      self: { href: DiscoveryPaths.schemas },
      openapi: { href: DiscoveryPaths.openapi },
    },
  });
}

const createWorkspaceRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({
    headers: Schema.Struct({ "idempotency-key": IdempotencyKey }),
    body: WorkspaceNameRequest,
  }),
).schema;
const renameWorkspaceRequestSchema = Schema.toJsonSchemaDocument(
  Schema.Struct({ body: WorkspaceNameRequest }),
).schema;

/** Build a published Workspace request schema, when the path is known. */
export function requestSchemaDocument(
  contentHash: string,
  schemaName: string,
): Option.Option<Readonly<Record<string, unknown>>> {
  const href = `/api/schemas/${contentHash}/${schemaName}`;
  const schema = href === WorkspaceSchemaPaths.create
    ? Option.some(createWorkspaceRequestSchema)
    : href === WorkspaceSchemaPaths.rename
    ? Option.some(renameWorkspaceRequestSchema)
    : Option.none();
  return Option.map(schema, (document) => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: href,
    ...document,
  }));
}
