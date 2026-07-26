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
  ProjectCollection,
  WorkspaceCollection,
  WorkspaceRepresentation,
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
  return runtime.dispatchFetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "cf-access-jwt-assertion": await humanAssertion(),
      ...(init.method === undefined || init.method === "GET" || init.method === "HEAD"
        ? {}
        : { origin }),
    },
  });
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

  it("keeps a remote defect distinct from typed failures", async () => {
    const stub = await workspaceRegistryStub(gateway);

    await expect(
      stub.createWorkspace({
        name: null,
        idempotencyScope: null,
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

  it("rolls back the Workspace insert when the idempotency insert fails", async () => {
    const persist = await mkdtemp(join(tmpdir(), "overseer-alchemy-rollback-"));
    let runtime: Miniflare | undefined;
    try {
      runtime = await startGatewayAt(persist);
      expect((await createWorkspace(runtime, "Initialize", "initialize")).status).toBe(201);
      await runtime.dispose();

      runtime = await startWorkspaceRegistryMigrationControl(persist);
      expect(
        (
          await runtime.dispatchFetch("https://migration.test/fail-second-insert", {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      await runtime.dispose();

      runtime = await startGatewayAt(persist);
      const failed = await createWorkspace(runtime, "Must roll back", "rollback-second-insert");
      expect(failed.status).toBe(503);
      const listed = await (
        await workspaceRegistryStub(runtime)
      ).listWorkspaces({ limit: WorkspacePageLimit.make(100) });
      expect(listed).not.toMatchObject({
        workspaces: expect.arrayContaining([expect.objectContaining({ name: "Must roll back" })]),
      });
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
    const workspace = Schema.decodeUnknownSync(WorkspaceRepresentation)(
      await workspaceResponse.json(),
    );
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
