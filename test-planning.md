# Overseer Test Harness Planning

This document records testing-harness decisions settled through collaborative design. Executor research and existing strategy remain in [`docs/research/executor-agent-testing-harness.md`](docs/research/executor-agent-testing-harness.md) and [`docs/testing.md`](docs/testing.md); they are not duplicated here.

## Runtime vocabulary and ownership

### Test run

One execution of an end-to-end command. The test run owns the target (`local` or `deployed`), unique Alchemy stage, and the ultimate guarantee that no resources remain after it exits. `pnpm test:e2e:local` is the fast workerd feedback loop; `pnpm test:e2e` and `pnpm test:e2e:deployed` retain real Cloudflare acceptance semantics.

### Deployed Stack

The real Cloudflare infrastructure acquired for one test run. Raw Alchemy output is parsed at the harness boundary before it is used to construct runtime services.

The test run semantically owns the Stack lifetime. For deployed runs, Alchemy's Vitest hooks perform normal deployment and destruction while the outer runner handles process interruption and fallback destruction. For local runs, Vitest closes Alchemy's dev sidecar before the outer runner destroys local Stack state; this avoids the pinned sidecar teardown deadlock while preserving one semantic owner.

### Test harness and test suites

The test harness is the shared machinery that connects Alchemy lifecycle hooks and the target-aware `OverseerApiClient` Layer to test authoring. `OverseerTestHarness.fromStack(Stack)` configures it once for the selected local or deployed Stack and returns the registration API used by feature suites.

A test suite is a feature-oriented group of tests, such as the Workspace suite in `e2e/workspace.ts` or the Access suite in `e2e/access.ts`. Suites use the shared harness but do not own the Stack lifecycle. `apps/api/test/e2e.test.ts` is the composition root that creates the harness and loads those suites.

### Test

A test is a named product guarantee expressed as an Effect program. One test execution is the smallest independently reported verdict unit. The end-to-end harness executes each registered test exactly once.

### Evidence and artifacts

No evidence or artifact contract has been selected. Do not add manifests, evidence services, artifact roots, or persistence behavior until that design is explicitly settled.

## Parsed runtime values

The harness parses external and serialized test-run data before constructing runtime services.

- `OverseerTestTarget` is the parsed `local` or `deployed` execution target.
- `TestStage` is the DNS-safe, test-only Alchemy stage generated for that run.
- `TestRun` groups the target and stage selected by the outer runner.
- `OverseerApiDeployment` is a schema-defined tagged union. The local variant contains its workerd URL; the deployed variant contains its public URL and wrapped Cloudflare Access credentials.
- Cloudflare Access credential fields remain `Redacted.Redacted<string>` values and are unwrapped only by the HTTP adapter performing authenticated I/O.

These values are construction inputs, not a general ambient context service. Tests receive only the narrower runtime capabilities that need them.

## HTTP test-driving boundary

The harness supplies only `OverseerApiClient` to feature tests. It does not widen every test to also require an ambient raw `HttpClient`. The raw malformed-protocol boundary remains deferred until a concrete case establishes the smallest useful API.

## Test authoring API

`OverseerTestHarness.fromStack(Stack)` configures the shared Alchemy lifecycle and returns the `harness.test(...)` registration API passed to feature suites. A feature module such as `workspace.ts` or `access.ts` is a test suite; the returned harness is not itself a suite.

The harness is a module-registration value rather than an Effect service: Vitest tests and hooks must be declared before test Effects run. Runtime capabilities used inside those Effects are supplied through Layers. The only test service supplied by the harness is `OverseerApiClient`; raw protocol support is not added until a concrete protocol case establishes its boundary.

## Authenticated API client

`OverseerApiClient` is an Effect service whose shape is the schema-derived `HttpApiClient.ForApi<typeof OverseerHttpApi>`. Its Layer owns the authenticated `HttpClient` transformation and generated-client construction. Test code yields `OverseerApiClient`; it does not receive deployment output or construct authenticated clients itself.

The parsed deployment value remains a construction input at the composition root. A Layer factory may close over that dynamic value without exposing it as an ambient service.

## Generated test data

Effect Schema-derived FastCheck arbitraries may construct a small deterministic set of valid mock inputs for an end-to-end test. This does not make the test a property: the harness executes it once, with no repeated runs or shrinking.

Property testing remains a separate supporting-test technique outside the local and deployed end-to-end harness. Arbitraries used there should derive broad valid values from owning schemas and use explicit property preconditions when composition requires them. No harness property API or sampling service is justified.

## Lifecycle shape

```text
test run
  allocate an isolated stage
  spawn Vitest
    acquire selected local or deployed Stack
    run feature test suites with the OverseerApiClient Layer
    release the Stack and target-specific runtime resources
  destroy local state, or fallback-destroy a failed deployed stage
```

The design starts with one Stack per test run and fresh, test-qualified domain data within that Stack. It supports exactly two explicit targets: local workerd infrastructure for iteration and real deployed Cloudflare infrastructure for acceptance. A generic target registry, automatic capability skips, Stack-per-test lifecycles, and sharding are not part of the initial model.

## Implementation order

Build the harness as green vertical slices. Each new primitive must be proved by the next real deployed behavior rather than accumulated as unused framework code.

### Target files

```text
apps/api/
├── scripts/
│   └── run-e2e.ts
└── test/
    ├── e2e.test.ts
    └── e2e/
        ├── overseer-test-run.ts
        ├── overseer-api-deployment.ts
        ├── overseer-api-client.ts
        ├── overseer-test-harness.ts
        ├── access.ts
        └── workspace.ts
```

Do not create separate arbitrary, fixture, helper, or utility modules until actual size or reuse earns them.

### 1. Parse test-run configuration

Create `overseer-test-run.ts` with `OverseerTestTarget`, `TestStage`, `TestRun`, and an Effect Config definition. Invalid or missing configuration must fail before deployment, with no fallback to `local`, `test`, or `production`.

### 2. Add the outer runner

Create `run-e2e.ts` to select the local or deployed target and generate a unique DNS-safe stage; spawn Vitest with that environment; forward signals; and guarantee target-appropriate destruction. Expose `test:e2e:local` for fast iteration while keeping `test:e2e` and `test:e2e:deployed` as real Cloudflare acceptance.

### 3. Parse and ready the deployment

Create `overseer-api-deployment.ts`. Define `OverseerApiDeployment` with Effect Schema and derive its TypeScript type. Parse local Stack output into the workerd URL and deployed Stack output into the public URL and redacted Access credentials. Reject missing deployed secrets. Keep target-specific DNS, authentication, and API readiness in this module because it owns the question of whether a parsed Overseer deployment is ready to drive.

### 4. Build `OverseerApiClient`

Create `overseer-api-client.ts` with the service interface, `OverseerApiClient` tag, and Layer. The Layer combines the parsed deployment, ambient Effect `HttpClient`, Access headers, base URL, and schema-derived `HttpApiClient`. Add a focused recording-client test proving URL and authentication behavior without exposing credentials to callers.

### 5. Build `OverseerTestHarness.fromStack` with `.test` only

Create `overseer-test-harness.ts`. Its first version loads Effect Config, calls Alchemy `Test.make` with target-aware dev mode, registers deploy/readiness in `beforeAll`, coordinates target-appropriate destruction, and provides the `OverseerApiClient` Layer to each test Effect. The returned harness is a registration-time value, not an Effect service.

### 6. Move the existing Access smoke test

Create `access.ts`, load it from `e2e.test.ts`, and move the authenticated identity check onto `harness.test(...)` with `yield* OverseerApiClient`. Delete the old implementation only after the replacement passes against real Cloudflare infrastructure.

This completes the first vertical slice:

```text
outer runner
  → Alchemy deployment
  → parsed and ready deployment
  → OverseerApiClient Layer
  → harness.test
  → real authenticated request
```

### 7. Add one ordinary Workspace test

Create `workspace.ts` and add one create-then-read test through `OverseerApiClient`. The test may sample deterministic valid mock data from `WorkspaceName`'s schema-derived arbitrary, but it executes once. Load the Workspace suite from `e2e.test.ts`.

### 8. Grow the Workspace suite

Add one behavior at a time in this order:

1. create then read;
2. rename then read;
3. archive then read;
4. unarchive then read;
5. complete create/rename/archive/unarchive journey;
6. valid unknown Workspace ID;
7. malformed Workspace ID;
8. invalid names;
9. idempotent or illegal repeated transitions;
10. malformed HTTP protocol cases;
11. concurrent mutations.

Each test executes once with independent data, runs narrowly through `pnpm test:e2e:local` during development, then passes the complete deployed `pnpm test:e2e` suite before the next behavior is added. Protocol cases remain deferred until their raw HTTP boundary is designed from a concrete test.

### 9. Finish the Workspace error-path matrix

Compare every Workspace endpoint's success and declared public errors against deployed coverage, including authentication, malformed input, persistence, transitions, and meaningful concurrency. Internal failures that cannot safely be induced through production remain separate deployed failure-Stack work rather than production test switches.

### Defer until the Workspace suite is green

- all evidence, artifact persistence, and evidence-viewer design;
- a multi-target registry or capability skipping;
- sharding;
- per-test Access tokens;
- a generic fixture DSL;
- a generic protocol client.

The critical dependency chain is:

```text
Effect Config
  → outer runner
  → deployment parser and readiness
  → OverseerApiClient Layer
  → harness.test
  → authenticated smoke test
  → first Workspace test
  → deterministic Workspace lifecycle and error cases
  → complete Workspace matrix
```
