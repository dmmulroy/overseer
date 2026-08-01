import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Miniflare } from "miniflare";
import {
  ProjectCollection,
  ProjectResponse,
  WorkspaceResponse,
} from "../../src/contract/http-api.ts";
import { startGateway } from "../fixtures/gateway.ts";

const issuer = "https://overseer-projects.cloudflareaccess.com";
const audience = "overseer-projects-audience";
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
    accessJwks: JSON.stringify({ keys: [{ ...publicJwk, alg: "RS256", kid: "projects" }] }),
    allowedOrigin: origin,
  });
});

afterAll(async () => {
  await gateway?.dispose();
});

async function assertion(): Promise<string> {
  return new SignJWT({ email: "owner@example.com", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "projects", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("project-human")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}

async function agentAssertion(): Promise<string> {
  return new SignJWT({ common_name: "project-agent.access", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "projects", typ: "JWT" })
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
  const headers: Record<string, string> = { ...init.headers };
  headers["cf-access-jwt-assertion"] = await assertion();
  if (init.method !== undefined && init.method !== "GET" && init.method !== "HEAD") {
    headers.origin = origin;
  }
  return gateway.dispatchFetch(`${origin}${path}`, { ...init, headers });
}

async function agentApi(
  path: string,
  init: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
) {
  const headers: Record<string, string> = { ...init.headers };
  headers["cf-access-jwt-assertion"] = await agentAssertion();
  if (init.method !== undefined && init.method !== "GET" && init.method !== "HEAD") {
    headers["overseer-session-id"] = "project-agent-session";
  }
  return gateway.dispatchFetch(`${origin}${path}`, { ...init, headers });
}

async function createWorkspace(name: string, key: string) {
  const response = await api("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ name }),
  });
  return Schema.decodeUnknownSync(WorkspaceResponse)(await response.json());
}

async function createProject(workspaceId: string, name: string, key: string) {
  return api(`/api/workspaces/${workspaceId}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ name }),
  });
}

describe("Project REST interface", () => {
  it("creates, lists, reads, and renames Projects while preserving identity", async () => {
    const workspace = await createWorkspace("Personal", "project-workspace");
    const created = await createProject(workspace.id, "  Overseer  ", "project-create");
    expect(created.status).toBe(201);
    const project = Schema.decodeUnknownSync(ProjectResponse)(await created.json());
    expect(project).toMatchObject({
      id: expect.stringMatching(/^project_[0-9A-HJKMNP-TV-Z]{26}$/),
      workspace_id: workspace.id,
      name: "  Overseer  ",
      lifecycle: "active",
      links: {
        self: { href: expect.stringMatching(/^\/api\/projects\/project_/) },
        workspace: { href: `/api/workspaces/${workspace.id}` },
        rename: { method: "PATCH" },
      },
    });
    expect(created.headers.get("location")).toBe(`/api/projects/${project.id}`);

    for (const path of ["/api/projects", `/api/workspaces/${workspace.id}/projects`]) {
      const listed = await api(path);
      expect(listed.status).toBe(200);
      const collection = Schema.decodeUnknownSync(ProjectCollection)(await listed.json());
      expect(collection.items).toEqual([project]);
      expect(collection.links.self?.href).toBe(path);
    }

    const read = await api(`/api/projects/${project.id}`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      id: project.id,
      workspace_id: workspace.id,
    });

    const renamed = await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Overseer renamed" }),
    });
    expect(renamed.status).toBe(200);
    const renamedProject = Schema.decodeUnknownSync(ProjectResponse)(await renamed.json());
    expect(renamedProject).toMatchObject({
      id: project.id,
      workspace_id: workspace.id,
      name: "Overseer renamed",
    });
    expect(renamedProject.updated_at).not.toBe(project.updated_at);

    const noChange = await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Overseer renamed" }),
    });
    await expect(noChange.json()).resolves.toMatchObject({ updated_at: renamedProject.updated_at });
  });

  it("allows an authenticated Agent to create and discover a Project", async () => {
    const workspace = await createWorkspace("Agent Workspace", "project-agent-workspace");
    const created = await agentApi(`/api/workspaces/${workspace.id}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "project-agent-create" },
      body: JSON.stringify({ name: "Agent Project" }),
    });
    expect(created.status).toBe(201);
    const project = Schema.decodeUnknownSync(ProjectResponse)(await created.json());
    const discovery = await agentApi("/api");
    await expect(discovery.json()).resolves.toMatchObject({
      links: { projects: { href: "/api/projects" } },
    });
    const listed = Schema.decodeUnknownSync(ProjectCollection)(
      await (await agentApi("/api/projects")).json(),
    );
    expect(listed.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id })]),
    );
  });

  it("replays the current Project despite changed target or body and rejects cross-result-type reuse", async () => {
    const firstWorkspace = await createWorkspace("First", "project-replay-workspace-first");
    const secondWorkspace = await createWorkspace("Second", "project-replay-workspace-second");
    const first = await createProject(firstWorkspace.id, "Replay Project", "project-replay-key");
    expect(first.status).toBe(201);
    const firstProject = Schema.decodeUnknownSync(ProjectResponse)(await first.json());

    const changedTargetReplay = await createProject(
      secondWorkspace.id,
      "Different requested name",
      "project-replay-key",
    );
    expect(changedTargetReplay.status).toBe(201);
    expect(changedTargetReplay.headers.get("idempotency-replayed")).toBe("true");
    expect(changedTargetReplay.headers.get("location")).toBe(`/api/projects/${firstProject.id}`);
    await expect(changedTargetReplay.json()).resolves.toMatchObject({
      id: firstProject.id,
      workspace_id: firstWorkspace.id,
      name: "Replay Project",
    });

    const renamed = await api(`/api/projects/${firstProject.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Current Project name" }),
    });
    expect(renamed.status).toBe(200);

    const currentReplay = await createProject(
      firstWorkspace.id,
      "Another ignored name",
      "project-replay-key",
    );
    expect(currentReplay.status).toBe(201);
    expect(currentReplay.headers.get("idempotency-replayed")).toBe("true");
    expect(currentReplay.headers.get("location")).toBe(`/api/projects/${firstProject.id}`);
    await expect(currentReplay.json()).resolves.toMatchObject({
      id: firstProject.id,
      name: "Current Project name",
    });

    const listed = Schema.decodeUnknownSync(ProjectCollection)(
      await (await api("/api/projects")).json(),
    );
    expect(listed.items.filter((project) => project.id === firstProject.id)).toHaveLength(1);
    expect(listed.items.some((project) => project.name === "Different requested name")).toBe(false);

    const crossResultType = await createProject(
      firstWorkspace.id,
      "Different",
      "project-replay-workspace-first",
    );
    expect(crossResultType.status).toBe(409);
    await expect(crossResultType.json()).resolves.toMatchObject({
      code: "idempotency_key_reused",
      retryable: false,
    });
  });

  it("paginates scoped Project collections and rejects cursor rebinding", async () => {
    const workspace = await createWorkspace("Paged", "project-paged-workspace");
    await createProject(workspace.id, "A Project", "project-paged-a");
    await createProject(workspace.id, "B Project", "project-paged-b");
    const first = await api(`/api/workspaces/${workspace.id}/projects?limit=1`);
    const firstPage = Schema.decodeUnknownSync(ProjectCollection)(await first.json());
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.links.next?.href).toMatch(/cursor=[^&]+&limit=1$/);
    expect((await api(firstPage.links.next?.href ?? "")).status).toBe(200);
    const cursor = new URL(firstPage.links.next?.href ?? "", origin).searchParams.get("cursor");
    const rebound = await api(`/api/projects?cursor=${encodeURIComponent(cursor ?? "")}&limit=1`);
    expect(rebound.status).toBe(400);
    await expect(rebound.json()).resolves.toMatchObject({ code: "malformed_request" });
  });

  it("supports strong validators and HEAD for Projects and exact collection pages", async () => {
    const workspace = await createWorkspace("ETag", "project-etag-workspace");
    const created = await createProject(workspace.id, "ETag Project", "project-etag");
    const project = Schema.decodeUnknownSync(ProjectResponse)(await created.json());
    for (const path of [
      "/api/projects",
      `/api/workspaces/${workspace.id}/projects`,
      `/api/projects/${project.id}`,
    ]) {
      const get = await api(path);
      const etag = get.headers.get("etag");
      expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
      const head = await api(path, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")).toBe(etag);
      expect(await head.text()).toBe("");
      const unchanged = await api(path, { headers: { "if-none-match": etag ?? "" } });
      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe("");
    }
  });

  it("returns actionable problems for invalid Project requests", async () => {
    const workspace = await createWorkspace("Validation", "project-validation-workspace");
    const invalid = await createProject(workspace.id, "   ", "project-invalid-name");
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "validation_failed",
      errors: [{ path: "/body/name" }],
    });
    const unknown = await api(`/api/workspaces/${workspace.id}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "project-unknown" },
      body: JSON.stringify({ name: "Valid", workspace_id: workspace.id }),
    });
    expect(unknown.status).toBe(400);
    const absentWorkspace = await createProject(
      "workspace_01J00000000000000000000000",
      "Missing",
      "project-missing-workspace",
    );
    expect(absentWorkspace.status).toBe(404);
    expect((await api("/api/projects/project_01J00000000000000000000000")).status).toBe(404);
  });
});
