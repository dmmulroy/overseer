import * as Schema from "effect/Schema";

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const maximumTimestamp = 2 ** 48 - 1;

/** Unsigned 48-bit epoch-millisecond timestamp accepted by a ULID. */
export const UlidTimestamp = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: maximumTimestamp }),
).pipe(Schema.brand("UlidTimestamp"));

/** Unsigned 48-bit epoch-millisecond timestamp accepted by a ULID. */
export type UlidTimestamp = typeof UlidTimestamp.Type;

/** Exactly 80 bits of entropy accepted by a ULID. */
export const UlidEntropy = Schema.Uint8Array.check(
  Schema.makeFilter((entropy) => entropy.byteLength === 10, {
    expected: "a Uint8Array containing exactly 10 bytes",
  }),
).pipe(Schema.brand("UlidEntropy"));

/** Exactly 80 bits of entropy accepted by a ULID. */
export type UlidEntropy = typeof UlidEntropy.Type;

/** Canonical 26-character Universally Unique Lexicographically Sortable Identifier. */
export const Ulid = Schema.String.check(Schema.isPattern(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)).pipe(
  Schema.brand("Ulid"),
);

/** Canonical 26-character Universally Unique Lexicographically Sortable Identifier. */
export type Ulid = typeof Ulid.Type;

function encodeTimestamp(timestamp: number): string {
  let remaining = timestamp;
  let encoded = "";
  for (let index = 0; index < 10; index += 1) {
    encoded = crockford[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function encodeRandom(bytes: Uint8Array): string {
  let bits = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += crockford[(bits >>> bitCount) & 31];
      bits &= (1 << bitCount) - 1;
    }
  }
  return encoded;
}

/** Build a ULID from a refined timestamp and exactly 80 bits of refined entropy. */
export function makeUlid(timestamp: UlidTimestamp, entropy: UlidEntropy): Ulid {
  return Ulid.make(`${encodeTimestamp(timestamp)}${encodeRandom(entropy)}`);
}
