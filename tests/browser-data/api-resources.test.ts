import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";
import {
  browserResourceRetryDelay,
  parseProjectPageNavigation,
  parseWorkspacePageNavigation,
} from "../../src/adapters/web-client/api-resources.ts";

describe("browser API resources", () => {
  it("uses 5, 15, 30, then 60 second retry delays and honors longer advice", () => {
    expect([
      browserResourceRetryDelay(0, 0),
      browserResourceRetryDelay(1, 0),
      browserResourceRetryDelay(2, 0),
      browserResourceRetryDelay(3, 0),
      browserResourceRetryDelay(9, 90_000),
    ]).toEqual([5_000, 15_000, 30_000, 60_000, 90_000]);
  });

  it("canonicalizes an exact same-origin Workspace page", async () => {
    const navigation = await Effect.runPromise(
      parseWorkspacePageNavigation(
        "/api/workspaces?limit=25&cursor=next-page",
        "https://overseer.example",
      ),
    );

    expect(navigation).toEqual({
      exactUrl: "https://overseer.example/api/workspaces?cursor=next-page&limit=25",
      cursor: "next-page",
      limit: 25,
    });
  });

  it("canonicalizes an exact same-origin Project page", async () => {
    const navigation = await Effect.runPromise(
      parseProjectPageNavigation(
        "/api/projects?limit=25&cursor=next-project-page",
        "https://overseer.example",
      ),
    );
    expect(navigation).toEqual({
      exactUrl: "https://overseer.example/api/projects?cursor=next-project-page&limit=25",
      cursor: "next-project-page",
      limit: 25,
    });
  });

  it.each([
    "https://attacker.example/api/workspaces?cursor=x&limit=25",
    "/api/workspaces/other?cursor=x&limit=25",
    "/api/workspaces?cursor=x&cursor=y&limit=25",
    "/api/workspaces?cursor=x&limit=25&sort=name",
  ])("rejects unsafe Workspace pagination link %s", async (href) => {
    const result = await Effect.runPromise(
      Effect.result(parseWorkspacePageNavigation(href, "https://overseer.example")),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("pagination");
      expect(result.failure.retryable).toBe(false);
    }
  });
});
