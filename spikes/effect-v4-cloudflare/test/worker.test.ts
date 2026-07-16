import {
  SELF,
  env,
  evictDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { EffectSqliteDurableObject } from "../src/worker";

function uniqueStub(): DurableObjectStub<EffectSqliteDurableObject> {
  return env.EFFECT_SQLITE_DO.getByName(crypto.randomUUID());
}

function request(
  stub: DurableObjectStub<EffectSqliteDurableObject>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return stub.fetch(new Request(`https://effect-spike.invalid${path}`, init));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function timeout(milliseconds: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${milliseconds}ms`)), milliseconds);
  });
}

describe("Effect v4 in workerd", () => {
  it("serves HttpApi through Worker and Durable Object Fetch boundaries", async () => {
    const response = await SELF.fetch("https://effect-spike.invalid/echo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spike-object": crypto.randomUUID(),
      },
      body: JSON.stringify({ value: "workerd" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ value: "workerd" });
  });

  it("serializes declared, schema, and outer HTTP failures as JSON", async () => {
    const stub = uniqueStub();

    const declared = await request(stub, "/declared-failure");
    expect(declared.status).toBe(409);
    expect(declared.headers.get("content-type")).toContain("application/json");
    await expect(declared.json()).resolves.toMatchObject({
      _tag: "DeclaredFailure",
      code: "declared_failure",
      message: "The declared failure was serialized.",
    });

    const invalid = await request(stub, "/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "" }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      _tag: "InvalidRequest",
      code: "invalid_request",
      component: "Payload",
    });

    const unsupported = await request(stub, "/echo", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json",
    });
    expect(unsupported.status).toBe(415);
    await expect(unsupported.json()).resolves.toEqual({
      code: "unsupported_media_type",
      message: "The request media type is not supported.",
    });

    const missing = await request(stub, "/missing");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      code: "route_not_found",
      message: "No route matches this request.",
    });
  });

  it("uses full DurableObjectStorage for commit, failure rollback, and interruption rollback", async () => {
    const stub = uniqueStub();

    const sqlOnly = await request(stub, "/transaction/sql-only");
    expect(sqlOnly.status).toBe(200);
    await expect(sqlOnly.json()).resolves.toMatchObject({
      errorMessage: expect.stringMatching(/pass ctx\.storage as the storage option/),
    });

    const committed = await request(stub, "/transaction/success", { method: "POST" });
    expect(committed.status).toBe(200);
    await expect(committed.json()).resolves.toEqual({ count: 1 });

    const failed = await request(stub, "/transaction/failure", { method: "POST" });
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toEqual({
      count: 0,
      errorTag: "RollbackProbe",
    });

    const interrupted = await request(stub, "/transaction/interruption", { method: "POST" });
    expect(interrupted.status).toBe(200);
    await expect(interrupted.json()).resolves.toEqual({ count: 0 });
  });

  it("rebuilds the Effect graph after eviction without losing SQLite data", async () => {
    const stub = uniqueStub();

    const inserted = await request(stub, "/rows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "persistent" }),
    });
    await expect(inserted.json()).resolves.toEqual({ count: 1 });

    const before = await request(stub, "/health");
    const beforeBody = await before.json<{ instanceId: string }>();

    await evictDurableObject(stub);

    const after = await request(stub, "/health");
    const afterBody = await after.json<{ instanceId: string }>();
    expect(afterBody.instanceId).not.toBe(beforeBody.instanceId);

    const rows = await request(stub, "/rows");
    await expect(rows.json()).resolves.toEqual({ count: 1 });
  });

  it("does not wedge when the first external request is aborted during cold initialization", async () => {
    const stub = uniqueStub();
    const controller = new AbortController();
    void request(stub, "/health", { signal: controller.signal }).catch(() => undefined);
    await delay(5);
    controller.abort("cold-start probe");

    const recovered = await Promise.race([
      request(stub, "/health"),
      timeout(1_000),
    ]);
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({ initialized: true });
  });
});
