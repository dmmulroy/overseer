import { DiscoveryDocument, SchemaIndex } from "./http-api.ts";

/** Build the stable API discovery representation. */
export function discoveryDocument(): DiscoveryDocument {
  return DiscoveryDocument.make({
    name: "Overseer",
    links: {
      self: { href: "/api" },
      workspaces: { href: "/api/workspaces" },
      projects: { href: "/api/projects" },
      schemas: { href: "/api/schemas" },
      openapi: { href: "/api/openapi.json" },
    },
  });
}

/** Build the content-addressed request-schema index. */
export function schemaIndex(): SchemaIndex {
  return SchemaIndex.make({
    items: [],
    links: {
      self: { href: "/api/schemas" },
      openapi: { href: "/api/openapi.json" },
    },
  });
}
