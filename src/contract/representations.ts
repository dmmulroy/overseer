import {
  DiscoveryDocument,
  DiscoveryPaths,
  SchemaIndex,
} from "./http-api.ts";

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
    items: [],
    links: {
      self: { href: DiscoveryPaths.schemas },
      openapi: { href: DiscoveryPaths.openapi },
    },
  });
}
