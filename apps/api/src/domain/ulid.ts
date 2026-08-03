import { Clock, Effect, Random, Schema } from "effect";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RANDOM_CHARACTER_COUNT = 16;

/** Canonical uppercase 26-character Universally Unique Lexicographically Sortable Identifier. */
export const Ulid = Schema.String.check(Schema.isPattern(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)).pipe(
  Schema.brand("Ulid"),
);

/** A validated canonical ULID. */
export type Ulid = typeof Ulid.Type;

const encodeUlidTimestamp = (epochMilliseconds: number): string => {
  let remaining = Math.floor(epochMilliseconds);
  let encoded = "";
  for (let index = 0; index < 10; index += 1) {
    encoded = ULID_ALPHABET.charAt(remaining % 32) + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
};

/** Generate a canonical ULID from the active Effect clock and random services. */
export const generateUlid: Effect.Effect<Ulid> = Effect.gen(function* () {
  const epochMilliseconds = yield* Clock.currentTimeMillis;
  const randomCharacters = yield* Effect.forEach(
    Array.from({ length: ULID_RANDOM_CHARACTER_COUNT }),
    () => Random.nextIntBetween(0, 31),
  );
  const random = randomCharacters.map((index) => ULID_ALPHABET.charAt(index)).join("");

  return Ulid.make(`${encodeUlidTimestamp(epochMilliseconds)}${random}`);
}).pipe(Effect.withSpan("Ulid.generate"));
