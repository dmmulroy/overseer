import { includeOverseerHttpTraceHeader } from "@overseer/test-trace-protocol";
import { Effect, Layer } from "effect";
import { Headers, HttpClient } from "effect/unstable/http";

/** Allows only approved correlation and protocol headers into HTTP client spans. */
export const overseerHttpClientTraceHeaderFilter = includeOverseerHttpTraceHeader;

const overseerAdditionalSensitiveHttpHeaderNames: ReadonlyArray<string | RegExp> = [
  "proxy-authorization",
  "cf-access-jwt-assertion",
  "cf-access-client-secret",
  "cf-connecting-ip",
  "forwarded",
  "true-client-ip",
  "x-forwarded-for",
];

const overseerHttpHeaderRedactionLayer = Layer.effect(
  Headers.CurrentRedactedNames,
  Effect.map(Headers.CurrentRedactedNames, (defaultNames) => [
    ...defaultNames,
    ...overseerAdditionalSensitiveHttpHeaderNames,
  ]),
);

/** Configures how Overseer HTTP headers may be disclosed through diagnostics and traces. */
export const overseerHttpHeaderPolicyLayer = Layer.mergeAll(
  Layer.succeed(HttpClient.TracerHeaderFilter, overseerHttpClientTraceHeaderFilter),
  overseerHttpHeaderRedactionLayer,
);
