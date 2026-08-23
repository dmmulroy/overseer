import { assert, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { resolveTestTraceCollectorConnection } from "./test-trace-collector-deployment.ts";

it.effect(
  "resolves the production test trace collector connection without exposing its secret",
  () =>
    Effect.gen(function* () {
      const secret = Redacted.make("trace-collector-secret");
      const connection = yield* resolveTestTraceCollectorConnection(
        "trace-collector-client-id",
        secret,
      );

      assert.strictEqual(connection.url.href, "https://ttc.mulroy.cloud/");
      assert.strictEqual(connection.access.clientId, "trace-collector-client-id");
      assert.strictEqual(connection.access.clientSecret, secret);
    }),
);

it.effect("rejects a test trace collector connection without a fresh Access secret", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      resolveTestTraceCollectorConnection("trace-collector-client-id", undefined),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);
