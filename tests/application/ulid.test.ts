import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { Ulid, UlidEntropy, UlidTimestamp, makeUlid } from "../../src/domain/ulid.ts";

const timestamp = (value: number) => UlidTimestamp.make(value);
const entropy = (value: Uint8Array) => UlidEntropy.make(value);

describe("ULID", () => {
  it("encodes the timestamp and entropy at their field boundaries", () => {
    expect(makeUlid(timestamp(0), entropy(new Uint8Array(10)))).toBe("00000000000000000000000000");
    expect(makeUlid(timestamp(2 ** 48 - 1), entropy(new Uint8Array(10).fill(0xff)))).toBe(
      "7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
    );
  });

  it("orders distinct millisecond timestamps lexicographically", () => {
    const fixedEntropy = entropy(new Uint8Array(10).fill(0x7f));
    expect(
      makeUlid(timestamp(1_000), fixedEntropy) < makeUlid(timestamp(1_001), fixedEntropy),
    ).toBe(true);
  });

  it("rejects non-canonical encodings and invalid refined inputs", () => {
    expect(Schema.is(Ulid)("8ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false);
    expect(Schema.is(Ulid)("01J0000000000000000000000I")).toBe(false);
    expect(Schema.is(UlidTimestamp)(-1)).toBe(false);
    expect(Schema.is(UlidTimestamp)(2 ** 48)).toBe(false);
    expect(Schema.is(UlidTimestamp)(1.5)).toBe(false);
    expect(Schema.is(UlidEntropy)(new Uint8Array(9))).toBe(false);
  });
});
