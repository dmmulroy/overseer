import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { type Ulid, UlidEntropy, UlidTimestamp, makeUlid } from "../domain/ulid.ts";

/** Capability for allocating time-ordered application identities. */
export type UlidGenerator = {
  readonly next: () => Effect.Effect<Ulid>;
};

/** Effect service for allocating time-ordered application identities. */
export class UlidGeneratorService extends Context.Service<UlidGeneratorService, UlidGenerator>()(
  "@overseer/application/UlidGenerator",
) {}

/** Construct the production ULID generator from runtime cryptography. */
export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  return UlidGeneratorService.of({
    next: Effect.fn("UlidGenerator.next")(function* () {
      const now = yield* DateTime.now;
      // A compliant Crypto service can reject randomBytes only for an invalid size.
      // Ten bytes is the fixed ULID entropy width, so rejection is an implementation defect.
      const entropy = yield* crypto.randomBytes(10).pipe(Effect.orDie);
      return makeUlid(UlidTimestamp.make(DateTime.toEpochMillis(now)), UlidEntropy.make(entropy));
    }),
  });
});

/** Production ULID generator backed by Effect's Clock and runtime cryptography. */
export const layer = Layer.effect(UlidGeneratorService, make);
