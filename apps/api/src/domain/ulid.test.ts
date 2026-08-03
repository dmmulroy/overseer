import { expect, it } from "@effect/vitest";
import { Effect, Random, Schema } from "effect";
import { TestClock } from "effect/testing";
import { generateUlid, Ulid } from "./ulid.ts";

it.effect("generates canonical lexicographically time-ordered ULIDs", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1_700_000_000_000);
    const earlier = yield* generateUlid;
    yield* TestClock.setTime(1_700_000_000_001);
    const later = yield* generateUlid;

    expect(Schema.is(Ulid)(earlier)).toBe(true);
    expect(Schema.is(Ulid)(later)).toBe(true);
    expect(earlier < later).toBe(true);
  }).pipe(Random.withSeed("workspace-ulid-test")),
);
