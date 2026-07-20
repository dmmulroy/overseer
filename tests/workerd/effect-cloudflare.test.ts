import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import manifest from "../../package.json" with { type: "json" };
import { startCompatibilityFixture } from "../fixtures/compatibility.ts";

let fixture: Miniflare;

beforeAll(async () => {
  fixture = await startCompatibilityFixture();
});

afterAll(async () => {
  await fixture?.dispose();
});

describe("pinned Effect and Cloudflare runtime compatibility", () => {
  it("resets an object after aborted initialization and primes on retry", async () => {
    const aborted = await fixture.dispatchFetch("https://fixture/initialization");
    expect(aborted.status).toBe(500);

    const retried = await fixture.dispatchFetch("https://fixture/initialization");
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toEqual({ primed_after_abort: true });
  });

  it("primes declared HTTP and rolls failed or interrupted transactions back", async () => {
    const rolledBack = await fixture.dispatchFetch("https://fixture/rollback", {
      method: "POST",
    });
    expect(rolledBack.status).toBe(409);
    expect(rolledBack.headers.get("content-type")).toBe("application/json");
    await expect(rolledBack.json()).resolves.toMatchObject({
      _tag: "IntentionalRollback",
      code: "intentional_rollback",
      retryable: false,
    });

    const interrupted = await fixture.dispatchFetch("https://fixture/interrupt", {
      method: "POST",
    });
    expect(interrupted.status).toBe(200);
    await expect(interrupted.json()).resolves.toEqual({ interrupted: true });

    const afterRollback = await fixture.dispatchFetch("https://fixture/count");
    await expect(afterRollback.json()).resolves.toEqual({ count: 0 });

    const committed = await fixture.dispatchFetch("https://fixture/commit", {
      method: "POST",
    });
    expect(committed.status).toBe(200);
    const afterCommit = await fixture.dispatchFetch("https://fixture/count");
    await expect(afterCommit.json()).resolves.toEqual({ count: 1 });
  });

  it("locks the complete Effect family and Alchemy to the reviewed versions", () => {
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
