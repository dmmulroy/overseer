# Domain

Domain modules define Overseer's language, identities, invariants, and pure construction rules. They are framework-independent and perform no I/O.

The canonical vocabulary lives in [`../../CONTEXT.md`](../../CONTEXT.md). Names here should match that language.

## Current modules

- `actor.ts` defines authenticated principals, actor-related IDs, request IDs, and Agent-session value types.
- `entity-id.ts` defines branded immutable Workspace IDs and their ULID construction rule.
- `idempotency.ts` defines `IdempotencyScope`, which partitions caller keys, and `IdempotencyKey`, the caller-supplied replay key.
- `pagination.ts` defines the opaque branded Workspace cursor.
- `ulid.ts` defines canonical ULID parsing and pure construction from a timestamp and entropy.
- `workspace.ts` defines exact Workspace names, canonical timestamps, and the parsed Workspace record.

## Rules

- Parse less-trusted values through Effect Schema before they enter inner code.
- Preserve exact validated display text unless the domain explicitly defines normalization.
- Use brands where mixing raw strings would create a realistic error.
- Keep optionality and lifecycle states explicit.
- Do not read ambient time or randomness; accept constructed values or expose pure constructors over injected inputs.
- Do not import HTTP, SQLite, React, Cloudflare, or Alchemy types.
