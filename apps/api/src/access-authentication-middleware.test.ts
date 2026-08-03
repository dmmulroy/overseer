import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Redacted, Result } from "effect";
import { cloudflareAccessVerifierLayerForEnvironment } from "./access-authentication-middleware.ts";
import {
  CloudflareAccessPrincipal,
  CloudflareAccessVerifier,
} from "./cloudflare-access-verifier.ts";
import { CloudflareAccessSubject, EmailAddress } from "./domain/actor.ts";

const environmentProvider = (environment: "development" | "production") =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      OVERSEER_ENVIRONMENT: environment,
    }),
  );

describe("Overseer environment Cloudflare Access verifier", () => {
  it.effect("uses the fixed local principal during development", () =>
    Effect.gen(function* () {
      const verifier = yield* CloudflareAccessVerifier;
      const principal = yield* verifier.verifyAccessAssertion(Redacted.make("not-a-jwt"));

      expect(principal).toEqual(
        CloudflareAccessPrincipal.cases.HumanPrincipal.make({
          subject: CloudflareAccessSubject.make("local-human"),
          email: EmailAddress.make("local@overseer.invalid"),
        }),
      );
    }).pipe(
      Effect.provide(cloudflareAccessVerifierLayerForEnvironment),
      Effect.provide(environmentProvider("development")),
    ),
  );

  it.effect("requires production verifier configuration in production", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        Effect.gen(function* () {
          return yield* CloudflareAccessVerifier;
        }).pipe(Effect.provide(cloudflareAccessVerifierLayerForEnvironment)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("ConfigError");
      }
    }).pipe(Effect.provide(environmentProvider("production"))),
  );
});
