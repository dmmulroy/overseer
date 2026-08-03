import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { apiIdentityResponse } from "./api-worker.ts";

describe("API Worker", () => {
  it.effect("returns the API identity", () =>
    Effect.gen(function* () {
      const response = yield* apiIdentityResponse;
      const webResponse = HttpServerResponse.toWeb(response);
      const body = yield* Effect.tryPromise(() => webResponse.text());

      expect(webResponse.status).toBe(200);
      expect(body).toBe("Overseer API");
    }),
  );
});
