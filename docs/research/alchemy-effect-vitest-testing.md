# How Alchemy names deployed-stack tests

_Research snapshot: Overseer's pinned Alchemy checkout is commit `a6b8a5a1904159118125963e55b8d9c943a64327`; the installed package is `alchemy@2.0.0-beta.67` ([vendored package](../../repos/alchemy/packages/alchemy/package.json), [installed package](../../node_modules/alchemy/package.json)). This report replaces the earlier broad testing proposal with a focused naming-and-structure investigation._

## Conclusion

For Overseer, call the suite **deployed-stack integration tests**, or simply **integration tests** where the context is clear. Describe their coverage as **end to end**. Do not call them “cloud tests.”

Use Alchemy's demonstrated application convention:

```text
apps/api/
  test/
    integ.test.ts
    integ/
      access.ts
      workspace.ts
      test-client.ts
      test-data.ts
```

Only `test/integ.test.ts` should be test-runner-discovered initially. It should own `Test.make`, `beforeAll(deploy(Stack))`, `afterAll(destroy(Stack))`, and registration of feature cases from ordinary `.ts` modules. Name the package command `test:integ`; if a separate local-runtime suite is useful, use `integ.local.test.ts` and `test:integ:local`. These names align with Alchemy's tutorials and checked-in applications while avoiding an invented environment label ([Cloudflare tutorial](../../repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-3.mdx), [AWS tutorial](../../repos/alchemy/website/src/content/docs/aws/tutorial/part-3.mdx), [application examples](../../repos/alchemy/examples), [local-test convention](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/Script.local.test.ts)).

## What Alchemy itself calls this testing style

Alchemy uses three compatible descriptions at different levels:

1. **The general model is just “Alchemy tests.”** The testing overview says they deploy real infrastructure, assert against live resources, and tear it down: `deploy → assert → destroy`. It does not introduce a special suite noun based on the hosting environment ([testing overview](../../repos/alchemy/website/src/content/docs/testing/index.mdx)).
2. **The coverage pattern is “end-to-end.”** The dedicated page is titled **Testing a Stack** and opens by calling this “the end-to-end pattern for integration-testing a deployed Stack.” The overview likewise says to drive the Stack “over HTTP, end to end” ([Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx), [testing overview](../../repos/alchemy/website/src/content/docs/testing/index.mdx)).
3. **The runnable suite is consistently an “integration test.”** Both first-party provider tutorials say “Write integration tests that deploy your stack,” create `test/integ.test.ts`, and execute that exact path. The Testing a Stack page runs the same file name and points readers to those tutorials as their “first integration test” ([Cloudflare tutorial](../../repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-3.mdx), [AWS tutorial](../../repos/alchemy/website/src/content/docs/aws/tutorial/part-3.mdx), [Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx)).

The idiomatic synthesis is therefore:

> **A deployed-stack integration test exercises the application end to end.**

“End-to-end test” is also accurate prose, but `integ` is the overwhelmingly stronger first-party filename convention. “Deployed-stack” is a useful qualifier when Overseer must distinguish this suite from in-process integration tests; it comes directly from Alchemy's “Testing a Stack” model rather than inventing an environment-based category ([Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx)).

### Why not “cloud tests”

Alchemy's overview explains that tests run against real providers, but **“cloud test(s)” is not the suite category or filename convention used by the testing docs, tutorials, examples, or pinned test tree**. The docs use “integration,” “end-to-end,” “Testing a Stack,” and “deployed Stack”; filenames use `integ.test.ts`, ordinary resource `.test.ts`, selected `.smoke.test.ts`, and `.local.test.ts` ([testing docs](../../repos/alchemy/website/src/content/docs/testing), [examples](../../repos/alchemy/examples), [Alchemy package tests](../../repos/alchemy/packages/alchemy/test)). Environment is an execution property, not the test type.

This distinction also prevents ambiguity. Alchemy's `dev` option can replace supported resources with local providers, while the same `Test.make`/`deploy` API and even the same integration suite structure remain usable; the harness resolves `dev` independently from stage and provider configuration ([Core implementation](../../repos/alchemy/packages/alchemy/src/Test/Core.ts), [TanStack RPC/Drizzle example](../../repos/alchemy/examples/cloudflare-tanstack-rpc-drizzle/test/integ.test.ts)).

## First-party naming and directory evidence

### Application examples: `test/integ.test.ts`

The pinned tree contains **16 first-party application examples** that use `Test.make` with top-level Stack deployment. Every one places the suite at `test/integ.test.ts`; none uses an `e2e/` directory or a `.cloud.test.ts` filename ([examples tree](../../repos/alchemy/examples)). Representative complete sources include:

- Cloudflare Worker: [`examples/cloudflare-worker/test/integ.test.ts`](../../repos/alchemy/examples/cloudflare-worker/test/integ.test.ts). It calls `Test.make`, deploys once in `beforeAll`, drives live Worker, Workflow, Queue, R2, and other behavior, then destroys in `afterAll`.
- AWS Lambda: [`examples/aws-lambda/test/integ.test.ts`](../../repos/alchemy/examples/aws-lambda/test/integ.test.ts). It uses the same lifecycle and names the test “deploys and exposes a url.”
- TanStack/RPC/Drizzle: [`examples/cloudflare-tanstack-rpc-drizzle/test/integ.test.ts`](../../repos/alchemy/examples/cloudflare-tanstack-rpc-drizzle/test/integ.test.ts). It runs the application integration tests in both `dev: true` and `dev: false` modes without renaming the live-provider variant as a separate category.
- D1/Drizzle and Effect SQL: [`examples/cloudflare-d1-drizzle/test/integ.test.ts`](../../repos/alchemy/examples/cloudflare-d1-drizzle/test/integ.test.ts) and [`examples/cloudflare-effect-sql-d1/test/integ.test.ts`](../../repos/alchemy/examples/cloudflare-effect-sql-d1/test/integ.test.ts).

The examples' `package.json` files generally expose the unqualified command `test: "bun test"`, allowing the runner to discover `test/integ.test.ts`; they do not define a command based on provider location ([Cloudflare Worker package](../../repos/alchemy/examples/cloudflare-worker/package.json), [AWS Lambda package](../../repos/alchemy/examples/aws-lambda/package.json)).

### Cross-version application fixtures: the convention is explicit

Alchemy's cross-version harness contains five more standalone deployed application suites, each at `<version>/test/integ.test.ts`. Its README explicitly calls each one an **“example-style integration test,”** says it mirrors `examples/*/test/integ.test.ts`, and defines the behavior as deploy in `beforeAll`, request the live Worker, assert, destroy in `afterAll` ([cross-version README](../../repos/alchemy/test/cross-version-test/README.md), [current-version source](../../repos/alchemy/test/cross-version-test/test/05-current/test/integ.test.ts)).

This is unusually direct evidence for both the semantic label and filename.

### Multiple files: `<feature>.integ.test.ts`

Alchemy's Testing a Stack page gives the multi-file example `test/api.integ.test.ts` and `test/queue.integ.test.ts`. It says each file can use the same state and stage so a repeated deploy becomes a no-op diff ([Testing a Stack, “Share one Stack across files”](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx)).

That is a naming example, not a sufficient concurrency protocol: independently discovered files can still overlap assertions and teardown under a parallel runner. For Overseer, retaining one discovered owner file is safer until every discovered file owns an independent stage/lifecycle or a run-wide fixture coordinates teardown. Alchemy's harness creates a per-`Test.make` shared Effect scope and registers hooks per file; it does not provide a process-wide cross-file reference count ([Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts), [Core implementation](../../repos/alchemy/packages/alchemy/src/Test/Core.ts)).

### Alchemy's own package tests: behavior name, ordinary `.test.ts`

Alchemy's provider/library suite lives under `packages/alchemy/test/<Provider>/<Area>/`. Most deployed end-to-end resource tests use an ordinary behavior/resource filename, not an integration suffix: for example `Cloudflare/Workers/RpcWorker.test.ts`, `Cloudflare/D1/Drizzle.test.ts`, and `SQL/D1.test.ts`. Their comments explicitly call the behavior “end-to-end” and their code deploys a Stack, exercises the returned live URL, and destroys it ([RPC Worker test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/RpcWorker.test.ts), [Drizzle test](../../repos/alchemy/packages/alchemy/test/Cloudflare/D1/Drizzle.test.ts), [SQL D1 test](../../repos/alchemy/packages/alchemy/test/SQL/D1.test.ts)).

This package convention serves a large provider implementation matrix, not the simpler layout of a consumer application. For an Alchemy application such as Overseer, the examples and tutorials are the closer precedent.

### What `.smoke.test.ts` and `.local.test.ts` mean upstream

The pinned package tree has nine `.smoke.test.ts` files and seven `.local.test.ts` files, but no `.e2e.test.ts` or `.integration.test.ts` files ([Alchemy package test tree](../../repos/alchemy/packages/alchemy/test)).

- `.smoke.test.ts` marks selected broad/heavy provider stories, not every deployed-stack integration test. `AWS/Smoke/Serverless.smoke.test.ts` calls itself a full-stack serverless story in one Stack; `EC2/Instance.smoke.test.ts` calls itself full end-to-end and gates the expensive real-instance test under `FAST=1` ([serverless smoke source](../../repos/alchemy/packages/alchemy/test/AWS/Smoke/Serverless.smoke.test.ts), [EC2 smoke source](../../repos/alchemy/packages/alchemy/test/AWS/EC2/Instance.smoke.test.ts)). Many equally real deployed tests retain ordinary `.test.ts` names, so “smoke” is not the general Alchemy term for the deploy/assert/destroy style ([SQL D1 test](../../repos/alchemy/packages/alchemy/test/SQL/D1.test.ts)).
- `.local.test.ts` is the explicit suffix used for local-provider counterparts, such as Worker Script, D1 Database, KV Namespace, R2 Bucket, and Queue tests ([Worker local test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/Script.local.test.ts), [D1 local test](../../repos/alchemy/packages/alchemy/test/Cloudflare/D1/Database.local.test.ts), [R2 local test](../../repos/alchemy/packages/alchemy/test/Cloudflare/R2/Bucket.local.test.ts)). Some older files spell `Local` in the behavior name instead, so the suffix is a strong current convention but not perfectly universal ([package test tree](../../repos/alchemy/packages/alchemy/test/Cloudflare)).

## Harness structure confirmed from the pinned implementation

The checked-in implementation under `repos/alchemy/packages/alchemy/src/Test` and the installed copy under `node_modules/alchemy/src/Test` are byte-for-byte identical in this workspace. Both expose the same `Core`, Bun, Vitest, Alchemy-runner, HTTP, and test-state modules ([checked-in Test implementation](../../repos/alchemy/packages/alchemy/src/Test), [installed Test implementation](../../node_modules/alchemy/src/Test)).

Relevant structural behavior:

- `Test.make` is configured once per file and returns `test`, lifecycle hooks, `deploy`, and `destroy` ([Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts), [harness reference](../../repos/alchemy/website/src/content/docs/testing/test-harness.mdx)).
- `beforeAll(deploy(Stack))` deploys once and returns a lazy Effect accessor consumed by tests; `afterAll(destroy(Stack))` tears the same Stack down ([Core implementation](../../repos/alchemy/packages/alchemy/src/Test/Core.ts), [Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx)).
- The Vitest adapter maps harness tests to `@effect/vitest`'s `it.live` and keeps one scope alive across deploy, assertions, and destroy so scoped local runtimes survive hook boundaries ([Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)).
- The default stage is `test`; a caller can qualify it per file or deploy/destroy call. Alchemy documents unique per-PR/run stages for isolation ([Core implementation](../../repos/alchemy/packages/alchemy/src/Test/Core.ts), [testing overview](../../repos/alchemy/website/src/content/docs/testing/index.mdx), [Stages](../../repos/alchemy/website/src/content/docs/environments/stages.mdx)).
- `test.provider` is a different category: provider lifecycle testing against a private scratch state store. Alchemy's own comparison table labels that use case “provider unit tests,” while top-level `test + deploy(Stack)` is “end-to-end against a real stack” ([Testing Providers](../../repos/alchemy/website/src/content/docs/testing/testing-providers.mdx), [scratch-stack implementation](../../repos/alchemy/packages/alchemy/src/Test/Core.ts)).

These APIs define lifecycle, not a required folder convention. The naming convention comes from the docs and application examples.

## Parallelism and the fastest safe application layout

### 1. What Alchemy explicitly recommends

Alchemy's published guidance is narrow and consistent:

- deploy a Stack **once per suite/file** in `beforeAll`, share its output accessor among the file's tests, and destroy it in `afterAll` ([testing overview](../../repos/alchemy/website/src/content/docs/testing/index.mdx), [Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx));
- isolate concurrent suites/runs with unique stages—explicitly, a unique stage per PR or test run lets suites run in parallel against one provider account without colliding ([testing overview](../../repos/alchemy/website/src/content/docs/testing/index.mdx), [harness `stage` option](../../repos/alchemy/website/src/content/docs/testing/test-harness.mdx), [Stages](../../repos/alchemy/website/src/content/docs/environments/stages.mdx));
- use persistent state so unchanged re-deploys diff to no-ops and optionally keep a deployed Stack locally for near-instant reruns ([Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx), [State Store](../../repos/alchemy/website/src/content/docs/state-store/index.mdx)); and
- in CI, isolate PRs by stage and serialize deploy activity for the same Git reference with the workflow concurrency group shown in the CI guide ([CI guide](../../repos/alchemy/website/src/content/docs/environments/ci.mdx)).

Alchemy does **not** explicitly prescribe `describe.concurrent`, per-test stages, `--no-file-parallelism`, a Vitest worker count, or a number of application Stacks to deploy in parallel. Recommendations below on those choices are Overseer-specific inferences.

### 2. What Alchemy merely permits

The Testing a Stack page permits multiple files to point `Test.make` at the **same remote state and same stage**; it says the later file's identical `deploy(Stack)` is a no-op diff ([Testing a Stack, “Share one Stack across files”](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx)). It does not say that those files may concurrently own `afterAll(destroy(Stack))`, nor does it specify a cross-file barrier or owner election. The state-store guidance says concurrent writes occur while one deployment applies independent resources and therefore must be consistent per `(stack, stage, fqn)`; that is not a documented lock around two simultaneous deploy/destroy operations for one Stack ([custom state-store guidance](../../repos/alchemy/website/src/content/docs/state-store/custom-state-store.mdx)).

**Inference:** same-state/same-stage multi-file sharing is safe when file lifetimes are externally coordinated or sequential and destruction has one owner. It is not evidence that independently parallel files may each deploy and destroy the same Stack safely. A no-op deploy does not prevent file A's `afterAll` from destroying resources while file B is still asserting.

Alchemy's own package tests also show that multiple `Test.make` calls are allowed. A particularly relevant first-party test creates separate harnesses under concurrent suites for local and deployed modes, assigns distinct `test-local` and `test-live` stages, and gives each nested Stack its own deploy/assert/destroy lifecycle ([Container test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Container/Container.test.ts)). This is implementation evidence that isolated harnesses can fan out; it is not published consumer best-practice guidance.

### 3. `Test.make` scopes lifecycle per call and ambient suite

Every call to the pinned Vitest or Bun `Test.make` allocates its own `sharedScope`, wraps that call's hooks/tests with the same scope, closes it after `destroy`, and registers a fallback `afterAll` to close it if normal destruction is skipped ([Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts), [Bun adapter](../../repos/alchemy/packages/alchemy/src/Test/Bun.ts)). `Core.toEffect` provides each invocation's configured state, providers, profile, stage, and dev mode while attaching scoped resources to that shared scope ([Core implementation](../../repos/alchemy/packages/alchemy/src/Test/Core.ts)).

“Per file” is the documented usage convention, not a global singleton enforced by `Test.make`: hooks are registered into the runner suite that is ambient when `Test.make` and its returned helpers are called. Multiple calls in one file therefore create multiple independent scopes and hook sets, as Alchemy's Container test demonstrates ([Container test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Container/Container.test.ts)). `Scope.makeUnsafe("sequential")` selects finalizer execution strategy; the adapter contains no semaphore that serializes test bodies ([Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)).

The current first-party `main` docs retain the pinned “one deploy per suite,” unique-stage, and same-state/same-stage sharing text, and current `Test/Vitest.ts` retains one scope per `make` call; its material change is extra file-scoped local-sidecar handling, not a new cross-file Stack coordinator ([current Testing a Stack](https://github.com/alchemy-run/alchemy/blob/main/website/src/content/docs/testing/testing-a-stack.mdx), [current testing overview](https://github.com/alchemy-run/alchemy/blob/main/website/src/content/docs/testing/index.mdx), [current Vitest adapter](https://github.com/alchemy-run/alchemy/blob/main/packages/alchemy/src/Test/Vitest.ts)).

### 4. Which concurrency is safe

**Within one Vitest file:** Vitest runs tests sequentially by default. `describe.concurrent` can opt independent tests into bounded same-worker concurrency; `beforeAll` still completes once before the group and `afterAll` runs once afterward ([Vitest parallelism](https://vitest.dev/guide/parallelism.html), [`describe.concurrent`](https://vitest.dev/api/describe.html#describe-concurrent)). Because Alchemy registers each harness test as `it.live`, a harness `test(...)` called inside an ambient `describe.concurrent` participates in that suite even though the returned `test` API has no `.concurrent` method ([Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)). This is safe only when test bodies use unique application data and do not reset, destroy, or mutate shared fixtures in incompatible ways. Journeys that intentionally share one Workspace or assert mutation ordering should remain one test body or a sequential group. This safety rule is an inference from the shared deployed application state, not an Alchemy guarantee.

**Across Vitest files:** Vitest runs files in parallel workers by default; `fileParallelism: false`/`--no-file-parallelism` reduces that to one worker and does not affect concurrency within a file ([Vitest file parallelism](https://vitest.dev/config/fileparallelism), [Vitest parallelism](https://vitest.dev/guide/parallelism.html)). Parallel files are safe when each owns an isolated Stack stage (or when an external run-wide fixture owns the sole shared Stack lifecycle). They are unsafe when each independently destroys the same Stack while another may still use it. Separate Vitest workers isolate JavaScript state, not an external Stack selected by the same stage.

**Bun and Alchemy's internal runner:** the Bun adapter delegates scheduling to `bun:test`; the Vitest adapter delegates to Vitest, so the harness itself does not make the two runners' schedules identical ([Bun adapter](../../repos/alchemy/packages/alchemy/src/Test/Bun.ts), [Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)). Alchemy's newer internal `alchemy-test` runner is separate: it imports files in parallel, runs up to 32 files concurrently by default, and runs tests within each file sequentially unless `describe.concurrent` opts out ([runner](../../repos/alchemy/packages/alchemy-test/src/Runner.ts), [CLI](../../repos/alchemy/packages/alchemy-test/src/cli.ts), [runner guidance](../../repos/alchemy/AGENTS.md)). Those internal defaults demonstrate bounded fan-out and explicit serialization for shared fixtures, but they do not override Overseer's Vitest behavior.

### 5. When multiple isolated Stacks/stages are the speed strategy

**Sourced facts:** stages isolate state and physical resources, and destroying one stage does not touch another; state itself is keyed by Stack name and stage ([Stages](../../repos/alchemy/website/src/content/docs/environments/stages.mdx), [State Store](../../repos/alchemy/website/src/content/docs/state-store/index.mdx)). Alchemy's internal suite fans independent files out with bounded concurrency and serializes tests that touch singleton/global resources or one shared fixture ([Alchemy runner guidance](../../repos/alchemy/AGENTS.md), [R2 custom-domain test](../../repos/alchemy/packages/alchemy/test/Cloudflare/R2/CustomDomain.test.ts), [SSM shared-fixture test](../../repos/alchemy/packages/alchemy/test/AWS/SSM/Bindings.test.ts)).

**Overseer inference:** add multiple deployed `OverseerApi` stages only after one-Stack in-file request concurrency is measured and assertion time—not deployment—is the bottleneck, or when cases require mutually incompatible Stack configuration/data. Partition cases into a small bounded number of shards, derive a unique stage per run and shard, and let each shard exclusively deploy and destroy its own Stack. This removes lifecycle and data collisions and allows deploys/assertions to overlap. It can be slower when provisioning dominates and can hit provider quotas, so benchmark two shards before increasing the bound. Do not create a Stack per ordinary test case by default.

### 6. Is `--no-file-parallelism` warranted for Overseer?

**Now: no.** Overseer currently discovers exactly one deployed-stack file, `apps/api/test/e2e.test.ts`; its command nevertheless passes `--no-file-parallelism` ([current test](../../apps/api/test/e2e.test.ts), [API package](../../apps/api/package.json)). Vitest states that this flag only controls multiple files, so with one selected file it provides no isolation and no speed/safety effect ([Vitest `fileParallelism`](https://vitest.dev/config/fileparallelism)). It is harmless but misleading and should be removed from `test:e2e`.

**Later:** keep the flag off when there is still one lifecycle-owner file, or when multiple files each own unique stages; use bounded `maxWorkers` if many isolated Stack files would otherwise overwhelm provider quotas ([Vitest parallelism](https://vitest.dev/guide/parallelism.html)). The flag is warranted only as a defensive stopgap if independently discovered files share one Stack/stage without a run-wide lifecycle coordinator. That stopgap sacrifices file parallelism and, if every file destroys, can also force repeated deployments; a single owner file or isolated shard stages is preferable.

### 7. Fastest-safe recommendation for Overseer

Start with one deployed Stack and overlap only independent HTTP-heavy cases:

```text
apps/api/test/
  e2e.test.ts          # sole Test.make + deploy/destroy owner
  e2e/
    access.ts          # registration function
    workspace.ts       # registration function
    test-client.ts
    test-data.ts
```

In `e2e.test.ts`, deploy once to a unique run stage, complete one readiness probe, and invoke registration functions inside a bounded `describe.concurrent` block. Every concurrent case must generate its own Workspace/data; keep lifecycle journeys and deliberate same-Workspace concurrency inside one test body. Run only that file, without `--no-file-parallelism`, and retain Vitest's default in-file concurrency cap of 5 initially; tune from measurements rather than enabling project-wide concurrency ([Vitest parallelism](https://vitest.dev/guide/parallelism.html), [Vitest `maxConcurrency`](https://vitest.dev/config/maxconcurrency), [Alchemy one-deploy pattern](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx)).

Recommended target command (the runner wrapper still needs to generate `ALCHEMY_TEST_STAGE` and guarantee fallback cleanup):

```sh
vp test run test/e2e.test.ts
```

If one Stack later becomes the measured bottleneck, split into a small number of `*.e2e.test.ts` shard files, assign each `ALCHEMY_TEST_STAGE-<shard>` and full lifecycle ownership, and run them with bounded file workers. Do not parallelize files against one lifecycle-owned stage merely because Alchemy permits same-state no-op deploys.

## Public-repository search

I searched public indexed source for the exact imports `alchemy/Test/Vitest` and `alchemy/Test/Bun`, then narrowed for `Test.make`, `Cloudflare.providers()`, `beforeAll(deploy(Stack))`, and `afterAll(destroy(Stack))`. The search found:

- the first-party `alchemy-run/alchemy` repository;
- the first-party predecessor/mirror `alchemy-run/alchemy-effect`;
- `pingdotgg/t3code`, but only inside its checked-in `.repos/alchemy-effect/...` research/vendor snapshot, not application source using the harness. Inspection of the [actual matched file](https://github.com/pingdotgg/t3code/blob/1a003e383ac6b10258b8100c2617d938c4f06c69/.repos/alchemy-effect/website/src/content/docs/testing/test-harness.mdx) confirms that it is Alchemy's test-harness documentation under the snapshot directory.

No genuine external repository using Alchemy's deploy/assert/destroy harness style was located. Therefore this report does **not** present a copied vendor snapshot as independent adoption evidence. The public search can be reproduced with [Sourcegraph: Vitest import](https://sourcegraph.com/search?q=context%3Aglobal+%22alchemy%2FTest%2FVitest%22&patternType=standard), [Sourcegraph: Bun import](https://sourcegraph.com/search?q=context%3Aglobal+%22alchemy%2FTest%2FBun%22&patternType=standard), and [Sourcegraph: external Bun import excluding first-party/vendor paths](https://sourcegraph.com/search?q=context%3Aglobal+%22alchemy%2FTest%2FBun%22+-repo%3A%5Egithub.com%2Falchemy-run%2F+-file%3A%5E.repos%2F&patternType=standard).

This is a search result, not proof that no private, unindexed, newly created, archived, or fork-only example exists. The recommendation consequently rests on Alchemy's extensive first-party docs and source, not unsupported claims of ecosystem consensus.

## Recommendation for Overseer

### Terminology

Use these phrases consistently:

| Context                    | Recommended wording                                                             |
| -------------------------- | ------------------------------------------------------------------------------- |
| Suite/category             | **deployed-stack integration tests**                                            |
| Short form                 | **integration tests**                                                           |
| Coverage statement         | **exercises Overseer end to end through its deployed public API**               |
| Lifecycle                  | **deploy → assert → destroy**                                                   |
| Local-provider counterpart | **local integration test** or **local-runtime integration test**                |
| Narrow in-process tier     | **service integration test** / **HTTP integration test**, qualified by boundary |

Avoid environment-as-category phrasing. In particular, replace existing `cloud tests`, `cloud suite`, and `test:e2e:cloud` wording in future documentation changes with `deployed-stack integration tests`, `integration suite`, and `test:e2e`. Alchemy itself identifies the boundary by deployed Stack and integration behavior, while reserving `local` as an explicit provider-mode qualifier ([Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx), [Core `dev` option](../../repos/alchemy/packages/alchemy/src/Test/Core.ts), [local test examples](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/Script.local.test.ts)).

### Initial files

Overseer deliberately uses `e2e.test.ts` rather than Alchemy's `integ.test.ts` filename while retaining Alchemy's one-file lifecycle pattern:

```text
apps/api/test/
  e2e.test.ts          # discovered; owns Test.make/deploy/destroy
  e2e/
    access.ts          # exports a registration function; not discovered
    workspace.ts       # exports a registration function; not discovered
    test-client.ts
    test-data.ts
```

Keeping helper modules free of `.test.ts` prevents Vitest from treating them as independent lifecycle owners. Feature names should describe behavior, not provider location ([Cloudflare tutorial](../../repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-3.mdx), [examples tree](../../repos/alchemy/examples), [Vitest adapter's per-file factory](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)).

If the suite later needs independently runnable files, use:

```text
apps/api/test/
  access.e2e.test.ts
  workspace.e2e.test.ts
```

Each discovered file should then own a distinct stage/Stack lifecycle, or share a deliberately coordinated run-wide fixture; merely reusing state and stage does not prevent parallel teardown races ([Testing a Stack multi-file example](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx), [Vitest adapter](../../repos/alchemy/packages/alchemy/src/Test/Vitest.ts)).

For a separate local-provider suite, prefer:

```text
apps/api/test/e2e.local.test.ts
```

Do not use the local suite as evidence for deployed Cloudflare Access, DNS, custom-domain, certificate, or provider-permission behavior; `dev` changes provider execution mode in the harness ([Core implementation](../../repos/alchemy/packages/alchemy/src/Test/Core.ts)).

### Commands

```json
{
  "scripts": {
    "test": "... focused tests ... && ... deployed integration suite ...",
    "test:e2e": "... test/e2e.test.ts ...",
    "test:unit": "... unit tests only ...",
    "test:e2e:local": "... test/e2e.local.test.ts ..."
  }
}
```

The exact runner wrapper can still generate a unique stage and guarantee fallback cleanup; that operational detail does not need to appear in the suite's noun or filename. Alchemy's application packages generally expose plain `test`, while Overseer uses `test:e2e` to distinguish this suite from narrower tests ([example package scripts](../../repos/alchemy/examples/cloudflare-worker/package.json), [stage isolation](../../repos/alchemy/website/src/content/docs/testing/index.mdx)).

## Decision

Call the category **deployed-stack integration tests** and use “end to end” to describe what the suite proves. Alchemy's exact first-party filename convention is `integ.test.ts`; Overseer deliberately chooses **`apps/api/test/e2e.test.ts`** and **`test:e2e`** while preserving Alchemy's one-file deploy/assert/destroy structure.
