import * as Schema from "effect/Schema";

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const workspaceIdPattern = /^workspace_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Immutable, canonical identity for a Workspace. */
export const WorkspaceId = Schema.String.check(
  Schema.isPattern(workspaceIdPattern),
).pipe(Schema.brand("WorkspaceId"));

/** Immutable, canonical identity for a Workspace. */
export type WorkspaceId = typeof WorkspaceId.Type;

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

/**
 * Allocate a canonical prefixed ULID for a Workspace from injected entropy.
 *
 * @throws When the entropy source violates the internal ten-byte invariant.
 */
export function makeWorkspaceId(now: Date, entropy: Uint8Array): WorkspaceId {
  if (entropy.byteLength !== 10) {
    throw new Error("Workspace ULID allocation requires exactly 10 entropy bytes");
  }
  return WorkspaceId.make(
    `workspace_${encodeTimestamp(now.getTime())}${encodeRandom(entropy)}`,
  );
}
