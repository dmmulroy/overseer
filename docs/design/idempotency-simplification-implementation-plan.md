# Idempotency simplification implementation plan

This plan is written for an implementation agent with no prior conversation context. Read the governing material before changing code:

1. [`../../AGENTS.md`](../../AGENTS.md)
2. [`../../CONTEXT.md`](../../CONTEXT.md)
3. `/Users/dmmulroy/.agents/skills/coding-standards/SKILL.md`
4. Every applicable coding-standards reference, especially:
   - `workflows-transactions-and-idempotency.md`
   - `modules-services-and-adapters.md`
   - `persistence.md`
   - `testing.md`
   - `effect.md` and its applicable branches
5. `/Users/dmmulroy/.agents/skills/codebase-design/SKILL.md`
6. `/Users/dmmulroy/.agents/skills/codebase-design/DEEPENING.md`

Do not preserve old code merely for compatibility. Overseer has not been deployed, so there is no persisted production data and no migration compatibility requirement. Rewrite the initial schema and delete obsolete code and tests.

## Goal

Replace the current fingerprint-and-snapshot idempotency machinery with a small Stripe-like key-to-result mechanism.

The safety requirement is narrow:

> If a successful create commits but its response is lost, repeating the key must return the entity created by the first successful use and must not create another entity.

Do not add a generic idempotency service. Idempotency belongs to the authoritative object's existing transaction and persistence capability.

## Settled product contract

- `Idempotency-Key` remains required for ordinary create POSTs.
- A key is scoped to its authoritative Durable Object.
- A key is not scoped to an authenticated principal.
- In the current singleton Workspace Registry, Workspace and Project creation share one key namespace because the Registry owns both operations.
- A successful key maps to exactly one Workspace or Project creation result.
- First successful use wins.
- Replays ignore changed request bodies, authenticated principals, and Project target paths.
- Replaying a Workspace creation key through Workspace creation returns that Workspace's current data.
- Replaying a Project creation key through Project creation returns that Project's current data, even if the repeated request names another Workspace.
- Reusing a Workspace creation key through Project creation, or a Project creation key through Workspace creation, returns `409 idempotency_key_reused` because the stored result has the wrong response type.
- A replay returns `201`, the entity's canonical `Location`, and `Idempotency-Replayed: true`.
- No HTTP response bytes, historical response body, request body, request fingerprint, or canonical target are retained.
- Invalid requests do not reserve keys.
- Failed transactions do not reserve keys.
- Entity creation and key recording commit in one SQLite transaction.
- Keys do not expire in this implementation. Do not add TTL, cleanup, alarms, or retention workflows.
- Future Project-owned creates store keys in that Project Durable Object. Do not coordinate keys across Durable Objects.

This deliberately differs from Stripe's full parameter-comparison contract: Overseer does not compare repeated request parameters. “Stripe-like” here means that a caller-provided key resolves retries to the result of the first successful operation.

## Existing behavior being removed

The current implementation:

- derives an `IdempotencyScope` from the authenticated principal;
- passes scope and key through HTTP, application, RPC, and SQLite;
- calculates operation-specific request fingerprints;
- stores complete Workspace or Project JSON snapshots;
- reads the same idempotency row once for its fingerprint and again for its typed payload;
- detects body, target, and cross-operation conflicts;
- uses a shared table with required `workspace_json` and nullable `project_json`;
- writes Project JSON into both columns for compatibility with the original schema.

Delete these behaviors rather than adapting them.

## Target persistence schema

Replace the current idempotency table with this table in the fresh initial schema:

```sql
CREATE TABLE idempotency_keys (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  created_workspace_id TEXT REFERENCES workspaces(id),
  created_project_id TEXT REFERENCES projects(id),
  CHECK (
    (created_workspace_id IS NOT NULL AND created_project_id IS NULL) OR
    (created_workspace_id IS NULL AND created_project_id IS NOT NULL)
  )
);
```

The populated foreign-key column identifies both the result type and entity. Do not add:

- an operation string;
- a canonical target;
- a fingerprint;
- request JSON;
- response JSON;
- a timestamp with no current behavior;
- in-progress state.

Create `idempotency_keys` after both entity tables in the initial schema.

## Target application value

Replace the two fingerprint-bearing retained creation types with one application-owned tagged union:

```ts
export type RecordedCreation =
  | {
      readonly _tag: "WorkspaceCreation";
      readonly workspace: Workspace;
    }
  | {
      readonly _tag: "ProjectCreation";
      readonly project: Project;
    };
```

Persistence retains only an entity reference. `findRecordedCreation` resolves and parses the entity's current state before returning this value. The name must not imply that a historical entity snapshot was retained.

Use the project's established tagged-union pattern. If the type never crosses a serialized boundary, a plain closed TypeScript union is sufficient; do not introduce a schema only for construction convenience.

## Target state interface

Delete these five methods from `WorkspaceRegistryState`:

```text
findIdempotencyFingerprint
findWorkspaceCreation
findProjectCreation
insertWorkspaceCreation
insertProjectCreation
```

Add these three methods:

```ts
readonly findRecordedCreation: (
  key: IdempotencyKey,
) => Effect.Effect<
  Option.Option<RecordedCreation>,
  WorkspaceRegistryPersistenceError
>;

readonly insertWorkspaceCreation: (
  workspace: Workspace,
  key: IdempotencyKey,
) => Effect.Effect<void, WorkspaceRegistryPersistenceError>;

readonly insertProjectCreation: (
  project: Project,
  key: IdempotencyKey,
) => Effect.Effect<void, WorkspaceRegistryPersistenceError>;
```

Keep the existing application-owned `state.transaction(...)`. The Workspace Registry application owns replay and conflict policy; the SQLite adapter owns queries, row parsing, inserts, unique constraints, and rollback.

Do not add an `IdempotencyService`, repository, provider, manager, or callback dependency.

## Exact create behavior

### Workspace creation

Inside the existing `state.transaction(...)`:

1. Call `state.findRecordedCreation(input.idempotencyKey)` exactly once.
2. If it returns `WorkspaceCreation`, return its Workspace with `replayed: true`.
3. If it returns `ProjectCreation`, fail with `IdempotencyKeyReused`.
4. If no key exists, allocate the timestamp and Workspace ID.
5. Construct the Workspace.
6. Call `state.insertWorkspaceCreation(workspace, input.idempotencyKey)`.
7. Return the Workspace with `replayed: false`.

### Project creation

Inside the existing `state.transaction(...)`:

1. Call `state.findRecordedCreation(input.idempotencyKey)` before checking the requested Workspace.
2. If it returns `ProjectCreation`, return its Project with `replayed: true`. Do not compare the repeated request's Workspace or name.
3. If it returns `WorkspaceCreation`, fail with `IdempotencyKeyReused`.
4. If no key exists, verify that the requested Workspace exists.
5. Allocate the timestamp and Project ID.
6. Construct the Project.
7. Call `state.insertProjectCreation(project, input.idempotencyKey)`.
8. Return the Project with `replayed: false`.

The replay lookup occurs before Workspace validation so a successful Project creation remains replayable even when the repeated request names a nonexistent or different Workspace.

## File-by-file source changes

### `src/domain/idempotency.ts`

- Delete the `IdempotencyScope` schema and type.
- Keep `IdempotencyKey` and its current bounded visible-ASCII validation.
- Update its documentation to say that it identifies the first successful create result in an authoritative object.
- Do not tighten it to UUID-only syntax without a separate product decision.

### `src/domain/README.md`

- Remove `IdempotencyScope` from the module description.
- Describe `IdempotencyKey` using the settled contract above.

### `src/adapters/gateway/gateway-request-context.ts`

- Remove the `IdempotencyScope` import.
- Remove `idempotencyScope` from `GatewayRequest`.
- Keep `requestId` and `GatewayRequestContext`; request-scoped problem rendering still needs them.

### `src/adapters/gateway/gateway-application.ts`

- Remove the `IdempotencyScope` import.
- Remove principal-to-scope construction.
- Provide `GatewayRequestContext.of({ requestId })` only.
- Remove `AuthenticatedPrincipal` from the import if it becomes unused in this file.
- Do not change authentication, Origin checks, Agent-session parsing, body inspection, schema failure handling, or defect handling.

### `src/adapters/gateway/workspace-http.ts`

- Stop yielding `GatewayRequestContext` in `createWorkspaceResponse`; this operation no longer needs request-scoped data.
- Call `workspaceRegistry.createWorkspace({ name, idempotencyKey })`.
- Keep `Idempotency-Replayed` based on the existing `replayed` result field.
- Keep `IdempotencyKeyReused` in the Workspace failure union.
- Change its HTTP detail from “different request” to wording that says the key already identifies a Project creation.
- Do not change list, read, rename, or response behavior.

### `src/adapters/gateway/project-http.ts`

- Stop yielding `GatewayRequestContext` in `createProjectResponse`.
- Call `workspaceRegistry.createProject({ workspaceId, name, idempotencyKey })`.
- Keep the replay header.
- Keep `IdempotencyKeyReused` in the Project failure union.
- Change its HTTP detail to say the key already identifies a Workspace creation.
- Do not compare the repeated request's Workspace or name in this adapter.

### `src/adapters/gateway/problem-response.ts`

- Keep `idempotency_key_reused` as a non-retryable `409`.
- No structural change is expected.

### `src/adapters/gateway/workspace-registry-rpc-client.ts`

- Account for scope-free RPC create inputs.
- Keep `CreateWorkspaceRpcInput.make(...)` and `CreateProjectRpcInput.make(...)` at the private RPC edge.
- No policy or transport change is intended.

### `src/adapters/gateway/README.md`

- Remove principal-derived `IdempotencyScope` from the request path.
- Document object-local key ownership.
- Document first-successful-use, current-data replay, and cross-result-type conflict.
- Explicitly say that body, principal, and Project target changes are ignored on replay.

### `src/contract/http-api.ts`

- Keep the required `idempotency-key` header.
- Keep `idempotency_key_reused`, status `409`, and create error declarations.
- Update only comments or annotations that imply principal scope or full request comparison.
- Do not change the public request shape.

### `src/contract/request-schemas.ts`

- No behavior change is expected.
- The required header remains in both create request schemas.
- The content-addressed request-schema hashes should remain stable because the wire schemas are unchanged.

### `src/application/workspace-registry/workspace-registry-rpc.ts`

- Remove the `IdempotencyScope` import.
- Remove `idempotencyScope` from `CreateWorkspaceRpcInput`.
- Remove `idempotencyScope` from `CreateProjectRpcInput`.
- Keep `idempotencyKey` in both inputs.
- Keep `CreateWorkspaceRpcResult` and `CreateProjectRpcResult`, including `replayed`.
- Keep `IdempotencyKeyReused`.
- Change its documentation and message so conflict means that the key identifies another creation result type, not that request parameters differ.
- Keep all other RPC method signatures and errors unchanged.

### `src/application/workspace-registry/workspace-registry.ts`

- Remove the `IdempotencyScope` import.
- Delete `IdempotencyFingerprint` and its schema.
- Delete `RetainedWorkspaceCreation` and `RetainedProjectCreation`.
- Add `RecordedCreation`.
- Replace the five old state methods with the three target methods.
- Delete `CreateWorkspaceFingerprint` and `CreateProjectFingerprint`.
- Rewrite Workspace and Project creation exactly as specified in “Exact create behavior.”
- Keep `state.transaction(...)`, ID generation, timestamps, result wrappers, and precise errors.
- Update comments and public wording to remove fingerprints, request comparison, and historical snapshots.
- Do not change list, read, or rename operations.

### `src/application/workspace-registry/README.md`

- Replace fingerprint/snapshot policy with first-successful-key-use policy.
- Document one key lookup and current-entity replay.
- State that the application distinguishes Workspace and Project creation results.
- Preserve the current ownership allocation: application policy in the application module and SQL/row mechanics in the adapter.

### `src/adapters/workspace-registry-sqlite/workspace-registry-migrations.ts`

- Rewrite `1_initialize_workspace_registry` as the complete fresh schema for Workspaces, Projects, indexes, and `idempotency_keys`.
- Delete `workspace_registry_idempotency`.
- Delete `2_add_projects`.
- Delete its `ALTER TABLE`.
- Simplify the migration implementation if the existing split statement arrangement no longer helps readability.
- Do not create migration compatibility columns, data copies, or dual schemas.

### `src/adapters/workspace-registry-sqlite/workspace-registry-sqlite-state.ts`

Remove:

- the `IdempotencyFingerprint` import;
- `WorkspaceJson`;
- `ProjectJson`;
- the old `IdempotencyRow` shape;
- `idempotencyRow`;
- all fingerprint parsing;
- all replay JSON parsing and encoding;
- the Project-to-`workspace_json` compatibility write and comment.

Add a private raw row type for:

```ts
type RecordedCreationRow = {
  readonly created_workspace_id: unknown;
  readonly created_project_id: unknown;
};
```

Implement `findRecordedCreation`:

1. Select both result IDs by key.
2. Return `Option.none()` when no row exists.
3. Parse exactly one populated ID.
4. For a Workspace ID, load the Workspace through the existing parsed Workspace lookup and return `WorkspaceCreation`.
5. For a Project ID, load the Project through the existing parsed Project lookup and return `ProjectCreation`.
6. Treat malformed IDs, invalid nullability, or missing referenced entities as `WorkspaceRegistryStoredRecordCorrupt` with `recordType: "idempotency"`.
7. Preserve underlying persistence errors rather than wrapping them a second time.

Simplify `insertWorkspaceCreation`:

1. Insert the Workspace row.
2. Insert an `idempotency_keys` row containing the key and Workspace ID.

Simplify `insertProjectCreation` similarly with the Project ID.

These inserts execute inside the transaction opened by the application. Preserve named `Effect.fn` boundaries and existing SQL-error classification.

### `src/adapters/workspace-registry-sqlite/README.md`

- Replace JSON replay-record documentation with key-to-entity references.
- State that persisted key rows and referenced entities are parsed on replay.
- Remove fingerprint, response-snapshot, and migration-compatibility claims.

### `src/infra/workspace-registry.ts`

- Keep `IdempotencyKeyReused` in local and remote create error unions.
- Scope-free RPC input types should flow through the existing operations.
- Do not change Layer composition, Durable Object topology, or persistence error translation.
- Update comments only where they describe old idempotency semantics.

### `src/infra/README.md`

- State that each authoritative Durable Object owns its keys locally.
- Explain that Workspace and Project creation currently share the Registry namespace because both live there.
- State that future Project-owned creates use Project-local key storage.
- Explicitly reject deployment-global uniqueness and cross-object reservation.

## File-by-file test and fixture changes

### `tests/application/workspace-registry.test.ts`

- Remove `IdempotencyScope`, `IdempotencyFingerprint`, and fingerprint-bearing retained creation imports.
- Change the harness to retain `Option.Option<RecordedCreation>`.
- Implement `findRecordedCreation` and the simplified inserts.
- Change create input to `{ name, idempotencyKey }`.
- Keep the create/replay test and `replayed` assertions.
- Replace the fingerprint mismatch test with a cross-result-type conflict test, such as supplying a recorded Project creation to Workspace creation.
- Do not add body-comparison behavior.
- Keep rename behavior tests unchanged.

### `tests/fixtures/workspace-registry.ts`

- Remove scope-related type fallout.
- Keep result wrappers and `IdempotencyKeyReused` in expected error unions.
- Do not add a separate idempotency fake or service.

### `tests/fixtures/gateway-worker.ts`

- Keep `IdempotencyKeyReused` in Workspace and Project create failure schemas.
- Update only scope-free RPC schema fallout.

### `tests/fixtures/workspace-registry-migration-control-worker.ts`

Replace `fail-second-insert` with behavior-oriented controls:

- `fail-creation-key-write`
- `allow-creation-key-write`
- `corrupt-creation-key`

`fail-creation-key-write` should install a trigger that aborts an `idempotency_keys` insert for one fixed test key. `allow-creation-key-write` should remove that trigger so the same key can be retried successfully.

`corrupt-creation-key` should prepare a key record whose referenced entity cannot be resolved. Use the narrowest test-only SQLite manipulation supported by the fixture. The production schema remains fully constrained.

Keep migration poisoning/repair and Workspace corruption controls.

The fixture may know private SQL details; HTTP and RPC tests should invoke behavioral actions and should not assert table names or statement order.

### `tests/http/workspaces.test.ts`

Replace the principal-isolation test with cross-principal replay:

1. A human creates a Workspace with a key.
2. An Agent repeats Workspace creation using the same key and any body.
3. The Agent receives the same Workspace ID and `Idempotency-Replayed: true`.

Change same-key/different-name behavior:

- return `201`, not `409`;
- return the first Workspace;
- include the replay header;
- do not create the second requested name.

Add or extend coverage for current-data replay:

1. Create a Workspace.
2. Rename it.
3. Replay the creation key.
4. Assert the original ID, current name, canonical `Location`, `201`, and replay header.

Keep all validation, media-type, listing, pagination, read, and rename tests unchanged.

### `tests/http/projects.test.ts`

- Keep same-key Project replay.
- Change cross-Workspace-target reuse from `409` to replaying the original Project.
- Add same-key/same-result-type/different-name replay.
- Keep cross-result-type reuse as `409` by reusing a Workspace creation key through Project creation.
- Add current-data replay after Project rename and assert ID, current name, `201`, `Location`, and replay header.
- Assert no duplicate Project is created.
- Keep unrelated Project behavior tests unchanged.

### `tests/http/discovery.test.ts`

- No intended change.
- Keep the assertion that create request schemas require `idempotency-key`.

### `tests/workerd/alchemy-runtime.test.ts`

- Remove `idempotencyScope: null` from malformed direct RPC input.
- Keep malformed `name` and/or `idempotencyKey` to prove RPC input validation still rejects invalid values.
- Keep concurrent equal-key serialization and exactly one replay response.
- Keep reconstruction replay coverage.

Preserve and strengthen rollback coverage:

1. Install `fail-creation-key-write`.
2. Attempt a create with its fixed key.
3. Assert failure.
4. Assert the entity was rolled back.
5. Remove the injected failure.
6. Retry the same key.
7. Assert creation succeeds, proving the failed transaction did not reserve the key.

Add stored-key corruption coverage:

- prepare a key record whose entity cannot be resolved;
- verify private RPC exposes cause-free `WorkspaceRegistryRecordCorrupt`;
- verify public HTTP maps it to `503 service_unavailable`.

Do not assert raw table names from the public behavior test.

### `tests/browser/app-shell.test.ts`

- No intended behavior change.
- Existing setup continues to send required keys.

## Documentation changes

### `docs/adr/0001-mvp-system-architecture.md`

- Remove principal-global scope.
- Remove request fingerprint language.
- Remove exact historical status/body replay.
- Remove 24-hour retention claims.
- Define authoritative-object-local key ownership and current-data replay.
- State that the same key may be reused in different Durable Objects.
- Explain why current Workspace and Project creates share a namespace.
- Mark #52 resolved through local ownership rather than coordination.
- Replace abstract “apply/complete #52 protocol” sequence steps with key lookup and mutation in the authoritative object's transaction.
- Remove claims of cross-object conflict detection.

### `docs/design/mvp-program-design.md`

- Remove fingerprint equality as a domain decision.
- Replace the old state operations with `findRecordedCreation` and the two creation inserts.
- Remove future Gateway-level ordinary-POST idempotency ports.
- State that each authoritative object handles key-to-result storage in its own transaction capability.
- Remove speculative `IdempotencyInProgress` examples unless another implemented workflow independently requires them.
- Explicitly reject a generic idempotency service.
- Update diagrams and call-flow text that reference #52-selected coordination.

### `docs/design/mvp-vertical-slices.md`

- Change acceptance from body-conflict behavior to first-successful-use replay.
- Keep cross-result-type conflict only where both result types share an object namespace.
- Remove #52 as a prerequisite or blocker.
- State local authoritative-object ownership in carried-forward contracts.

## Required behavior tests

The completed implementation must prove these observable behaviors through real interfaces:

1. A successful Workspace retry returns one Workspace and the replay header.
2. A successful Project retry returns one Project and the replay header.
3. Concurrent equal-key requests create exactly one entity.
4. Changed body is ignored on replay.
5. Changed Project target is ignored on replay.
6. Another authenticated principal receives the same recorded result for the same object-local key.
7. Cross-result-type reuse returns `409 idempotency_key_reused`.
8. Replay after rename returns the current data with the original ID.
9. A failed key write rolls back entity creation and does not reserve the key.
10. Durable Object reconstruction preserves key behavior.
11. Corrupt key references become a cause-free remote corruption error and public `503`.

Prefer HTTP/workerd tests with real SQLite for transaction, query, serialization, corruption, and concurrency behavior. Do not replace the removed machinery with a large in-memory idempotency implementation.

## Verification sequence

1. Run focused Workspace Registry application tests while changing interfaces.
2. Run focused Workspace and Project HTTP tests.
3. Run workerd tests for concurrency, rollback/retry, reconstruction, and corruption.
4. Run `npm run typecheck` and fix every stale caller.
5. Search for removed concepts:

```bash
rg -i \
  'IdempotencyScope|IdempotencyFingerprint|fingerprint|workspace_registry_idempotency|workspace_json|project_json|IdempotencyInProgress' \
  src tests docs
```

Account for every remaining hit. Generic uses of the English word “idempotent” for unrelated behavior may remain; removed symbol and schema names may not.

6. Re-read the applicable coding-standards references and audit every changed interface and abstraction.
7. Run the repository-required command:

```bash
npm run check
```

Do not declare completion if any exception is unexplained.

## Explicit non-goals

- No generic Idempotency Effect service.
- No principal scope.
- No deployment-global key coordination.
- No cross-object conflict detection.
- No request canonicalization or hashing.
- No body or target comparison.
- No request or response snapshots.
- No historical response replay.
- No in-progress state.
- No TTL or cleanup workflow.
- No compatibility migration, dual read, dual write, or backfill.
- No changes to authentication, Agent sessions, request IDs, entity IDs, or non-create operations.
