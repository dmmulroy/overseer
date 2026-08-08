# Testing

## Strategy

Overseer favors real-cloud end-to-end tests over every other test form.

The default test suite deploys a fresh `OverseerApi` Stack with `alchemy/Test/Vitest`, sends real HTTP requests through its Cloudflare Access-protected custom domain, exercises the Worker, application services, Durable Object HTTP boundaries, Bookkeeper, and SQLite storage, and destroys the Stack afterward.

Every public feature and endpoint must have deployed end-to-end coverage for:

- successful behavior;
- authentication and authorization;
- malformed external input;
- every caller-reachable error contract;
- persistence across requests;
- state transitions and idempotency guarantees;
- meaningful concurrency, recovery, or asynchronous behavior.

A feature is not complete merely because a unit, integration, or workerd test covers it.

For detailed Alchemy and `@effect/vitest` API research, see [`research/alchemy-effect-vitest-testing.md`](research/alchemy-effect-vitest-testing.md).

## Default Test Lifecycle

Every local or automated test invocation:

1. Generates a unique DNS-safe Alchemy stage such as `test-<user>-<run-id>`.
2. Deploys a fresh real-cloud `OverseerApi` Stack.
3. Waits for the Access-protected public URL to become ready.
4. Runs the complete endpoint and feature matrix.
5. Destroys the Stack and its test data.
6. Attempts fallback cleanup if the test process fails after deployment.

Assume provisioning test infrastructure is cheap, fast, and free. Cost is not a reason to reuse infrastructure, skip a cloud boundary, or replace cloud coverage with workerd.

A stage is shared only within one test invocation. Never test against `local`, a developer deployment stage, `production`, or another test run's stage. Concurrent invocations remain isolated through distinct run IDs.

## Alchemy Harness

The production-Stack suite uses `alchemy/Test/Vitest`:

```ts
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
  stage: process.env.ALCHEMY_TEST_STAGE,
  dev: false,
});

const stack = beforeAll(deploy(Stack), { timeout: 300_000 });
afterAll(destroy(Stack), { timeout: 300_000 });
```

Use `Test.executeWhenReady` for the initial authenticated readiness request. It retries deployment-readiness failures without hiding ordinary authorization failures.

Deploy once per production-Stack suite file. Keep the cloud tests sequential initially so Vitest workers cannot race deployment and destruction.

## Suite Organization

```text
apps/api/test/
  e2e/cloud/
    overseer-api.cloud.test.ts  # owns deployment, shared context, and teardown
    access.cloud-spec.ts        # registers Access and identity cases
    workspace.cloud-spec.ts     # registers all public Workspace cases
    cloud-test-client.ts        # typed and raw HTTP helpers
    cloud-test-data.ts          # unique valid test values
  e2e/workerd/
    overseer-api.workerd.test.ts
  run-cloud-tests.mjs           # unique stage and fallback lifecycle cleanup
```

Only `overseer-api.cloud.test.ts` is independently discovered by Vitest. The `*.cloud-spec.ts` modules export functions that register feature-specific tests into that shared suite.

Split the cloud suite into multiple independently discovered files only when each file owns a separate stage and Stack lifecycle, or when a run-wide deployment fixture safely coordinates them.

## Initial Public API Matrix

Assume the main Worker adds public Workspace handlers backed by `WorkspaceClient`, which routes operations to the `WorkspaceServer` Durable Object keyed by `WorkspaceId`.

The concrete public `HttpApi` remains the source of truth. This initial outline assumes:

```text
GET  /
POST /v1/workspaces
GET  /v1/workspaces/:workspaceId
POST /v1/workspaces/:workspaceId/rename
POST /v1/workspaces/:workspaceId/archive
POST /v1/workspaces/:workspaceId/unarchive
```

### Access and API identity

- A provisioned Agent service token reaches `GET /` and receives the API identity.
- Missing Access credentials are rejected at the public edge.
- Invalid service-token credentials are rejected.
- Every Workspace endpoint rejects an unauthenticated request, proving authentication middleware is attached to each route.
- Access secrets and complete response headers are never logged or snapshotted.

### Create Workspace

- A valid name creates an active Workspace with a canonical generated ID and parseable timestamps.
- A separate GET returns the persisted Workspace.
- Distinct creates return distinct IDs backed by independent Durable Object state.
- Missing, malformed, empty, whitespace-only, overlong, multiline, control-character, and otherwise invalid names return the declared request error without creating a Workspace.
- Success demonstrates that deployed Bookkeeper registration completed. Do not expose Bookkeeper's internal API solely for testing.

### Get Workspace

- A created Workspace is returned by ID with its complete representation.
- A valid unknown ID returns the public not-found contract.
- A malformed path ID returns the public request-parsing contract.

### Rename Workspace

- Rename changes only the name and update timestamp.
- ID, creation timestamp, and lifecycle state are preserved.
- A following GET observes the new name.
- A valid unknown ID returns not found.
- Invalid names return the declared request error and leave the Workspace unchanged.
- The contract must explicitly decide whether archived Workspaces can be renamed; test the resulting behavior.

### Archive and unarchive Workspace

- Archive changes and persists the state to `archived`.
- Unarchive changes and persists the state to `active`.
- Identity, name, and creation timestamp remain unchanged.
- Archive and unarchive of an unknown ID each return not found.
- Repeated archive and unarchive operations cover the declared idempotency or transition-error contract.
- A complete create, rename, archive, read, unarchive, read journey preserves coherent state and nondecreasing timestamps.

### Protocol and concurrency

- Wrong methods, malformed JSON, unsupported content types, and unexpected payload fields cover Overseer's declared HTTP behavior.
- Concurrent mutations against one Workspace verify that deployed Durable Object serialization and the mutation semaphore prevent corruption.
- Concurrency assertions describe legal final outcomes without assuming request arrival order.
- Typed clients verify normal application responses. Raw status and body assertions cover Access edge and malformed protocol responses.

## Error-Path Accounting

Maintain a matrix beside each feature spec that maps every declared success and error variant to a test.

Caller-inducible errors must run against the production Stack. Examples include:

- missing or invalid authentication;
- malformed payloads, paths, and queries;
- unknown IDs;
- illegal state transitions;
- ownership failures and conflicts;
- invalid pagination cursors.

Some internal failures cannot be safely induced through the production public API, including the current Workspace reasons `database_unavailable`, `stored_workspace_invalid`, `workspace_registration_failed`, and `workspace_id_mismatch`.

Never add production test-only endpoints, corruption switches, or fault flags. Prefer, in order:

1. An additional Alchemy-deployed scenario Stack using the same public handlers with a controlled dependency Layer.
2. A real-cloud test through an existing operational boundary that naturally creates the condition.
3. A focused integration test through the real service or HTTP interface when a scenario Stack would misrepresent production.

Every error covered below the production Stack records why it cannot safely be induced there.

## Supporting Tests

Supporting tests are narrower tools, not substitutes for cloud acceptance.

### Integration

Use integration tests for otherwise uncontrollable failure translations, real SQLite migrations and transactions, and application behavior through public Effect service or HTTP interfaces. Provide complete test Layers; module mocking with `vi.mock` is forbidden.

### Unit and property

Use focused tests for nontrivial pure invariants, state transitions, normalization, ordering, idempotency, and regressions. Do not restate straightforward Schema declarations or Effect/library behavior.

### Workerd

Workerd is an explicitly selected emulator-only feedback mode. It does not accept Cloudflare Access, custom-domain deployment, cloud permissions, or real Durable Object provisioning. The default local `test` command still deploys a fresh real-cloud Stack.

## Effect Vitest Conventions

- Use ordinary `it` for synchronous pure behavior.
- Use `it.effect` for scoped Effect programs and test services such as `TestClock`.
- Alchemy's harness uses live runtime services for deployment and HTTP I/O.
- Use `layer(...)` only when one acquired Layer is intentionally shared by the block.
- Provide a fresh Layer per test when mutable state must be isolated.
- Assert public values, errors, responses, and persisted state—not implementation calls or spies.
- Use bounded schedules for polling and explicit timeouts for deployment and cloud operations.

## Target Commands

The testing implementation should provide these commands:

```sh
pnpm test                # focused tests, then a fresh cloud Stack and full matrix
pnpm test:e2e:cloud      # fresh cloud Stack and full matrix only
pnpm test:fast           # explicit narrower unit/integration choice
pnpm test:e2e:workerd    # explicit emulator-only choice
```

`pnpm test` is the complete suite. It must not be cached. `test:fast` and `test:e2e:workerd` are convenience commands and must not be described as equivalent confidence.

The cloud runner owns unique stage generation and fallback cleanup. The Alchemy Vitest `afterAll(destroy(Stack))` hook remains the primary teardown path.
