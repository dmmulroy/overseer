import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { startCompatibilityFixture } from "../fixtures/compatibility.ts";

let fixture: Miniflare;

beforeAll(async () => {
  fixture = await startCompatibilityFixture();
});

afterAll(async () => {
  await fixture?.dispose();
});

describe("pinned Effect and Cloudflare runtime compatibility", () => {
  it("primes SQLite on cold start and rolls failed transactions back", async () => {
    const rolledBack = await fixture.dispatchFetch("https://fixture/rollback", {
      method: "POST",
    });
    expect(rolledBack.status).toBe(409);
    await expect(rolledBack.json()).resolves.toEqual({
      code: "intentional_rollback",
      retryable: false,
    });

    const afterRollback = await fixture.dispatchFetch("https://fixture/count");
    await expect(afterRollback.json()).resolves.toEqual({ count: 0 });

    const committed = await fixture.dispatchFetch("https://fixture/commit", {
      method: "POST",
    });
    expect(committed.status).toBe(200);
    const afterCommit = await fixture.dispatchFetch("https://fixture/count");
    await expect(afterCommit.json()).resolves.toEqual({ count: 1 });
  });

  it("locks the complete Effect family and Alchemy to the reviewed versions", async () => {
    const manifest: unknown = JSON.parse(await readFile("package.json", "utf8"));
    expect(manifest).toMatchObject({
      dependencies: {
        "@effect/sql-sqlite-do": "4.0.0-beta.98",
        effect: "4.0.0-beta.98",
      },
      devDependencies: {
        alchemy: "2.0.0-beta.62",
      },
      overrides: {
        "@effect/sql-sqlite-do": "4.0.0-beta.98",
        effect: "4.0.0-beta.98",
      },
    });
  });
});
