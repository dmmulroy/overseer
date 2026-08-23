import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { Headers, HttpClient } from "effect/unstable/http";
import { overseerHttpHeaderPolicyLayer } from "./overseer-http-header-policy.ts";

it.effect("extends Effect HTTP header redaction while excluding client headers from traces", () =>
  Effect.gen(function* () {
    const redactedNames = yield* Headers.CurrentRedactedNames;
    const includeClientHeaderInTrace = yield* HttpClient.TracerHeaderFilter;

    const expectedRedactedNames = [
      "authorization",
      "cookie",
      "set-cookie",
      "x-api-key",
      "proxy-authorization",
      "cf-access-jwt-assertion",
      "cf-access-client-secret",
      "cf-connecting-ip",
      "forwarded",
      "true-client-ip",
      "x-forwarded-for",
    ];
    for (const expectedName of expectedRedactedNames) {
      assert.isTrue(redactedNames.includes(expectedName));
    }
    assert.isFalse(redactedNames.includes("cf-access-authenticated-user-email"));
    assert.isFalse(redactedNames.includes("cf-access-client-id"));
    assert.isTrue(includeClientHeaderInTrace("CF-Access-Authenticated-User-Email", "request"));
    assert.isTrue(includeClientHeaderInTrace("CF-Access-Client-Id", "request"));
    assert.isTrue(includeClientHeaderInTrace("content-type", "request"));
    assert.isTrue(includeClientHeaderInTrace("X-Overseer-Request-Id", "response"));
    assert.isTrue(includeClientHeaderInTrace("cf-ray", "response"));
    assert.isTrue(includeClientHeaderInTrace("content-type", "response"));
    assert.isTrue(includeClientHeaderInTrace("retry-after", "response"));
    assert.isFalse(includeClientHeaderInTrace("cf-access-client-secret", "request"));
    assert.isFalse(includeClientHeaderInTrace("cf-access-client-id", "response"));
    assert.isFalse(includeClientHeaderInTrace("user-agent", "request"));
    assert.isFalse(includeClientHeaderInTrace("traceparent", "request"));
  }).pipe(Effect.provide(overseerHttpHeaderPolicyLayer)),
);
