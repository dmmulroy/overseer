# Testing

## Strategy

Overseer favors deployed-stack integration tests over every other test form. These tests exercise Overseer end to end through its deployed public API.

The acceptance suite deploys a fresh `OverseerApi` Stack with `alchemy/Test/Vitest`, sends real HTTP requests through its Cloudflare Access-protected custom domain, exercises the Worker, application services, Durable Object HTTP boundaries, Bookkeeper, and SQLite storage, and destroys the Stack afterward. A target-equivalent local suite runs the same feature tests through Alchemy's workerd infrastructure for fast iteration, but it does not replace deployed acceptance.

Every public feature and endpoint must have deployed end-to-end coverage for:

- successful behavior;
- authentication and authorization;
- malformed external input;
- every caller-reachable error contract;
- persistence across requests;
- state transitions and idempotency guarantees;
- meaningful concurrency, recovery, or asynchronous behavior.

A feature is not complete merely because a unit, service integration, or local-runtime integration test covers it.

For detailed Alchemy and `@effect/vitest` API research, see [`research/alchemy-effect-vitest-testing.md`](research/alchemy-effect-vitest-testing.md).

## Test Targets

- `local` runs the same feature suites through Alchemy's workerd, local Durable Objects, and local SQLite infrastructure. It is the fast debugging and development loop.
- `deployed` provisions real Cloudflare infrastructure, custom DNS, and Access. It remains the acceptance boundary and the meaning of `pnpm test:e2e`.

Feature suites consume the same `OverseerApiClient` service for both targets. Target-specific deployment parsing, readiness, authentication, and teardown remain harness concerns.

## Default Test Lifecycle

Every deployed test invocation:

1. Generates a unique DNS-safe Alchemy stage such as `test-<user>-<timestamp>-<entropy>`.
2. Deploys a fresh `OverseerApi` Stack through the real providers.
3. Waits for the Access-protected API Worker and Workspace Durable Object to become ready.
4. Runs the registered feature tests.
5. Destroys the Stack and its test data through the Vitest lifecycle hook.
6. Runs outer fallback cleanup only if the deployed test process fails or is interrupted.

Assume provisioning test infrastructure is cheap, fast, and free. Cost is not a reason to reuse infrastructure, skip a deployed provider boundary, or replace deployed-stack coverage with a local runtime.

A stage is shared only within one test invocation. Never test against `local`, a developer deployment stage, `production`, or another test run's stage. Concurrent invocations remain isolated through distinct stages.

## Alchemy Harness

The suite creates one registration-time harness and shares its Stack lifecycle across feature modules:

```ts
const harness = OverseerTestHarness.fromStack(OverseerApiStack);

registerAccessTestSuite(harness);
registerWorkspaceTestSuite(harness);
```

`OverseerTestHarness.fromStack` owns `alchemy/Test/Vitest` deployment, readiness, service Layers, and teardown. Readiness first verifies the authenticated API identity, then retries a safe known-absent Workspace read until the Workspace Durable Object returns its stable not-found contract.

Deploy once per integration suite file. Keep deployed tests sequential so Vitest workers cannot race deployment and destruction.

## Suite Organization

```text
apps/api/
  scripts/
    run-e2e.ts                   # selects target, creates stage, and owns fallback cleanup
  test/
    e2e.test.ts                  # composes one shared harness and feature suites
    e2e/
      access.ts                  # registers the API identity guarantee
      workspace.ts               # registers public Workspace guarantees
      overseer-test-run.ts       # parses target and isolated stage
      overseer-api-deployment.ts # parses deployment output and owns readiness
      overseer-api-client.ts     # target-aware typed public API client
      overseer-test-harness.ts   # deployment, teardown, and test registration
```

Only `e2e.test.ts` is independently discovered by Vitest. The feature modules export functions that register tests into that shared integration suite without using test-runner-discovered filenames.

Split the integration suite into multiple independently discovered `*.e2e.test.ts` files only when each file owns a separate stage and Stack lifecycle, or when a run-wide deployment fixture safely coordinates them.

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
2. A deployed-stack integration test through an existing operational boundary that naturally creates the condition.
3. A focused integration test through the real service or HTTP interface when a scenario Stack would misrepresent production.

Every error covered below the production Stack records why it cannot safely be induced there.

## Supporting Tests

Supporting tests are narrower tools, not substitutes for deployed-stack acceptance.

### Integration

Use integration tests for otherwise uncontrollable failure translations, real SQLite migrations and transactions, and application behavior through public Effect service or HTTP interfaces. Provide complete test Layers; module mocking with `vi.mock` is forbidden.

### Unit and property

Use focused tests for nontrivial pure invariants, state transitions, normalization, ordering, idempotency, and regressions. Property execution belongs in this supporting-test layer, not in the local or deployed end-to-end harness. Do not restate straightforward Schema declarations or Effect/library behavior.

### Local runtime

The local-runtime integration target is an explicitly selected emulator-only feedback mode. It does not cover Cloudflare Access, custom-domain deployment, provider permissions, or real Durable Object provisioning. It remains a qualified local counterpart rather than a separate test category or a substitute for the deployed-stack integration suite.

## Generated End-to-End Test Data

End-to-end tests may sample a small, deterministic set of valid mock values from Effect Schema-derived FastCheck arbitraries. Sampling is only test-data construction: the harness executes each registered test once and does not run FastCheck properties, shrinking, or repeated generated infrastructure scenarios.

## Effect Vitest Conventions

- Use ordinary `it` for synchronous pure behavior.
- Use `it.effect` for scoped Effect programs and test services such as `TestClock`.
- Alchemy's harness uses live runtime services for deployment and HTTP I/O.
- Use `layer(...)` only when one acquired Layer is intentionally shared by the block.
- Provide a fresh Layer per test when mutable state must be isolated.
- Assert public values, errors, responses, and persisted state—not implementation calls or spies.
- Use bounded schedules for polling and explicit timeouts for deployment and provider operations.

## Target Commands

The repository provides these commands:

```sh
pnpm test                 # unit tests, then real Cloudflare acceptance
pnpm test:unit            # unit tests only
pnpm test:e2e:local       # fast workerd end-to-end feedback
pnpm test:e2e             # real Cloudflare acceptance
pnpm test:e2e:deployed    # explicit alias for real Cloudflare acceptance
```

`pnpm test` is the complete suite. `test:e2e` runs without task caching so every invocation deploys and verifies a fresh Stack. `test:unit` is an explicit narrower choice and must not be described as equivalent confidence.

The outer runner generates a unique stage for every invocation. Deployed runs use Alchemy's Vitest `afterAll(destroy(Stack))` hook as primary teardown; the outer runner invokes fallback destruction only after failure or interruption. Local runs first close the dev sidecar, then let the outer runner destroy local Stack state to avoid the pinned sidecar teardown deadlock.
