# Executor's Agent-Oriented Testing Harness

## Research target

This research inspected [`UsefulSoftwareCo/executor`](https://github.com/UsefulSoftwareCo/executor), formerly `RhysSullivan/executor`, at commit [`624e85f033632a7624c2bddf0944112166b1f481`](https://github.com/UsefulSoftwareCo/executor/commit/624e85f033632a7624c2bddf0944112166b1f481). Rhys Sullivan is the primary contributor and author of the harness work described below.

Executor's default `cloud` end-to-end target is a real application dev stack using real SDKs against wire-level WorkOS and Autumn emulators. It is not a deployment to real provider infrastructure. Executor also has self-host, Docker, workerd, local, desktop, and VM targets. Overseer should borrow its scenario authoring, lifecycle, isolation, evidence, and agent-workflow ideas without weakening Overseer's requirement that acceptance tests deploy through real Cloudflare providers.

## Design evolution

The harness was built as a sequence of focused changes:

1. [#926 — scenario × target framework and evidence-first viewer](https://github.com/UsefulSoftwareCo/executor/pull/926) introduced scenarios written once against deployment targets, typed product surfaces, isolated identities, and per-run evidence.
2. [#942 — Effect dependency injection](https://github.com/UsefulSoftwareCo/executor/pull/942) replaced a separate capability list and context record with Effect services yielded directly by each scenario.
3. [#973 — turnkey worktree setup and atomic ports](https://github.com/UsefulSoftwareCo/executor/pull/973) made concurrent agent worktrees safe, added one-command bootstrap, leak reaping, and run summaries.
4. [#977 — agent evidence workflow and interactive CLI](https://github.com/UsefulSoftwareCo/executor/pull/977) reused the harness's boot, identity, API, MCP, emulator-ledger, and teardown primitives outside Vitest.
5. [#962 — developer-session recordings](https://github.com/UsefulSoftwareCo/executor/pull/962) added Playwright video, terminal casts, step screenshots, and a derived focus timeline.
6. [#979 — suite-owned tracing](https://github.com/UsefulSoftwareCo/executor/pull/979) joined browser and MCP requests to exported server traces and exposed them beside run evidence.
7. [#1205 — remove browse/promote code generation](https://github.com/UsefulSoftwareCo/executor/pull/1205) deliberately removed an over-built interaction-recording-to-test-generation loop. Agents drive the same primitives interactively, then hand-author readable scenarios.
8. [#1258 — CI gate and failure artifacts](https://github.com/UsefulSoftwareCo/executor/pull/1258) made target suites required CI jobs, sharded expensive targets, and uploaded run artifacts on failure.

The progression matters: Executor first established a small scenario contract and shared runtime primitives, then added evidence and agent ergonomics. It later deleted automation that did not improve test quality.

## Core architecture

```text
Vitest project selects target
  target global setup
    claim isolated resources
    boot or attach to application
    boot wire-level emulators and telemetry store

  scenario(name, Effect)
    resolve Target
    construct Effect Context from target capabilities
    create per-scenario run directory
    execute against public surfaces
    capture result and evidence

  target teardown
    stop process groups and emulators
    release claimed resources
```

### Scenario is the only authoring abstraction

[`e2e/src/scenario.ts`](https://github.com/UsefulSoftwareCo/executor/blob/624e85f033632a7624c2bddf0944112166b1f481/e2e/src/scenario.ts) registers a named Effect program as a Vitest test. The test body remains the source of truth for correctness; the harness does not record an alternate assertion model.

A scenario:

- has a product-guarantee name rather than a test identifier;
- yields only the capabilities it uses;
- receives a per-run artifact directory;
- runs through real public surfaces;
- records success, failure, duration, target, and artifacts in `result.json`;
- preserves the scenario source beside the result for review;
- rethrows the original Effect cause after recording evidence.

```ts
scenario(
  "API · typed client lists the available tools",
  {},
  Effect.gen(function* () {
    const target = yield* Target;
    const { client } = yield* Api;
    const identity = yield* target.newIdentity();
    const api = yield* client(coreApi, identity);
    const tools = yield* api.tools.list({ query: {} });
    expect(tools.length, "at least one tool is exposed").toBeGreaterThan(0);
  }),
);
```

### Effect services are capability declarations

[`e2e/src/services.ts`](https://github.com/UsefulSoftwareCo/executor/blob/624e85f033632a7624c2bddf0944112166b1f481/e2e/src/services.ts) defines capabilities including `Target`, `Api`, `Browser`, `Mcp`, `Cli`, `Telemetry`, and `Restart`. A scenario declares its needs by yielding those services; there is no parallel string-based `needs` list.

[`contextFor`](https://github.com/UsefulSoftwareCo/executor/blob/624e85f033632a7624c2bddf0944112166b1f481/e2e/src/scenario.ts) provides only the services supported by the selected target. Executor interprets an Effect missing-service defect as a target-specific skip and records the missing capabilities.

This is useful for Executor's many deployment targets. The skip mechanism relies on parsing Effect's rendered missing-service error and would be too permissive for Overseer's current single acceptance target. In Overseer, an absent required capability should initially fail the harness. Capability-based skips become appropriate only if Overseer later has a genuine target matrix.

### Targets describe deployment shape, not boot mechanics

[`e2e/src/target.ts`](https://github.com/UsefulSoftwareCo/executor/blob/624e85f033632a7624c2bddf0944112166b1f481/e2e/src/target.ts) contains external addresses, identity creation, supported capabilities, and optional operations such as restart. Target boot and teardown remain in target-owned global setup and boot modules.

This keeps three concerns separate:

```text
Target       external contract and identity isolation
Boot recipe  process/provider lifecycle
Surface      how a scenario drives one public interface
```

### Surfaces are real public interfaces

Executor gives scenarios narrow test-facing surfaces rather than raw infrastructure:

- [`Api`](https://github.com/UsefulSoftwareCo/executor/blob/624e85f033632a7624c2bddf0944112166b1f481/e2e/src/surfaces/api.ts) creates an authenticated Effect `HttpApiClient` over the wire.
- [`Browser`](https://github.com/UsefulSoftwareCo/executor/blob/624e85f033632a7624c2bddf0944112166b1f481/e2e/src/surfaces/browser.ts) manages Playwright with `Effect.acquireUseRelease`, traces, video, screenshots, and failure capture.
- MCP, CLI, billing, emulator ledgers, telemetry, and restart are separate capabilities.

Assertions stay in scenario source. Surfaces own transport, authentication, resource lifetime, and diagnostic evidence.

### Isolation uses fresh principals and names, not resets

Each cross-target scenario mints a fresh identity and organization through the real product flow. Shared-singleton targets require scenario-prefixed resources and prohibit global count assertions. External emulators can create per-scenario hosted instances with independent request ledgers.

This gives Executor two composable isolation levels:

```text
shared target instance
  fresh identity / organization per scenario
    uniquely named resources
      finalizers for externally created state
```

Resources requiring cleanup use `Effect.ensuring` or scoped acquisition. Trailing cleanup statements are prohibited because an earlier assertion can interrupt the test.

### Lifecycle primitives are reusable outside tests

Target global setup and the interactive developer CLI call the same boot recipes. [`e2e/scripts/cli.ts`](https://github.com/UsefulSoftwareCo/executor/blob/624e85f033632a7624c2bddf0944112166b1f481/e2e/scripts/cli.ts) supports:

```text
up       boot and retain a target
status   inspect retained targets
identity mint an isolated principal
api      call a typed API operation
mcp      drive an MCP session
ledger   inspect emulator requests
logs     inspect target logs
down     tear down the target
```

This creates a deliberate agent workflow:

```text
boot with production-like composition
  drive public surfaces interactively
  inspect logs and upstream ledgers
  hand-author a readable scenario
  run the narrow scenario
  hand back evidence and a browsable instance
```

The CLI stores deliberate long-lived instance state separately from leaked processes. Executor also has a reaper for orphaned stacks.

### Evidence is a first-class output

Each scenario-target run receives a stable directory containing a structured verdict and available evidence:

```text
runs/<target>/<scenario>/
  result.json
  test.ts
  trace.zip
  session.mp4
  failure.png
  <step>.png
  traces.json
  timeline.json
```

Browser and MCP surfaces collect distributed trace identifiers. A suite-owned telemetry store receives the application's real exports, allowing a run viewer to link one user action to its server/database trace waterfall. CI uploads run directories when a job fails.

Executor's root [`AGENTS.md`](https://github.com/UsefulSoftwareCo/executor/blob/624e85f033632a7624c2bddf0944112166b1f481/AGENTS.md) treats user-visible work as incomplete without a specific end-to-end run, inspectable evidence, and a browsable development instance.

### Test quality is partly enforced mechanically

Executor combines written policy with lint rules and agent skills:

- import test APIs from `@effect/vitest`, not raw `vitest`;
- prohibit conditional assertions;
- assert values rather than booleans;
- avoid sleeps and poll observable conditions;
- drive only public surfaces;
- use fresh identities and finalizers;
- do not weaken assertions to make a suite green.

The custom `no-conditional-tests` lint rule points agents directly to the relevant test-writing skill.

## What Overseer should adopt

### Adopt directly

1. **One readable scenario registration shape.** A test should read as a product guarantee and ordinary Effect program.
2. **Effect services for harness capabilities.** Scenario requirements remain visible in types and are provided by the suite composition root.
3. **Typed and raw HTTP surfaces.** Typed calls cover normal contracts; raw calls cover malformed paths, media types, authentication failures, and undecodable responses.
4. **Fresh scenario data.** Every test gets unique domain values and never depends on another test's mutation.
5. **Scoped cleanup.** External resources and scenario-specific infrastructure use Effect finalizers.
6. **Structured run evidence.** Record scenario, stage, duration, status, request IDs, and safe request summaries even before Overseer has a browser.
7. **Shared test/interactive primitives.** Agents should be able to deploy, call, inspect, and destroy through the same code the suite uses.
8. **Narrow iteration and full final validation.** Agents may run one scenario while developing; final validation still runs Overseer's complete fresh deployed-stack suite.
9. **Agent-facing policy plus lint guardrails.** Make good test structure the easy and searchable path.
10. **Hand-authored tests.** Do not generate test source from recorded interactions.

### Adapt for Overseer

1. **Keep real provider deployment.** Executor's emulated dev stack is not equivalent to Overseer's acceptance boundary. Overseer's primary suite must continue deploying Alchemy resources through real Cloudflare providers.
2. **Use stage isolation before identity isolation.** A fresh Alchemy stage isolates each invocation. Unique Workspace and later Project/Issue values isolate scenarios within that stage.
3. **Capture API evidence first.** Overseer currently has no SPA. Start with method, canonical path, status, elapsed time, `X-Overseer-Request-Id`, and redacted error/result metadata. Add Playwright artifacts only when a browser client exists.
4. **Treat Access credentials as sensitive.** Never record Access client secrets, complete headers, or unredacted request bodies.
5. **Use explicit failure scenario Stacks.** Internal failures that cannot be induced through production should use controlled dependency Layers in separately named deployed scenario Stacks, not test switches in production handlers.
6. **Fail missing capabilities initially.** Overseer has one acceptance target. Automatic capability skips would hide harness defects.

### Do not adopt yet

- a generic multi-target registry;
- target capability auto-skipping;
- port-block claiming for the real deployed suite;
- a React evidence viewer;
- video, terminal theater, or focus-timeline machinery;
- sharding before suite duration demonstrates a need;
- a record-and-promote or generated-test workflow;
- broad emulator infrastructure without an actual external dependency.

## Proposed Overseer primitive set

The smallest useful design is:

```text
apps/api/test/
  e2e.test.ts
  e2e/
    access.ts
    workspace.ts
    harness/
      deployed-api.ts      # parsed deployment output; no raw Alchemy values inward
      services.ts          # Effect tags exposed to scenarios
      scenario.ts          # one registration shape + evidence finalization
      typed-api.ts         # authenticated generated HttpApi client
      raw-api.ts           # status/body/header requests for protocol failures
      test-data.ts         # unique valid and invalid domain inputs
      evidence.ts          # redacted request/result/request-id ledger
      run-context.ts       # stage, run id, artifact root, timing
  scripts/
    run-e2e.ts             # unique stage, child lifecycle, signals, fallback destroy
    inspect-e2e.ts         # summary and safe artifact inspection
```

Suggested services:

```text
DeployedApi       base URL and parsed non-secret deployment identity
AgentApi          authenticated typed public client
RawApi            redaction-aware raw HTTP client
TestData          run/scenario-qualified domain values
Evidence          structured request and result ledger
RunContext        stage, run ID, scenario identity, artifact directory
```

A future browser client can add `Browser` without changing API scenarios. A future controlled failure Stack can provide the same `AgentApi` and `RawApi` contracts from a different suite composition root.

## Recommended implementation order

1. Build `run-e2e.ts`: generate a unique stage, invoke the uncached suite, handle signals, and perform fallback Alchemy destruction.
2. Extract the current deployment result into a parsed `DeployedApi` service.
3. Build typed and raw HTTP surfaces with authentication and mandatory redaction.
4. Build deterministic run/scenario-qualified test data.
5. Introduce `scenario()` with structured `result.json` and request-ID evidence.
6. Move the current identity smoke test onto those primitives.
7. Implement Access and Workspace scenario modules and their error-path matrix.
8. Add an interactive command only after the underlying deploy/client/evidence primitives are stable.
9. Add lint rules for direct Vitest imports, conditional assertions, and bypassing the scenario/public-surface boundary when actual misuse appears.

## Conclusion

Executor's strongest idea is not its viewer or its target matrix. It is the alignment of four interfaces:

```text
what an agent uses to inspect the product
  = what a scenario uses to drive the product
  = what CI uses to validate the product
  = what a reviewer receives as evidence
```

Overseer can obtain that alignment with a much smaller harness because it currently has one deployed target and one public API surface. The first valuable slice is the stage-owning runner, typed/raw clients, fresh test data, and structured request-ID evidence. Everything else should earn its place from a demonstrated second surface or target.
