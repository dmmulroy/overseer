import {
  DiscoveryDocument,
  DiscoveryPaths,
  ProjectSchemaPaths,
  SchemaIndex,
  WorkspaceSchemaPaths,
} from "./http-api.ts";
/** Build the stable API discovery response body. */
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
      { href: ProjectSchemaPaths.create },
      { href: ProjectSchemaPaths.rename },
      { href: ProjectSchemaPaths.move },
    ],
    links: {
      self: { href: DiscoveryPaths.schemas },
      openapi: { href: DiscoveryPaths.openapi },
    },
  });
}
