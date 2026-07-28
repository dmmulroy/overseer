import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Miniflare } from "miniflare";
import { SchemaIndex } from "../../src/contract/http-api.ts";
import { startGateway } from "../fixtures/gateway.ts";

const issuer = "https://overseer-test.cloudflareaccess.com";
const audience = "overseer-test-audience";
let gateway: Miniflare;
let privateKey: CryptoKey;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  const { publicKey } = keyPair;
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(publicKey);
  gateway = await startGateway({
    accessAudience: audience,
    accessIssuer: issuer,
    accessJwks: JSON.stringify({ keys: [{ ...publicJwk, alg: "RS256", kid: "test" }] }),
    allowedOrigin: "https://overseer.test",
  });
});

afterAll(async () => {
  await gateway?.dispose();
});

async function humanAssertion(): Promise<string> {
  return new SignJWT({ email: "owner@example.com", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "test", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("human-subject")
    .setIssuedAt()
    .setNotBefore("-1 second")
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}

async function agentAssertion(): Promise<string> {
  return new SignJWT({ common_name: "agent-client-id.access", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "test", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  );
}

function requestSchemaContentHash(document: object): string {
  const content = Object.fromEntries(
    Object.entries(document).filter(([key]) => key !== "$schema" && key !== "$id"),
  );
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeJson(content)))
    .digest("hex");
}

describe("authenticated API discovery", () => {
  it("rejects invalid Gateway configuration before authentication", async () => {
    const invalidGateway = await startGateway({
      accessAudience: "",
      accessIssuer: "not-an-origin",
      accessJwks: JSON.stringify({ keys: [] }),
      allowedOrigin: "not-an-origin",
    });
    try {
      const response = await invalidGateway.dispatchFetch("https://overseer.test/api");
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "gateway_unavailable",
        retryable: true,
      });
    } finally {
      await invalidGateway.dispose();
    }
  });

  it("discloses only a safe problem when the Access assertion is missing", async () => {
    const response = await gateway.dispatchFetch("https://overseer.test/api");

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("www-authenticate")).toBe("Cloudflare-Access");
    await expect(response.json()).resolves.toMatchObject({
      type: "https://overseer.test/problems/authentication_required",
      title: "Authentication required",
      status: 401,
      code: "authentication_required",
      retryable: false,
    });
  });

  it("rejects forged and non-expiring Access assertions before protected discovery", async () => {
    const forged = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: { "cf-access-jwt-assertion": "forged.assertion.value" },
    });

    expect(forged.status).toBe(401);
    expect(await forged.text()).not.toContain("/api/workspaces");

    const nonExpiring = await new SignJWT({ email: "owner@example.com", type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "test", typ: "JWT" })
      .setAudience(audience)
      .setIssuer(issuer)
      .setSubject("human-subject")
      .setIssuedAt()
      .sign(privateKey);
    const missingExpiry = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: { "cf-access-jwt-assertion": nonExpiring },
    });
    expect(missingExpiry.status).toBe(401);
  });

  it("returns a retryable problem when Access verification is unavailable", async () => {
    const unavailableGateway = await startGateway({
      accessAudience: audience,
      accessIssuer: issuer,
      accessJwks: "not-json",
      allowedOrigin: "https://overseer.test",
    });
    try {
      const response = await unavailableGateway.dispatchFetch("https://overseer.test/api", {
        headers: { "cf-access-jwt-assertion": await humanAssertion() },
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "authentication_unavailable",
        retryable: true,
      });
    } finally {
      await unavailableGateway.dispose();
    }
  });

  it("enforces human Origin and Agent-session metadata before unsafe routing", async () => {
    const human = await gateway.dispatchFetch("https://overseer.test/api", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": await humanAssertion() },
    });
    expect(human.status).toBe(403);
    await expect(human.json()).resolves.toMatchObject({ code: "origin_not_allowed" });

    const agent = await gateway.dispatchFetch("https://overseer.test/api", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": await agentAssertion() },
    });
    expect(agent.status).toBe(400);
    await expect(agent.json()).resolves.toMatchObject({ code: "agent_session_required" });

    const admittedAgent = await gateway.dispatchFetch("https://overseer.test/api", {
      method: "POST",
      headers: {
        "cf-access-jwt-assertion": await agentAssertion(),
        "overseer-harness": "pi",
        "overseer-session-id": "session-54",
      },
    });
    expect(admittedAgent.status).toBe(405);
    await expect(admittedAgent.json()).resolves.toMatchObject({ code: "method_not_allowed" });
  });

  it("supports HEAD and ETag validation of an exact response body", async () => {
    const assertion = await humanAssertion();
    const first = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: { "cf-access-jwt-assertion": assertion },
    });
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();

    const head = await gateway.dispatchFetch("https://overseer.test/api", {
      method: "HEAD",
      headers: { "cf-access-jwt-assertion": assertion },
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(await head.text()).toBe("");

    const unchanged = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: {
        "cf-access-jwt-assertion": assertion,
        "if-none-match": etag ?? "",
      },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("etag")).toBe(etag);
    expect(await unchanged.text()).toBe("");

    const weakList = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: {
        "cf-access-jwt-assertion": assertion,
        "if-none-match": `"different", W/${etag ?? ""}`,
      },
    });
    expect(weakList.status).toBe(304);

    const wildcard = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: {
        "cf-access-jwt-assertion": assertion,
        "if-none-match": "*",
      },
    });
    expect(wildcard.status).toBe(304);
  });

  it("returns safe problems for unacceptable media, unknown routes, and methods", async () => {
    const assertion = await humanAssertion();
    const unacceptable = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: {
        accept: "text/html",
        "cf-access-jwt-assertion": assertion,
      },
    });
    expect(unacceptable.status).toBe(406);
    expect(unacceptable.headers.get("content-type")).toBe("application/problem+json");
    await expect(unacceptable.json()).resolves.toMatchObject({
      code: "response_type_not_acceptable",
      status: 406,
      retryable: false,
    });

    const excludedJson = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: {
        accept: "application/json;q=0, */*;q=1",
        "cf-access-jwt-assertion": assertion,
      },
    });
    expect(excludedJson.status).toBe(406);

    const wrongVendor = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: {
        accept: "application/problem+json",
        "cf-access-jwt-assertion": assertion,
      },
    });
    expect(wrongVendor.status).toBe(406);

    const wrongOpenApiVersion = await gateway.dispatchFetch(
      "https://overseer.test/api/openapi.json",
      {
        headers: {
          accept: "application/vnd.oai.openapi+json;version=3.0",
          "cf-access-jwt-assertion": assertion,
        },
      },
    );
    expect(wrongOpenApiVersion.status).toBe(406);

    const laterAcceptableRange = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: {
        accept: "application/json;q=0, application/json;q=1",
        "cf-access-jwt-assertion": assertion,
      },
    });
    expect(laterAcceptableRange.status).toBe(200);

    const quotedOpenApiVersion = await gateway.dispatchFetch(
      "https://overseer.test/api/openapi.json",
      {
        headers: {
          accept: 'application/vnd.oai.openapi+json;version="3.1"',
          "cf-access-jwt-assertion": assertion,
        },
      },
    );
    expect(quotedOpenApiVersion.status).toBe(200);

    const acceptExtension = await gateway.dispatchFetch("https://overseer.test/api/openapi.json", {
      headers: {
        accept: "application/vnd.oai.openapi+json;version=3.1;q=0.8;profile=agent",
        "cf-access-jwt-assertion": assertion,
      },
    });
    expect(acceptExtension.status).toBe(200);

    const missing = await gateway.dispatchFetch("https://overseer.test/api/missing", {
      headers: { "cf-access-jwt-assertion": assertion },
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "resource_not_found" });

    for (const method of ["GET", "HEAD"]) {
      const emptySchemaSegment = await gateway.dispatchFetch(
        "https://overseer.test/api/schemas//create_workspace",
        {
          method,
          headers: { "cf-access-jwt-assertion": assertion },
        },
      );
      expect(emptySchemaSegment.status).toBe(404);
      expect(emptySchemaSegment.headers.get("cache-control")).toBe("no-store");
      expect(emptySchemaSegment.headers.get("content-type")).toBe("application/problem+json");
      expect(emptySchemaSegment.headers.get("x-request-id")).toMatch(/^request_/);
      if (method === "GET") {
        await expect(emptySchemaSegment.json()).resolves.toMatchObject({
          code: "resource_not_found",
          status: 404,
        });
      } else {
        expect(await emptySchemaSegment.text()).toBe("");
      }
    }

    const wrongMethod = await gateway.dispatchFetch("https://overseer.test/api", {
      method: "POST",
      headers: {
        "cf-access-jwt-assertion": assertion,
        origin: "https://overseer.test",
      },
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET, HEAD");
    await expect(wrongMethod.json()).resolves.toMatchObject({ code: "method_not_allowed" });
  });

  it("publishes schema discovery and OpenAPI from the shared contract", async () => {
    const assertion = await humanAssertion();
    const schemas = await gateway.dispatchFetch("https://overseer.test/api/schemas", {
      headers: {
        accept: "application/json",
        "cf-access-jwt-assertion": assertion,
      },
    });
    expect(schemas.status).toBe(200);
    expect(schemas.headers.get("etag")).not.toBeNull();
    const schemaIndex = Schema.decodeUnknownSync(SchemaIndex)(await schemas.json());
    expect(schemaIndex).toMatchObject({
      items: [
        { href: expect.stringMatching(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/create_workspace$/) },
        { href: expect.stringMatching(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/rename_workspace$/) },
        { href: expect.stringMatching(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/create_project$/) },
        { href: expect.stringMatching(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/rename_project$/) },
        { href: expect.stringMatching(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/move_project$/) },
        { href: expect.stringMatching(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/create_issue$/) },
      ],
      links: {
        self: { href: "/api/schemas" },
        openapi: { href: "/api/openapi.json" },
      },
    });
    const requestSchema = await gateway.dispatchFetch(
      `https://overseer.test${schemaIndex.items[0]?.href ?? ""}`,
      { headers: { "cf-access-jwt-assertion": assertion } },
    );
    expect(requestSchema.status).toBe(200);
    expect(requestSchema.headers.get("content-type")).toBe("application/schema+json");
    expect(requestSchema.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const schemaDocument: unknown = await requestSchema.json();
    expect(schemaDocument).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        headers: { properties: { "idempotency-key": { type: "string" } } },
        body: { properties: { name: { type: "string" } } },
      },
    });
    if (typeof schemaDocument !== "object" || schemaDocument === null) {
      throw new Error("Request schema response was not an object");
    }
    const contentHash = requestSchemaContentHash(schemaDocument);
    expect(schemaIndex.items[0]?.href).toContain(`/sha256-${contentHash}/`);

    for (const method of ["GET", "HEAD"]) {
      const unknownSchema = await gateway.dispatchFetch(
        `https://overseer.test/api/schemas/sha256-${"0".repeat(64)}/unknown_schema`,
        {
          method,
          headers: { "cf-access-jwt-assertion": assertion },
        },
      );
      expect(unknownSchema.status).toBe(404);
      expect(unknownSchema.headers.get("cache-control")).toBe("no-store");
      expect(unknownSchema.headers.get("content-type")).toBe("application/problem+json");
      expect(unknownSchema.headers.get("x-request-id")).toMatch(/^request_/);
      if (method === "GET") {
        await expect(unknownSchema.json()).resolves.toMatchObject({
          code: "resource_not_found",
          status: 404,
        });
      } else {
        expect(await unknownSchema.text()).toBe("");
      }
    }

    const renameSchema = await gateway.dispatchFetch(
      `https://overseer.test${schemaIndex.items[1]?.href ?? ""}`,
      { headers: { "cf-access-jwt-assertion": assertion } },
    );
    const renameDocument: unknown = await renameSchema.json();
    if (typeof renameDocument !== "object" || renameDocument === null) {
      throw new Error("Rename schema response was not an object");
    }
    const renameContentHash = requestSchemaContentHash(renameDocument);
    expect(schemaIndex.items[1]?.href).toContain(`/sha256-${renameContentHash}/`);

    const moveSchema = await gateway.dispatchFetch(
      `https://overseer.test${schemaIndex.items[4]?.href ?? ""}`,
      { headers: { "cf-access-jwt-assertion": assertion } },
    );
    expect(await moveSchema.json()).toMatchObject({
      properties: {
        headers: { properties: { "idempotency-key": { type: "string" } } },
        body: { properties: { workspace_id: { type: "string" } } },
      },
    });

    const openapi = await gateway.dispatchFetch("https://overseer.test/api/openapi.json", {
      headers: {
        accept: "application/vnd.oai.openapi+json;version=3.1",
        "cf-access-jwt-assertion": assertion,
      },
    });
    expect(openapi.status).toBe(200);
    expect(openapi.headers.get("content-type")).toBe(
      "application/vnd.oai.openapi+json;version=3.1",
    );
    expect(openapi.headers.get("etag")).not.toBeNull();
    const openApiJson = await openapi.json();
    await expect(Promise.resolve(openApiJson)).resolves.toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/api": { get: {}, head: {} },
        "/api/schemas": { get: {}, head: {} },
        "/api/projects": { get: {}, head: {} },
        "/api/projects/{project_id}": { get: {}, head: {}, patch: {} },
        "/api/projects/{project_id}/move": { post: {} },
        "/api/workspaces/{workspace_id}/projects": { get: {}, head: {}, post: {} },
        "/api/openapi.json": {
          get: {
            security: [{ cloudflareAccess: [] }],
            responses: {
              "200": {
                content: {
                  "application/vnd.oai.openapi+json;version=3.1": {},
                },
              },
              "304": {},
              "401": {
                content: {
                  "application/problem+json": {},
                },
              },
            },
          },
          head: {
            security: [{ cloudflareAccess: [] }],
            responses: {
              "304": {},
              "401": {
                content: {
                  "application/problem+json": {},
                },
              },
            },
          },
        },
      },
    });

    const openApiPaths = Schema.decodeUnknownSync(
      Schema.Struct({ paths: Schema.Record(Schema.String, Schema.Unknown) }),
    )(openApiJson).paths;
    const workspaceOperations = Schema.decodeUnknownSync(
      Schema.Struct({
        get: Schema.Struct({ responses: Schema.Record(Schema.String, Schema.Unknown) }),
        post: Schema.Struct({ responses: Schema.Record(Schema.String, Schema.Unknown) }),
      }),
    )(openApiPaths["/api/workspaces"]);
    expect(Object.keys(workspaceOperations.get.responses).sort()).toEqual([
      "200",
      "304",
      "400",
      "401",
      "406",
      "500",
      "503",
    ]);
    expect(Object.keys(workspaceOperations.post.responses).sort()).toEqual([
      "201",
      "400",
      "401",
      "403",
      "409",
      "413",
      "415",
      "422",
      "500",
      "503",
    ]);
    expect(workspaceOperations.post.responses["413"]).toMatchObject({
      content: {
        "application/problem+json": {
          schema: { properties: { status: { enum: [413] } } },
        },
      },
    });

    const projectMoveOperations = Schema.decodeUnknownSync(
      Schema.Struct({
        post: Schema.Struct({ responses: Schema.Record(Schema.String, Schema.Unknown) }),
      }),
    )(openApiPaths["/api/projects/{project_id}/move"]);
    expect(Object.keys(projectMoveOperations.post.responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "413",
      "415",
      "422",
      "500",
      "503",
    ]);

    const workspaceItemOperations = Schema.decodeUnknownSync(
      Schema.Struct({
        get: Schema.Struct({ responses: Schema.Record(Schema.String, Schema.Unknown) }),
        patch: Schema.Struct({ responses: Schema.Record(Schema.String, Schema.Unknown) }),
      }),
    )(openApiPaths["/api/workspaces/{workspace_id}"]);
    expect(Object.keys(workspaceItemOperations.get.responses).sort()).toEqual([
      "200",
      "304",
      "400",
      "401",
      "404",
      "406",
      "500",
      "503",
    ]);
    expect(Object.keys(workspaceItemOperations.patch.responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "413",
      "415",
      "422",
      "500",
      "503",
    ]);
  });

  it("discovers the stable Workspace, Project, schema, and OpenAPI resources", async () => {
    const response = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: {
        accept: "application/json",
        "cf-access-jwt-assertion": await humanAssertion(),
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    await expect(response.json()).resolves.toEqual({
      name: "Overseer",
      links: {
        self: { href: "/api" },
        workspaces: { href: "/api/workspaces" },
        projects: { href: "/api/projects" },
        schemas: { href: "/api/schemas" },
        openapi: { href: "/api/openapi.json" },
      },
    });
  });
});
