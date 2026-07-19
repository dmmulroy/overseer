import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
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
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}

describe("authenticated API discovery", () => {
  it("discloses only a safe problem when the Access assertion is missing", async () => {
    const response = await gateway.dispatchFetch("https://overseer.test/api");

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("www-authenticate")).toBe("Cloudflare-Access");
    await expect(response.json()).resolves.toMatchObject({
      type: "https://overseer.dev/problems/authentication_required",
      title: "Authentication required",
      status: 401,
      code: "authentication_required",
      retryable: false,
    });
  });

  it("rejects a forged Access assertion before protected discovery", async () => {
    const response = await gateway.dispatchFetch("https://overseer.test/api", {
      headers: { "cf-access-jwt-assertion": "forged.assertion.value" },
    });

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("/api/workspaces");
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

  it("supports HEAD and conditional validation of an exact representation", async () => {
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
      code: "representation_not_acceptable",
      status: 406,
      retryable: false,
    });

    const missing = await gateway.dispatchFetch("https://overseer.test/api/missing", {
      headers: { "cf-access-jwt-assertion": assertion },
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "resource_not_found" });

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
    await expect(schemas.json()).resolves.toEqual({
      items: [],
      links: {
        self: { href: "/api/schemas" },
        openapi: { href: "/api/openapi.json" },
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
    await expect(openapi.json()).resolves.toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/api": { get: {}, head: {} },
        "/api/schemas": { get: {}, head: {} },
        "/api/openapi.json": { get: {}, head: {} },
      },
    });
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
