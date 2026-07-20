import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import {
  ProblemDocument,
  WorkspaceCollection,
  WorkspaceRepresentation,
} from "../../src/contract/http-api.ts";
import { startGateway } from "../fixtures/gateway.ts";

const issuer = "https://overseer-workspaces.cloudflareaccess.com";
const audience = "overseer-workspaces-audience";
const origin = "https://overseer.test";
let gateway: Miniflare;
let privateKey: CryptoKey;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  gateway = await startGateway({
    accessAudience: audience,
    accessIssuer: issuer,
    accessJwks: JSON.stringify({ keys: [{ ...publicJwk, alg: "RS256", kid: "workspaces" }] }),
    allowedOrigin: origin,
  });
});

afterAll(async () => {
  await gateway?.dispose();
});

async function humanAssertion(): Promise<string> {
  return new SignJWT({ email: "owner@example.com", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "workspaces", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("workspace-human")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}

async function agentAssertion(): Promise<string> {
  return new SignJWT({ common_name: "workspace-agent.access", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "workspaces", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}

async function api(
  path: string,
  init: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    ...init.headers,
    "cf-access-jwt-assertion": await humanAssertion(),
  };
  if (init.method !== undefined && init.method !== "GET" && init.method !== "HEAD") {
    headers.origin = origin;
  }
  return gateway.dispatchFetch(`https://overseer.test${path}`, { ...init, headers });
}

async function agentApi(
  path: string,
  init: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
) {
  return gateway.dispatchFetch(`https://overseer.test${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "cf-access-jwt-assertion": await agentAssertion(),
      ...(init.method === undefined || init.method === "GET" || init.method === "HEAD"
        ? {}
        : { "overseer-session-id": "workspace-agent-session" }),
    },
  });
}

async function workspaceJson(response: Awaited<ReturnType<typeof api>>) {
  return Schema.decodeUnknownSync(WorkspaceRepresentation)(await response.json());
}

async function workspaceCollectionJson(response: Awaited<ReturnType<typeof api>>) {
  return Schema.decodeUnknownSync(WorkspaceCollection)(await response.json());
}

async function createWorkspace(name: string, key: string) {
  return api("/api/workspaces", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ name }),
  });
}

describe("Workspace REST interface", () => {
  it("creates, lists, reads, and renames Workspaces without normalizing names", async () => {
    const created = await createWorkspace("  Personal  ", "workspace-create-personal");
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toMatch(/^\/api\/workspaces\/workspace_[0-9A-HJKMNP-TV-Z]{26}$/);
    const workspace = await workspaceJson(created);
    expect(workspace).toMatchObject({
      id: expect.stringMatching(/^workspace_[0-9A-HJKMNP-TV-Z]{26}$/),
      name: "  Personal  ",
      lifecycle: "active",
      archived_at: null,
      links: {
        self: { href: expect.stringMatching(/^\/api\/workspaces\/workspace_/) },
        rename: {
          href: expect.stringMatching(/^\/api\/workspaces\/workspace_/),
          method: "PATCH",
          schema: expect.stringMatching(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/rename_workspace$/),
        },
      },
    });
    expect(workspace.updated_at).toBe(workspace.created_at);
    expect(created.headers.get("location")).toBe(`/api/workspaces/${workspace.id}`);

    const listed = await api("/api/workspaces");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      items: [{ id: workspace.id, name: "  Personal  " }],
      links: {
        self: { href: "/api/workspaces" },
        create: {
          href: "/api/workspaces",
          method: "POST",
          schema: expect.stringMatching(/^\/api\/schemas\/sha256-[0-9a-f]{64}\/create_workspace$/),
        },
      },
    });

    const read = await api(`/api/workspaces/${workspace.id}`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ id: workspace.id, name: "  Personal  " });

    const renamed = await api(`/api/workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Overseer 🚦" }),
    });
    expect(renamed.status).toBe(200);
    const renamedWorkspace = await workspaceJson(renamed);
    expect(renamedWorkspace.name).toBe("Overseer 🚦");
    expect(renamedWorkspace.updated_at).not.toBe(workspace.updated_at);

    const noChange = await api(`/api/workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Overseer 🚦" }),
    });
    expect(noChange.status).toBe(200);
    await expect(noChange.json()).resolves.toMatchObject({
      name: "Overseer 🚦",
      updated_at: renamedWorkspace.updated_at,
    });
  });

  it("gives human and Agent principals the same Workspace operations with independent key scopes", async () => {
    const human = await createWorkspace("Human scoped", "shared-principal-key");
    expect(human.status).toBe(201);

    const agent = await agentApi("/api/workspaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "shared-principal-key",
      },
      body: JSON.stringify({ name: "Agent scoped" }),
    });
    expect(agent.status).toBe(201);
    const agentWorkspace = await workspaceJson(agent);

    const renamed = await agentApi(`/api/workspaces/${agentWorkspace.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Agent renamed" }),
    });
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({ name: "Agent renamed" });

    const listed = await agentApi("/api/workspaces");
    expect(listed.status).toBe(200);
    const collection = Schema.decodeUnknownSync(WorkspaceCollection)(await listed.json());
    expect(collection.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Human scoped", "Agent renamed"]),
    );
  });

  it("replays a creation result and rejects conflicting key reuse without duplication", async () => {
    const first = await createWorkspace("Retry proof", "workspace-retry-proof");
    const firstBody = await first.text();
    const firstLocation = first.headers.get("location");

    const replay = await api("/api/workspaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "workspace-retry-proof",
        "if-none-match": first.headers.get("etag") ?? "",
      },
      body: JSON.stringify({ name: "Retry proof" }),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("location")).toBe(firstLocation);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.text()).toBe(firstBody);

    const conflict = await createWorkspace("Different", "workspace-retry-proof");
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("content-type")).toBe("application/problem+json");
    await expect(conflict.json()).resolves.toMatchObject({
      code: "idempotency_key_reused",
      retryable: false,
    });

    const listed = await api("/api/workspaces");
    const collection = await workspaceCollectionJson(listed);
    expect(collection.items.filter((item) => item.name === "Retry proof")).toHaveLength(1);
    expect(collection.items.some((item) => item.name === "Different")).toBe(false);
  });

  it("paginates the Workspace collection with opaque keyset cursors", async () => {
    const first = await api("/api/workspaces?limit=1");
    expect(first.status).toBe(200);
    const firstPage = await workspaceCollectionJson(first);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.links.self?.href).toBe("/api/workspaces?limit=1");
    expect(firstPage.links.next?.href).toMatch(/^\/api\/workspaces\?cursor=[^&]+&limit=1$/);

    const second = await api(firstPage.links.next?.href ?? "");
    expect(second.status).toBe(200);
    const secondPage = await workspaceCollectionJson(second);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.links.self?.href).toBe(firstPage.links.next?.href);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    const invalid = await api("/api/workspaces?cursor=not-a-cursor&limit=1");
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "malformed_request" });
  });

  it("returns typed problems for malformed and invalid Workspace input", async () => {
    const unsupported = await api("/api/workspaces", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "idempotency-key": "workspace-unsupported",
      },
      body: JSON.stringify({ name: "Unsupported" }),
    });
    expect(unsupported.status).toBe(415);
    expect(unsupported.headers.get("content-type")).toBe("application/problem+json");

    const malformed = await api("/api/workspaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "workspace-malformed",
      },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const malformedProblem = Schema.decodeUnknownSync(ProblemDocument)(
      await malformed.json(),
    );
    expect(malformedProblem).toMatchObject({ code: "malformed_request" });
    expect(malformed.headers.get("x-request-id")).toBe(malformedProblem.request_id);

    const oversized = await createWorkspace(
      "x".repeat(2 * 1024 * 1024),
      "workspace-oversized",
    );
    expect(oversized.status).toBe(400);
    expect(oversized.headers.get("content-type")).toBe("application/problem+json");

    const invalid = await createWorkspace("  \t  ", "workspace-invalid-name");
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "validation_failed",
      errors: [{ code: "invalid", path: "/body/name" }],
    });

    const multiline = await createWorkspace("two\u2028lines", "workspace-multiline-name");
    expect(multiline.status).toBe(422);
    await expect(multiline.json()).resolves.toMatchObject({ code: "validation_failed" });

    const unknownField = await api("/api/workspaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "workspace-unknown-field",
      },
      body: JSON.stringify({ name: "Valid", archived: true }),
    });
    expect(unknownField.status).toBe(400);
    await expect(unknownField.json()).resolves.toMatchObject({ code: "malformed_request" });

    const missingKey = await api("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "No key" }),
    });
    expect(missingKey.status).toBe(400);
    await expect(missingKey.json()).resolves.toMatchObject({ code: "malformed_request" });

    const malformedId = await api("/api/workspaces/not-a-workspace");
    expect(malformedId.status).toBe(400);
    await expect(malformedId.json()).resolves.toMatchObject({ code: "malformed_request" });

    const absent = await api("/api/workspaces/workspace_01J00000000000000000000000");
    expect(absent.status).toBe(404);
    await expect(absent.json()).resolves.toMatchObject({ code: "resource_not_found" });
  });

  it("supports strong validators and HEAD for resources and exact collection pages", async () => {
    const created = await createWorkspace("Conditional", "workspace-conditional");
    const workspace = await workspaceJson(created);

    for (const path of ["/api/workspaces", `/api/workspaces/${workspace.id}`]) {
      const get = await api(path);
      const etag = get.headers.get("etag");
      expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);

      const head = await api(path, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")).toBe(etag);
      expect(await head.text()).toBe("");

      const unchanged = await api(path, {
        headers: { "if-none-match": etag ?? "" },
      });
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get("etag")).toBe(etag);
      expect(await unchanged.text()).toBe("");
    }
  });
});
