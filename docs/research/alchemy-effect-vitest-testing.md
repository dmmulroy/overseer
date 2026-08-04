# Testing Alchemy v2 + Effect with `@effect/vitest`

_Researched 2026-08-04 against this repository's pinned `alchemy@2.0.0-beta.67`, `effect@4.0.0-beta.102`, `@effect/vitest@4.0.0-beta.102`, and Vitest 4.1.10._

## Recommendation

Use a deliberately top-heavy test pyramid:

1. **Real-cloud end-to-end tests are the acceptance suite.** Deploy the actual `OverseerApi` stack once, exercise complete caller-visible workflows through its Access-protected HTTP URL, and destroy it.
2. **Integration tests cover important behavior below HTTP** when an end-to-end test would be too slow or too opaque: application services with behaviorally faithful test Layers, persistence against a real test database implementation, and HTTP handlers through their public contract.
3. **Unit tests are only for important, nontrivial pure rules** such as state transitions, ownership rules, pagination cursor scoping, normalization, or deterministic algorithms.

This follows Alchemy's intended `deploy -> assert -> destroy` model: one real Stack deployment per suite, shared by all tests in the file ([Testing](https://alchemy.run/testing/), [Testing a Stack](https://alchemy.run/testing/testing-a-stack/)). Local workerd tests are a fast supporting tier, not a substitute for the real-cloud acceptance suite: they cannot establish that Cloudflare Access, routes/DNS, account permissions, edge propagation, or real Durable Object deployment work.

## Test tiers and locations

```text
apps/api/
  src/
    **/*.test.ts                    # pure unit + in-process integration tests
  test/
    e2e/
      overseer-api.local.test.ts    # workerd/local-provider feedback suite
      overseer-api.cloud.test.ts    # real Cloudflare acceptance suite
```

Keep one cloud E2E file per deployed Stack initially. Alchemy deploys once **per file**, while Vitest runs test files in parallel by default; splitting one shared Stack across concurrently executing files creates deploy/destroy races even if the files use the same stage and remote state. Vitest's `fileParallelism: false`/`--no-file-parallelism` forces one file worker ([Vitest `fileParallelism`](https://vitest.dev/config/fileparallelism.html)). Alchemy documents that identical remote state plus stage can make a second file's deploy a no-op, but that does not make one file's `afterAll(destroy(...))` safe while another file is still asserting ([Testing a Stack: share one Stack](https://alchemy.run/testing/testing-a-stack/#share-one-stack-across-files)).

### Tier 1: real-cloud E2E

Cover a small number of high-value workflows, each crossing the real boundaries it claims to test. For this project that should eventually include:

- a service token reaching the protected Worker and becoming the expected Agent actor;
- one Workspace -> Project -> Issue lifecycle through the public API;
- persistence across separate requests and Durable Object activations;
- one caller-visible authorization denial;
- one important asynchronous or failure-recovery workflow, if introduced.

Do not write a test that only checks that the Stack returned a string URL. The HTTP workflow already proves that the URL, Worker deployment, bindings, application wiring, and response behavior are usable.

### Tier 1b: local workerd E2E

Run the same functional journey where practical with `dev: true` or `ALCHEMY_DEV=1`. Current Alchemy runs Workers in workerd and emulates KV, R2, D1, and Queues with `dev:` IDs; unsupported local resources still run against the cloud, and `Alchemy.remote()` opts an emulatable resource back into real-cloud behavior ([Local development](https://alchemy.run/environments/local-development), [provider-mode source](../../repos/alchemy/packages/alchemy/src/ProviderMode.ts)).

The current stack branches on `AlchemyContext.dev`: local mode omits Access resources and selects the synthetic local Access verifier, whereas production provisions the Access application and service token ([stack](../../apps/api/alchemy.run.ts), [verifier](../../apps/api/src/cloudflare-access-verifier.ts)). Therefore, local tests verify Worker/application behavior and middleware plumbing, **not** Cloudflare Access itself. A local request may send a dummy `Cf-Access-Jwt-Assertion`; the production E2E must use the provisioned service-token headers.

### Tier 2: integration

Use integration tests for observable application-owned behavior that benefits from narrower diagnosis:

- service behavior through its public Effect service interface, providing a complete behaviorally faithful test Layer;
- SQL migrations, transaction behavior, persistence mapping, and domain invariants against the real SQLite implementation used in tests;
- HTTP status/body/error translation through an in-process HTTP API;
- cross-service behavior where the production network/runtime boundary adds no information to the case.

Provide each test's Layer separately when state must be isolated. `@effect/vitest`'s `layer(...)` constructs one Layer for a whole block and closes its scope afterward, so mutable state is intentionally shared between tests in that block ([Effect layer guide](../../repos/effect/ai-docs/src/09_testing/20_layer-tests.ts), [implementation](../../repos/effect/packages/vitest/src/internal/internal.ts)). Use shared Layers only when sharing is part of the fixture design, never to create order-dependent tests accidentally.

### Tier 3: unit

Use ordinary `it` for synchronous pure functions and `it.effect` for Effect programs. `it.effect` supplies test services such as `TestClock`, scopes acquired resources, and suppresses normal logs; `it.live` uses live runtime services. Alchemy's Vitest adapter deliberately runs harness tests with `it.live`, because deploys and HTTP calls require live time and I/O ([Effect testing guide](../../repos/effect/ai-docs/src/09_testing/10_effect-tests.ts), [`@effect/vitest` source](../../repos/effect/packages/vitest/src/index.ts), [Alchemy Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)).

```ts
import { assert, describe, it } from "@effect/vitest";
import { Effect, Random } from "effect";
import { TestClock } from "effect/testing";

describe("important application-owned rule", () => {
  it("selects the next allowed state", () => {
    assert.strictEqual(nextIssueState("open", "block"), "blocked");
  });

  it.effect("uses deterministic time and randomness", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_700_000_000_000);
      const first = yield* generateId;
      yield* TestClock.adjust(1);
      const second = yield* generateId;
      assert.isTrue(first < second);
    }).pipe(Random.withSeed("id-ordering")),
  );
});
```

Use `it.effect.prop` with Schema/FastCheck arbitraries only for meaningful algebraic or domain invariants, not to sample a schema declaration that already states the constraint. `@effect/vitest` also exposes `skip`, `skipIf`, `runIf`, `only`, `each`, `fails`, `live`, and nested/shared `layer` APIs in the pinned source ([API types](../../repos/effect/packages/vitest/src/index.ts)).

## Exact Alchemy Vitest pattern

The installed API is `alchemy/Test/Vitest`. `Test.make` currently accepts `providers`, optional `state`, `profile`, `stage`, `adopt`, and `dev`; the last two are present in the pinned source even though the public harness page's option list currently omits them ([core source](../../repos/alchemy/packages/alchemy/src/Test/Core.ts), [public harness](https://alchemy.run/testing/test-harness/)). Its return surface is:

- `test(name, effect, options?)`, plus `skip`, `skipIf`, `only`, `todo`, and `test.provider`; a fetch-backed `HttpClient` is in every harness Effect, while `test.provider` additionally provides the configured provider Layer to its body;
- `beforeAll(effect, options?)`, which stores one result and returns its lazy Effect accessor;
- `beforeEach(effect)` / `afterEach(effect)` for side-effect-only per-test fixtures;
- `afterAll(effect)` and `afterAll.skipIf(predicate)(effect)`;
- `deploy(Stack, { stage? })` / `destroy(Stack, { stage? })`.

The adapter's deploy/destroy hooks default to 120 seconds. `beforeEach`/`afterEach` and test bodies use the runner timeout unless an option is supplied. See the pinned adapter for the exact overloads and modifiers ([Alchemy Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)).

A real-cloud test for the current stack should have this form:

```ts
// apps/api/test/e2e/overseer-api.cloud.test.ts
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { assert } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { HttpClientRequest } from "effect/unstable/http";
import Stack from "../../alchemy.run.ts";

const stage = process.env.ALCHEMY_TEST_STAGE ?? "test";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
  stage,
  dev: false,
});

const stack = beforeAll(deploy(Stack), { timeout: 300_000 });

afterAll.skipIf(process.env.NO_DESTROY === "1")(
  destroy(Stack),
  { timeout: 300_000 },
);

test(
  "an Agent reaches the Access-protected Overseer API",
  Effect.gen(function* () {
    const output = yield* stack;
    if (
      !("agentClientId" in output) ||
      !("agentClientSecret" in output) ||
      output.agentClientSecret === undefined
    ) {
      assert.fail("cloud Stack did not return a complete Access service token");
    }

    const request = HttpClientRequest.get(output.url).pipe(
      HttpClientRequest.setHeader("CF-Access-Client-Id", output.agentClientId),
      HttpClientRequest.setHeader(
        "CF-Access-Client-Secret",
        Redacted.value(output.agentClientSecret),
      ),
    );
    const response = yield* Test.executeWhenReady(request);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(yield* response.json, "Overseer API");
  }),
  { timeout: 120_000 },
);
```

Cloudflare specifies those two headers for service-token authentication ([Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#connect-your-service-to-access)); Alchemy's service-token output keeps the secret as `Redacted<string> | undefined` because Cloudflare only returns it on create/rotation ([Alchemy `ServiceToken`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts)). Never print or snapshot it.

`beforeAll(deploy(Stack))` returns a lazy Effect accessor; `yield* stack` reads the result inside tests. The adapter uses one shared scope across deploy, tests, and teardown so local sidecar/workerd processes survive the hook boundary. `destroy(Stack)` closes that scope after destruction; a fallback `afterAll` still closes it when destruction is skipped. Deploy/destroy hooks default to 120 seconds, but ordinary Vitest tests retain Vitest's shorter default unless given their own timeout ([Alchemy Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)).

A local variant uses `dev: true`, `Alchemy.localState()`, only the local output, and a dummy assertion header:

```ts
// Same imports as above, plus: import * as Alchemy from "alchemy";
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Alchemy.localState(),
  stage: "test-local",
  dev: true,
});

const stack = beforeAll(deploy(Stack), { timeout: 120_000 });
afterAll(destroy(Stack), { timeout: 120_000 });

test("serves the authenticated API in local workerd", Effect.gen(function* () {
  const { url } = yield* stack;
  const request = HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeader("Cf-Access-Jwt-Assertion", "local-test"),
  );
  const response = yield* Test.executeWhenReady(request);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(yield* response.json, "Overseer API");
}));
```

Do not pass the documented `localState({ path: ... })` sketch: in the pinned beta, `Alchemy.localState()` takes no arguments and always uses `.alchemy/state`; stack name and stage provide the namespace ([pinned `LocalState`](../../repos/alchemy/packages/alchemy/src/State/LocalState.ts)).

## Readiness, polling, and cleanup

- `Test.executeWhenReady(request)` and `getWhenReady(url)` retry only `404` and `5xx`, 20 recurrences by default, with exponential delay from 500 ms. They intentionally return `400`/`401`/`403` immediately so authorization assertions are not hidden ([HTTP helper source](../../repos/alchemy/packages/alchemy/src/Test/Http.ts), [stack guide](https://alchemy.run/testing/testing-a-stack/#retry-the-first-request)). If newly created Access policy propagation is observed to produce temporary `403`, add a narrowly typed, bounded retry around only the authenticated readiness probe; do not globally retry authorization failures.
- Poll queues/workflows with `Effect.repeat` and a bounded `Schedule`; every retry/repeat needs a finite `times`, and the test timeout must exceed the total schedule. Avoid deadline `while` loops, which do not cooperate with interruption ([stack guide](https://alchemy.run/testing/testing-a-stack/#poll-async-effects)).
- Destroy by default. `NO_DESTROY=1` should be an explicit local debugging optimization, not normal behavior. CI must always destroy.
- `test.provider` is for authors testing an Alchemy provider's create/update/replace/delete lifecycle, not for Overseer application tests. It uses a private per-test in-memory state store; the pinned Vitest adapter additionally runs `scratch.destroy()` with `Effect.ensuring`, including on failure/interruption ([provider testing](https://alchemy.run/testing/testing-providers), [adapter cleanup](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)). A hard-killed process can still orphan real resources because scratch state disappears, another reason not to use it here.
- A failed or killed top-level run can outlive `afterAll`. Use remote state plus an `if: always()` CI cleanup step (`pnpm exec alchemy destroy --stage "$ALCHEMY_TEST_STAGE" --yes`) and retain the same credentials/config environment. Harness deploy/destroy never prompt; `--yes` is for the CLI ([stack guide CI section](https://alchemy.run/testing/testing-a-stack/#ci)).

## Isolation and parallelism

Alchemy state is scoped by Stack name and stage; stages also produce distinct physical names ([State store](https://alchemy.run/state-store/), [Stages](https://alchemy.run/environments/stages)). Apply these rules:

1. Never run tests against `local`, `production`, or any developer deployment stage.
2. Set `ALCHEMY_TEST_STAGE=pr-<number>` in PR CI and prevent overlapping runs for the same PR with a workflow concurrency group. Different PR stages may run in parallel.
3. Keep tests within the E2E file sequential and disable E2E file parallelism. Parallelize pure/unit files freely.
4. Generate unique domain IDs/data per test; a stage prevents infrastructure collisions, not data collisions among tests sharing that Stack.
5. Use `Cloudflare.state()` in CI. It is the recommended shared remote store, but bootstrap it once before CI. In CI it resolves state-store credentials through Cloudflare Secrets Store and requires the documented permissions, including Secrets Store Write ([Cloudflare state store](https://alchemy.run/state-store/#cloudflare-state-store)).
6. A stable per-PR stage enables fast no-op diffs on reruns. A unique per-run stage gives stronger isolation but increases provisioning and needs robust stale-stage cleanup. Choose explicitly.

## Commands and minimal configuration

The current `apps/api` `test` script is `vp test run`, so it would discover future E2E files too ([package](../../apps/api/package.json)). Keep cloud tests out of the normal `check` path by narrowing that script and adding explicit E2E scripts:

```json
{
  "scripts": {
    "test": "vp test run src",
    "test:e2e:local": "ALCHEMY_DEV=1 vp test run test/e2e/overseer-api.local.test.ts --no-file-parallelism",
    "test:e2e:cloud": "vp test run test/e2e/overseer-api.cloud.test.ts --no-file-parallelism"
  }
}
```

Recommended invocations from `apps/api`:

```sh
vp test run src                                      # unit + integration
ALCHEMY_DEV=1 vp test run test/e2e/overseer-api.local.test.ts --no-file-parallelism
ALCHEMY_TEST_STAGE=pr-42 CI=true vp test run test/e2e/overseer-api.cloud.test.ts --no-file-parallelism
```

No Vitest config change is required initially. If the E2E suite grows, define named Vitest projects with disjoint `include` globs and run `--project unit` / `--project e2e`; Vitest project configs are the first-party mechanism for distinct test environments/configuration ([Vitest projects](https://vitest.dev/guide/projects.html), [`include`](https://vitest.dev/config/include.html)). Keep cloud timeouts on the individual Alchemy hooks/tests rather than making all unit tests tolerate multi-minute hangs.

The root currently has `run.cache: true`, which enables Vite Task caching for package scripts. Never let a real-cloud test be satisfied from that cache. Invoke the E2E commands directly with `vp test` as above (built-in commands do not participate in Vite Task caching), invoke the package script through the package manager, or define an uncached `run.tasks` entry with `cache: false`; do not route the cloud script through cached `vp run` orchestration ([current config](../../vite.config.ts), [Vite+ task caching](https://viteplus.dev/guide/cache)).

CI credentials/config must include the Cloudflare credentials and all stack configuration (`OVERSEER_HOSTNAME`, `OVERSEER_OWNER_EMAIL`, `CLOUDFLARE_ACCESS_TEAM_DOMAIN`). Use a sandbox account/profile if possible. The token needs every permission exercised by the Stack, including Worker deployment and Access application/policy/service-token management; remote state adds its own requirements. Alchemy resolves harness credentials through the same profile/auth-provider mechanism as the CLI ([harness providers/profile](https://alchemy.run/testing/test-harness/#providers), [Profiles](https://alchemy.run/environments/profiles/)).

## What not to test

Do **not** add tests whose only observation is that:

- an Effect `Context.Service` tag, constructor, Layer, or Alchemy resource can be constructed;
- generated declarations or inferred binding types compile;
- Effect runs generators, propagates tagged errors, scopes resources, retries, or supplies `TestClock` as documented;
- Alchemy deploy/destroy, stage naming, outputs, or provider wiring work in isolation;
- a straightforward Schema brand/Struct/Union accepts and rejects examples already stated by its declaration;
- schema codecs round-trip without an application-owned transformation or compatibility contract;
- every tagged-error message getter returns the literal visible in its source;
- each endpoint returns a declared shape without exercising meaningful behavior.

Test application-owned outcomes instead: protocol status/body at a boundary, persisted state after a workflow, authorization decisions, domain transitions, idempotency, ownership constraints, and regressions. This matches the repository's explicit schema-testing rule ([coding standards](../coding-standards.md)).

## Open decisions

1. **Protected URL:** the current Stack creates an Access application for `OVERSEER_HOSTNAME` but returns `api.url`; the Worker declaration shown does not visibly attach that hostname/route. Confirm that the returned E2E URL is the Access-protected hostname, or add the routing resource and return that URL. Otherwise service-token headers will bypass Access or target an unrouted host.
2. **Cloud cadence:** recommended baseline is one critical real-cloud journey on every PR, broader journeys nightly/on main, and local workerd plus integration tests on every normal `check`. Decide whether cost/quota permits that.
3. **Stage identity:** choose stable per-PR stages with serialized reruns, or unique per-run stages with a janitor. Do not use the harness default shared `test` stage in a multi-developer/account-wide CI environment.
4. **Teardown policy:** decide whether local cloud E2E normally destroys (recommended) or intentionally retains a stage for iteration. If retained, define ownership and a cleanup command/TTL.
5. **Test data cleanup:** before CRUD endpoints land, decide whether each test deletes its entities, the suite resets state through a test-only administrative boundary, or stage destruction is the sole cleanup. Do not expose persistence internals merely to make tests convenient.
6. **Access denial contract:** decide whether the observable unauthenticated result should be Cloudflare's redirect/denial or the Worker's `401`; test the chosen public boundary rather than both accidentally.

## Primary sources

- Alchemy official: [Testing](https://alchemy.run/testing/), [Testing a Stack](https://alchemy.run/testing/testing-a-stack/), [Test harness](https://alchemy.run/testing/test-harness/), [Testing Providers](https://alchemy.run/testing/testing-providers), [Local development](https://alchemy.run/environments/local-development), [State store](https://alchemy.run/state-store/), [CI](https://alchemy.run/environments/ci).
- Alchemy pinned implementation: [`Test/Vitest.ts`](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts), [`Test/Core.ts`](../../repos/alchemy/packages/alchemy/src/Test/Core.ts), [`Test/Http.ts`](../../repos/alchemy/packages/alchemy/src/Test/Http.ts), [`ProviderMode.ts`](../../repos/alchemy/packages/alchemy/src/ProviderMode.ts).
- Effect pinned implementation/examples: [`@effect/vitest` API](../../repos/effect/packages/vitest/src/index.ts), [runtime/layer implementation](../../repos/effect/packages/vitest/src/internal/internal.ts), [Effect test examples](../../repos/effect/ai-docs/src/09_testing/10_effect-tests.ts), [Layer test examples](../../repos/effect/ai-docs/src/09_testing/20_layer-tests.ts).
- Cloudflare official: [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
- Vitest official: [test projects](https://vitest.dev/guide/projects.html), [`fileParallelism`](https://vitest.dev/config/fileparallelism.html).
