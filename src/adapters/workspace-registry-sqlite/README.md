# Workspace Registry SQLite adapter

This directory implements the persistence service owned by the Workspace Registry application against the SQLite database of the singleton Workspace Registry Durable Object.

## Main modules

### `workspace-registry-migrations.ts`

Defines ordered forward-only schema migrations for Workspace, Project, and shared registry idempotency records. Its effect-discard Layer keeps migration failures typed until the Durable Object constructor logs and rejects initialization.

### `workspace-registry-sqlite-state.ts`

The canonical `layer` yields `SqlClient.SqlClient` and provides `WorkspaceRegistryStateService`. Its named `Effect.fn` operations own:

- SQL statements and Cloudflare SQLite transactions;
- row-to-domain parsing;
- scope-bound Workspace and Project keyset pagination with opaque cursors;
- idempotency lookup and retention;
- classification of SQL and corrupt-record failures with object-local causes.

The Layer closes over the one `@effect/sql-sqlite-do` client created for the current Durable Object activation. Application code sees only the persistence service, never a SQL client or row.

## Boundary rules

Persisted rows are untrusted and are parsed on every read. SQL errors and corrupt rows remain detailed inside the object. The Durable Object RPC boundary logs safe classifications and sends cause-free tagged remote failures. SQL rows, statements, bindings, and raw causes never cross RPC or HTTP.
