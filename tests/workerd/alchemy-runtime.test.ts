import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Miniflare } from "miniflare";
import {
  type ListWorkspacesRpcInput,
  WORKSPACE_REGISTRY_SINGLETON_NAME,
} from "../../src/application/workspace-registry/workspace-registry-rpc.ts";
import {
  IssueResponse,
  ProjectCollection,
  ProjectResponse,
  WorkspaceCollection,
  WorkspaceResponse,
} from "../../src/contract/http-api.ts";
import { WorkspaceId } from "../../src/domain/entity-id.ts";
import { WorkspacePageLimit } from "../../src/domain/pagination.ts";
import { startAlchemyGateway } from "../fixtures/alchemy-gateway.ts";
import { startWorkspaceRegistryMigrationControl } from "../fixtures/workspace-registry-migration-control.ts";

const issuer = "https://overseer-alchemy.cloudflareaccess.com";
const audience = "overseer-alchemy-audience";
const origin = "https://overseer-alchemy.test";
let persistenceRoot: string;
let gateway: Miniflare;
let privateKey: CryptoKey;
let accessJwks: string;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  accessJwks = JSON.stringify({
    keys: [{ ...publicJwk, alg: "RS256", kid: "alchemy-runtime" }],
  });
  persistenceRoot = await mkdtemp(join(tmpdir(), "overseer-alchemy-runtime-"));
  gateway = await startGatewayAt(persistenceRoot);
});

afterAll(async () => {
  await gateway?.dispose();
  if (persistenceRoot !== undefined) {
    await rm(persistenceRoot, { force: true, recursive: true });
  }
});

function startGatewayAt(persist: string): Promise<Miniflare> {
  return startAlchemyGateway({
    accessAudience: audience,
    accessIssuer: issuer,
    accessJwks,
    allowedOrigin: origin,
    durableObjectsPersist: persist,
  });
}

async function humanAssertion(): Promise<string> {
  return new SignJWT({ email: "owner@example.com", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "alchemy-runtime", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("alchemy-runtime-human")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}

async function api(
  runtime: Miniflare,
  path: string,
  init: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
) {
  const headers: Record<string, string> = { ...init.headers };
  headers["cf-access-jwt-assertion"] = await humanAssertion();
  if (init.method !== undefined && init.method !== "GET" && init.method !== "HEAD") {
    headers.origin = origin;
  }
  return runtime.dispatchFetch(`${origin}${path}`, { ...init, headers });
}

async function createWorkspace(runtime: Miniflare, name: string, key: string) {
  return api(runtime, "/api/workspaces", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ name }),
  });
}

async function createProject(runtime: Miniflare, workspaceId: string, name: string, key: string) {
  return api(runtime, `/api/workspaces/${workspaceId}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ name }),
  });
}

async function createIssue(runtime: Miniflare, projectId: string, title: string, key: string) {
  return api(runtime, `/api/projects/${projectId}/issues`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ title }),
  });
}

async function moveProject(
  runtime: Miniflare,
  projectId: string,
  workspaceId: string,
  key: string,
) {
  return api(runtime, `/api/projects/${projectId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

async function workspaceRegistryStub(runtime: Miniflare) {
  const namespace = await runtime.getDurableObjectNamespace("WorkspaceRegistryObject");
  // SAFETY: Miniflare exposes only the base stub type. The bundled production Alchemy class registers these operation-specific methods on this named object.
  return namespace.getByName(WORKSPACE_REGISTRY_SINGLETON_NAME) as unknown as {
    readonly listWorkspaces: (request: ListWorkspacesRpcInput) => Promise<unknown>;
    readonly readWorkspace: (workspaceId: unknown) => Promise<unknown>;
    readonly createWorkspace: (request: unknown) => Promise<unknown>;
    readonly renameWorkspace: (request: unknown) => Promise<unknown>;
  };
}

describe("production Alchemy runtime", () => {
  it("serves the safe production fallback when runtime configuration is invalid", async () => {
    const invalidGateway = await startAlchemyGateway({
      accessAudience: "",
      accessIssuer: issuer,
      accessJwks,
      allowedOrigin: origin,
      durableObjectsPersist: false,
    });
    try {
      const response = await invalidGateway.dispatchFetch(`${origin}/api`);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(response.headers.get("x-request-id")).toMatch(/^request_/);
      await expect(response.json()).resolves.toMatchObject({
        code: "gateway_unavailable",
        retryable: true,
        status: 503,
      });
    } finally {
      await invalidGateway.dispose();
    }
  });

  it("initializes one Workspace Registry activation under concurrent first RPC calls", async () => {
    const [first, second] = await Promise.all([
      createWorkspace(gateway, "Alchemy first", "alchemy-first"),
      createWorkspace(gateway, "Alchemy second", "alchemy-second"),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("serializes concurrent creation with the same idempotency key", async () => {
    const [first, second] = await Promise.all([
      createWorkspace(gateway, "Same key", "alchemy-same-key"),
      createWorkspace(gateway, "Same key", "alchemy-same-key"),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(
      [first.headers.get("idempotency-replayed"), second.headers.get("idempotency-replayed")].sort(
        (left, right) => (left ?? "").localeCompare(right ?? ""),
      ),
    ).toEqual([null, "true"]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
    expect(firstBody).toMatchObject({ id: expect.any(String), name: "Same key" });
    expect(secondBody).toEqual(firstBody);
  });

  it("serves read and rename RPC branches including no-op and not-found", async () => {
    const created = await createWorkspace(gateway, "Rename before", "alchemy-rename");
    const createdBody = (await created.json()) as { readonly id: string };
    const workspaceId = Schema.decodeUnknownSync(WorkspaceId)(createdBody.id);
    const stub = await workspaceRegistryStub(gateway);

    const renamed = await stub.renameWorkspace({
      workspaceId,
      name: "Rename after",
    });
    expect(renamed).toMatchObject({ id: workspaceId, name: "Rename after" });
    const unchanged = await stub.renameWorkspace({
      workspaceId,
      name: "Rename after",
    });
    expect(unchanged).toEqual(renamed);
    await expect(stub.readWorkspace(workspaceId)).resolves.toEqual(renamed);

    const missingId = WorkspaceId.make("workspace_01J00000000000000000000000");
    const missing = await stub.readWorkspace(missingId);
    expect(missing).toMatchObject({
      _tag: "~alchemy/rpc/error",
      error: { _tag: "WorkspaceNotFound", workspaceId: missingId },
    });
  });

  it("atomically moves a Project and replays the original response through Alchemy RPC", async () => {
    const sourceResponse = await createWorkspace(gateway, "Move source", "alchemy-move-source");
    const targetResponse = await createWorkspace(gateway, "Move target", "alchemy-move-target");
    const source = Schema.decodeUnknownSync(WorkspaceResponse)(await sourceResponse.json());
    const target = Schema.decodeUnknownSync(WorkspaceResponse)(await targetResponse.json());
    const createdResponse = await createProject(
      gateway,
      source.id,
      "Movable Project",
      "alchemy-move-create",
    );
    const created = Schema.decodeUnknownSync(ProjectResponse)(await createdResponse.json());
    const collectionPaths = [
      "/api/projects",
      `/api/workspaces/${source.id}/projects`,
      `/api/workspaces/${target.id}/projects`,
    ];
    const originalEtags = new Map<string, string>();
    for (const path of collectionPaths) {
      const response = await api(gateway, path);
      originalEtags.set(path, response.headers.get("etag") ?? "");
    }

    const movedResponse = await moveProject(gateway, created.id, target.id, "alchemy-move-key");
    expect(movedResponse.status).toBe(200);
    const moved = Schema.decodeUnknownSync(ProjectResponse)(await movedResponse.json());
    expect(moved).toMatchObject({
      id: created.id,
      workspace_id: target.id,
      name: created.name,
      created_at: created.created_at,
      links: {
        self: { href: `/api/projects/${created.id}` },
        workspace: { href: `/api/workspaces/${target.id}` },
        move: { href: `/api/projects/${created.id}/move`, method: "POST" },
      },
    });
    expect(moved.updated_at).not.toBe(created.updated_at);

    for (const path of collectionPaths) {
      const refreshed = await api(gateway, path, {
        headers: { "if-none-match": originalEtags.get(path) ?? "" },
      });
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get("etag")).not.toBe(originalEtags.get(path));
      const collection = Schema.decodeUnknownSync(ProjectCollection)(await refreshed.json());
      if (path.includes(source.id)) {
        expect(collection.items.some((project) => project.id === created.id)).toBe(false);
      } else {
        expect(collection.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: created.id, workspace_id: target.id }),
          ]),
        );
      }
    }

    expect(
      (
        await api(gateway, `/api/projects/${created.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Renamed after move" }),
        })
      ).status,
    ).toBe(200);
    const replay = await moveProject(gateway, created.id, source.id, "alchemy-move-key");
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    await expect(replay.json()).resolves.toEqual(moved);
    await expect((await api(gateway, `/api/projects/${created.id}`)).json()).resolves.toMatchObject(
      {
        id: created.id,
        workspace_id: target.id,
        name: "Renamed after move",
      },
    );
  });

  it("rolls back Project membership when the move result cannot be recorded", async () => {
    const persist = await mkdtemp(join(tmpdir(), "overseer-alchemy-move-rollback-"));
    let runtime: Miniflare | undefined;
    try {
      runtime = await startGatewayAt(persist);
      const source = Schema.decodeUnknownSync(WorkspaceResponse)(
        await (
          await createWorkspace(runtime, "Move rollback source", "move-rollback-source")
        ).json(),
      );
      const target = Schema.decodeUnknownSync(WorkspaceResponse)(
        await (
          await createWorkspace(runtime, "Move rollback target", "move-rollback-target")
        ).json(),
      );
      const project = Schema.decodeUnknownSync(ProjectResponse)(
        await (
          await createProject(runtime, source.id, "Move rollback Project", "move-rollback-project")
        ).json(),
      );
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      expect(
        (
          await runtime.dispatchFetch("https://migration.test/fail-project-move-key-write", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const failed = await moveProject(runtime, project.id, target.id, "rollback-project-move-key");
      expect(failed.status).toBe(503);
      await expect(
        (await api(runtime, `/api/projects/${project.id}`)).json(),
      ).resolves.toMatchObject({ workspace_id: source.id });
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      expect(
        (
          await runtime.dispatchFetch("https://migration.test/allow-project-move-key-write", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const retried = await moveProject(
        runtime,
        project.id,
        target.id,
        "rollback-project-move-key",
      );
      expect(retried.status).toBe(200);
      expect(retried.headers.get("idempotency-replayed")).toBeNull();
      await expect(retried.json()).resolves.toMatchObject({ workspace_id: target.id });
    } finally {
      await runtime?.dispose();
      await rm(persist, { force: true, recursive: true });
    }
  });

  it("returns actionable problems for invalid and inapplicable Project moves", async () => {
    const workspaceResponse = await createWorkspace(
      gateway,
      "Move failures",
      "alchemy-move-failures-workspace",
    );
    const workspace = Schema.decodeUnknownSync(WorkspaceResponse)(await workspaceResponse.json());
    const createdResponse = await createProject(
      gateway,
      workspace.id,
      "Stationary Project",
      "alchemy-move-failures-create",
    );
    const project = Schema.decodeUnknownSync(ProjectResponse)(await createdResponse.json());

    const invalidTarget = await moveProject(
      gateway,
      project.id,
      "workspace_01J00000000000000000000000",
      "alchemy-move-invalid-target",
    );
    expect(invalidTarget.status).toBe(404);
    await expect(invalidTarget.json()).resolves.toMatchObject({
      code: "resource_not_found",
      links: { project: { href: `/api/projects/${project.id}` } },
    });

    const inapplicable = await moveProject(
      gateway,
      project.id,
      workspace.id,
      "alchemy-move-inapplicable",
    );
    expect(inapplicable.status).toBe(409);
    await expect(inapplicable.json()).resolves.toMatchObject({
      code: "action_not_applicable",
      details: { current_project: { id: project.id, workspace_id: workspace.id } },
      links: {
        project: { href: `/api/projects/${project.id}` },
        workspace: { href: `/api/workspaces/${workspace.id}` },
      },
    });

    const reusedKey = await moveProject(
      gateway,
      project.id,
      workspace.id,
      "alchemy-move-failures-create",
    );
    expect(reusedKey.status).toBe(409);
    await expect(reusedKey.json()).resolves.toMatchObject({
      code: "idempotency_key_reused",
      detail: "This Idempotency-Key already identifies another Workspace Registry operation.",
    });
  });

  it("serves operation-specific RPC and preserves transactional persistence behavior", async () => {
    const replay = await createWorkspace(gateway, "Alchemy first", "alchemy-first");
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");

    const direct = await (
      await workspaceRegistryStub(gateway)
    ).listWorkspaces({ limit: WorkspacePageLimit.make(20) });
    expect(direct).toMatchObject({
      workspaces: expect.arrayContaining([
        expect.objectContaining({ name: "Alchemy first" }),
        expect.objectContaining({ name: "Alchemy second" }),
      ]),
    });
  });

  it("creates and canonically routes an Issue through the production Project bridge", async () => {
    const workspace = Schema.decodeUnknownSync(WorkspaceResponse)(
      await (
        await createWorkspace(gateway, "Alchemy Issue Workspace", "alchemy-issue-workspace")
      ).json(),
    );
    const project = Schema.decodeUnknownSync(ProjectResponse)(
      await (
        await createProject(gateway, workspace.id, "Alchemy Issue Project", "alchemy-issue-project")
      ).json(),
    );
    const created = await createIssue(
      gateway,
      project.id,
      "Alchemy bridged Issue",
      "alchemy-issue-create",
    );
    expect(created.status).toBe(201);
    const issue = Schema.decodeUnknownSync(IssueResponse)(await created.json());
    const canonical = await api(gateway, `/api/issues/${issue.id}`);
    expect(canonical.status).toBe(200);
    await expect(canonical.json()).resolves.toMatchObject({
      id: issue.id,
      project_id: project.id,
      number: 1,
    });
  });

  it("keeps a remote defect distinct from typed failures", async () => {
    const stub = await workspaceRegistryStub(gateway);

    await expect(
      stub.createWorkspace({
        name: null,
        idempotencyKey: null,
      }),
    ).rejects.toThrow();
  });

  it("round-trips an expected tagged persistence failure without its local cause", async () => {
    const persist = await mkdtemp(join(tmpdir(), "overseer-alchemy-corrupt-"));
    let runtime: Miniflare | undefined;
    try {
      runtime = await startGatewayAt(persist);
      expect((await createWorkspace(runtime, "Corrupt me", "corrupt-me")).status).toBe(201);
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      const corrupted = await runtime.dispatchFetch("https://migration.test/corrupt-workspace", {
        method: "POST",
      });
      expect(corrupted.status).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const wireFailure = await (
        await workspaceRegistryStub(runtime)
      ).listWorkspaces({ limit: WorkspacePageLimit.make(20) });
      expect(wireFailure).toMatchObject({
        _tag: "~alchemy/rpc/error",
        error: { _tag: "WorkspaceRegistryRecordCorrupt" },
      });
      expect(wireFailure).not.toMatchObject({ error: { cause: expect.anything() } });

      const response = await api(runtime, "/api/workspaces");
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "service_unavailable",
      });
    } finally {
      await runtime?.dispose();
      await rm(persist, { force: true, recursive: true });
    }
  });

  it("exposes a corrupt creation key without its cause and maps it to public 503", async () => {
    const persist = await mkdtemp(join(tmpdir(), "overseer-alchemy-corrupt-key-"));
    let runtime: Miniflare | undefined;
    try {
      runtime = await startGatewayAt(persist);
      expect((await createWorkspace(runtime, "Initialize", "corrupt-key-initialize")).status).toBe(
        201,
      );
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      expect(
        (
          await runtime.dispatchFetch("https://migration.test/corrupt-creation-key", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const wireFailure = await (
        await workspaceRegistryStub(runtime)
      ).createWorkspace({ name: "Ignored", idempotencyKey: "corrupt-creation-key" });
      expect(wireFailure).toMatchObject({
        _tag: "~alchemy/rpc/error",
        error: { _tag: "WorkspaceRegistryRecordCorrupt" },
      });
      expect(wireFailure).not.toMatchObject({ error: { cause: expect.anything() } });

      const response = await createWorkspace(runtime, "Ignored", "corrupt-creation-key");
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: "service_unavailable" });
    } finally {
      await runtime?.dispose();
      await rm(persist, { force: true, recursive: true });
    }
  });

  it("rolls back creation when the key write fails and allows the same key to retry", async () => {
    const persist = await mkdtemp(join(tmpdir(), "overseer-alchemy-rollback-"));
    let runtime: Miniflare | undefined;
    try {
      runtime = await startGatewayAt(persist);
      expect((await createWorkspace(runtime, "Initialize", "initialize")).status).toBe(201);
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      expect(
        (
          await runtime.dispatchFetch("https://migration.test/fail-creation-key-write", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const failed = await createWorkspace(runtime, "Must roll back", "rollback-creation-key");
      expect(failed.status).toBe(503);
      const listed = await (
        await workspaceRegistryStub(runtime)
      ).listWorkspaces({ limit: WorkspacePageLimit.make(100) });
      expect(listed).not.toMatchObject({
        workspaces: expect.arrayContaining([expect.objectContaining({ name: "Must roll back" })]),
      });
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      expect(
        (
          await runtime.dispatchFetch("https://migration.test/allow-creation-key-write", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const retried = await createWorkspace(runtime, "Must roll back", "rollback-creation-key");
      expect(retried.status).toBe(201);
      expect(retried.headers.get("idempotency-replayed")).toBeNull();
    } finally {
      await runtime?.dispose();
      await rm(persist, { force: true, recursive: true });
    }
  });

  it("reconstructs the object and reads previously committed Workspace Registry state", async () => {
    const workspaceResponse = await createWorkspace(
      gateway,
      "Reconstructed Project Workspace",
      "reconstructed-project-workspace",
    );
    const workspace = Schema.decodeUnknownSync(WorkspaceResponse)(await workspaceResponse.json());
    expect(
      (await createProject(gateway, workspace.id, "Reconstructed Project", "reconstructed-project"))
        .status,
    ).toBe(201);

    await gateway.dispose();
    gateway = await startGatewayAt(persistenceRoot);

    const listed = await api(gateway, "/api/workspaces");
    expect(listed.status).toBe(200);
    const collection = Schema.decodeUnknownSync(WorkspaceCollection)(await listed.json());
    expect(collection.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Alchemy first", "Alchemy second"]),
    );
    const projects = Schema.decodeUnknownSync(ProjectCollection)(
      await (await api(gateway, "/api/projects")).json(),
    );
    expect(projects.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Reconstructed Project", workspace_id: workspace.id }),
      ]),
    );
    const replayed = await createProject(
      gateway,
      workspace.id,
      "Ignored after reconstruction",
      "reconstructed-project",
    );
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("idempotency-replayed")).toBe("true");
    await expect(replayed.json()).resolves.toMatchObject({ name: "Reconstructed Project" });
  });

  it("classifies a migration body failure and retries after the body is repaired", async () => {
    const persist = await mkdtemp(join(tmpdir(), "overseer-alchemy-migration-body-"));
    let runtime: Miniflare | undefined;
    try {
      runtime = await startWorkspaceRegistryMigrationControl(persist);
      expect(
        (
          await runtime.dispatchFetch("https://migration.test/break-migration-body", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const failed = await api(runtime, "/api/workspaces");
      expect(failed.status).toBe(500);
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      expect(
        (
          await runtime.dispatchFetch("https://migration.test/repair-migration-body", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      expect((await api(runtime, "/api/workspaces")).status).toBe(200);
    } finally {
      await runtime?.dispose();
      await rm(persist, { force: true, recursive: true });
    }
  });

  it("maps a migration defect through Alchemy RpcCallError and retries after reconstruction", async () => {
    const persist = await mkdtemp(join(tmpdir(), "overseer-alchemy-migration-"));
    let runtime: Miniflare | undefined;
    try {
      runtime = await startWorkspaceRegistryMigrationControl(persist);
      const poisoned = await runtime.dispatchFetch("https://migration.test/poison", {
        method: "POST",
      });
      expect(poisoned.status).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const failed = await api(runtime, "/api/workspaces");
      expect(failed.status).toBe(500);
      await expect(failed.json()).resolves.toMatchObject({
        code: "internal_error",
        detail: "Overseer could not complete the Workspace Registry call.",
      });
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      const repaired = await runtime.dispatchFetch("https://migration.test/repair", {
        method: "POST",
      });
      expect(repaired.status).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const recovered = await api(runtime, "/api/workspaces");
      expect(recovered.status).toBe(200);
    } finally {
      await runtime?.dispose();
      await rm(persist, { force: true, recursive: true });
    }
  });
});
