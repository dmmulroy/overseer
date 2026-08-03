# Alchemy 2.0.0-beta.67: minimal Cloudflare Worker

## Bottom line

For a first Worker, use Alchemy's **async Worker** form: a normal Cloudflare `fetch` module plus `Cloudflare.Worker(id, { main })`. Put that resource in a default-exported `Alchemy.Stack` configured with `Cloudflare.providers()` and a state layer, then run `bun alchemy deploy` or `bun alchemy dev`. This is the smallest documented form because it does not bundle the Effect runtime into the Worker; Effect is still used to declare the Stack. The three supported authoring forms are async, Effect, and class/Layer. ([`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts`, `@section Async Workers`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts); [`repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx`, “Deploy a Worker” and “Typed env for async Workers”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx))

The vendored package is exactly `2.0.0-beta.67`; its Effect peer range is `>=4.0.0-beta.100 || >=4.0.0`. Beta.67 itself is a bug-fix release (notably local D1 migrations and relative DNS matching); the current local-emulation and Worker URL/version model landed in beta.66. ([`repos/alchemy/packages/alchemy/package.json`, `version` and `peerDependencies`](../../repos/alchemy/packages/alchemy/package.json); [`repos/alchemy/package.json`, `workspaces.catalog`](../../repos/alchemy/package.json); [`repos/alchemy/CHANGELOG.md`, “v2.0.0-beta.67”](../../repos/alchemy/CHANGELOG.md); [`repos/alchemy/website/src/content/docs/blog/2026-07-30-beta-66.md`, “Local emulation in alchemy dev” and “Worker URLs redesigned”](../../repos/alchemy/website/src/content/docs/blog/2026-07-30-beta-66.md))

## Exact minimal setup

### 1. Create and install

Bun is recommended; Node.js 22+ is supported. Pin Alchemy rather than using the docs' moving `alchemy@next` tag:

```sh
mkdir hello-worker && cd hello-worker
bun init -y
bun add alchemy@2.0.0-beta.67 \
  'effect@>=4.0.0-beta.100' \
  '@effect/platform-bun@>=4.0.0-beta.100' \
  '@effect/platform-node@>=4.0.0-beta.100'
```

The first-party install guide lists all four packages. ([`repos/alchemy/website/src/content/docs/cloudflare/setup.mdx`, “Install”](../../repos/alchemy/website/src/content/docs/cloudflare/setup.mdx))

### 2. Write the runtime

```ts
// src/worker.ts
export default {
  async fetch() {
    return new Response("Hello, world!");
  },
};
```

### 3. Declare the Stack and Worker

```ts
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "HelloWorker",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* Cloudflare.Worker("Worker", {
      main: "./src/worker.ts",
    });

    return { url: worker.url };
  }),
);
```

The required APIs are:

- `Alchemy.Stack(name, { providers, state }, effect)`: both `providers` and `state` are required; the effect declares resources and its return value is printed as Stack output.
- `Cloudflare.providers()`: supplies the Cloudflare resource providers and auth provider.
- `Cloudflare.state()`: supplies the recommended Cloudflare-hosted remote state store.
- `Cloudflare.Worker(logicalId, props)`: with `main`, Alchemy bundles the entry using Rolldown. `name` is optional; omitting it gives a deterministic physical name derived from stack, stage, and logical ID. `workersDev` defaults to enabled, so a simple deployed Worker gets a URL.
- `yield*`: registers/deploys the resource; merely constructing or importing a resource declaration does not execute it.

([`repos/alchemy/website/src/content/docs/infrastructure-as-code/stack.mdx`, “Defining a Stack” and “Stack outputs”](../../repos/alchemy/website/src/content/docs/infrastructure-as-code/stack.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-1.mdx`, “Configure state,” “Fix the Providers,” and “Return Stack outputs”](../../repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-1.mdx); [`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts`, `WorkerProps` and `@section Async Workers`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts))

An even smaller deploy-only experiment may use `script` instead of `main`; `script` accepts final ESM source and bypasses bundling. A file-backed `main` is the safer documented choice for normal development and local workerd execution. ([`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts`, `WorkerProps.script`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts))

### 4. Authenticate and deploy

```sh
bun alchemy deploy
```

On first use, Alchemy discovers the Cloudflare auth provider from the Stack, prompts for browser OAuth or a scoped API token, stores the choice in the `default` profile, computes a plan, asks for approval, applies it, and prints `{ url }`. No `wrangler login` is needed. A no-change deploy skips approval. The default stage is `dev_$USER`; use an explicit stable stage for shared environments:

```sh
bun alchemy deploy --stage prod
```

Use `--yes` for unattended approval, `--dry-run` to plan only, and `--profile <name>` to select credentials. ([`repos/alchemy/website/src/content/docs/cloudflare/setup.mdx`, “Connect alchemy to Cloudflare” and “Profiles”](../../repos/alchemy/website/src/content/docs/cloudflare/setup.mdx); [`repos/alchemy/website/src/content/docs/cli/deploy.mdx`, “Flags”](../../repos/alchemy/website/src/content/docs/cli/deploy.mdx))

To authenticate explicitly or change methods:

```sh
bun alchemy login
bun alchemy login --configure
bun alchemy login --profile prod --configure
```

Profiles control **how** Alchemy authenticates; stages control **which isolated Stack instance** is changed. Profile configuration is in `~/.alchemy/profiles.json`, while secrets are stored separately under the Alchemy credentials directory. OAuth credentials refresh lazily. In CI, set `CI=true`, `CLOUDFLARE_ACCOUNT_ID`, and either `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL`; interactive auth is unavailable. ([`repos/alchemy/website/src/content/docs/cli/login.mdx`, “Flags”](../../repos/alchemy/website/src/content/docs/cli/login.mdx); [`repos/alchemy/website/src/content/docs/environments/profiles.mdx`, “How credentials get there” and “Switching profiles”](../../repos/alchemy/website/src/content/docs/environments/profiles.mdx); [`repos/alchemy/website/src/content/docs/environments/auth-providers.mdx`, “The env fallback” and “Refresh in practice”](../../repos/alchemy/website/src/content/docs/environments/auth-providers.mdx))

### 5. Run locally

```sh
bun alchemy dev
curl http://localhost:1337
```

In beta.67, Workers run in local workerd with hot reload. KV, R2, D1, and Queues have local simulators; resources without local providers still deploy to the real Cloudflare account in the current stage. Use `dev: { port: 3000 }` on the Worker to choose a port and `resource.pipe(Alchemy.remote())` to force a locally emulatable resource to run in the cloud. Switching a resource between local and remote is a replacement. ([`repos/alchemy/website/src/content/docs/environments/local-development.mdx`, “How it works,” “Local by default, live on demand,” “Running a resource live in dev,” and “Switching is a replacement”](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx); [`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts`, `WorkerProps.dev`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts))

**Documentation discrepancy:** the short CLI page and tutorial part 4 still say resources deploy to the cloud during dev, while the newer local-development guide and beta.67 providers say KV/R2/D1/Queues are local by default. Follow the latter for beta.67. ([`repos/alchemy/website/src/content/docs/cli/dev.mdx`, introduction](../../repos/alchemy/website/src/content/docs/cli/dev.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-4.mdx`, “How it works”](../../repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-4.mdx); [`repos/alchemy/website/src/content/docs/environments/local-development.mdx`, “Dev vs Deploy”](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx))

## State caveats

`Cloudflare.state()` bootstraps a shared account-level state service on first `deploy`, `plan`, or `dev`: a Worker/Durable Object, Secrets Store, bearer token, and encryption key. It is reused across stacks and stages. Bootstrap is interactive once and can be repaired with `alchemy cloudflare bootstrap`; CI resolves its credentials from Secrets Store instead of relying on a persisted local file. Use `State.localState()` only when machine-local state is acceptable; it is unsuitable for CI or teams. ([`repos/alchemy/website/src/content/docs/state-store/index.mdx`, “Cloudflare state store,” “First-run bootstrap,” and “Where credentials live”](../../repos/alchemy/website/src/content/docs/state-store/index.mdx); [`repos/alchemy/website/src/content/docs/cli/cloudflare.mdx`, “cloudflare bootstrap”](../../repos/alchemy/website/src/content/docs/cli/cloudflare.mdx))

State is keyed by Stack, stage, and resource FQN. Do not confuse `alchemy state clear` with destruction: it removes Alchemy's records but leaves cloud resources intact. Use `alchemy destroy --stage ...` to delete a Stack's resources. Clearing state may require a later ownership-aware re-import or explicit `--adopt`. ([`repos/alchemy/website/src/content/docs/cli/state.mdx`, “state clear”](../../repos/alchemy/website/src/content/docs/cli/state.mdx))

## Worker APIs and caveats that matter next

- **Effect Worker form:** pass an outer `Effect.gen` as the third `Worker` argument. The outer/init effect binds resources and is evaluated at plan time and once per runtime isolate; returned handlers run per event. Keep request I/O in handlers. workerd has no isolate teardown hook, so init-phase finalizers never run and sockets, pools, streams, or response bodies must not be retained across events. Each event gets a fresh Scope; handler finalizers run through `waitUntil`. ([`repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx`, “Deploy a Worker” and “Isolate scope vs request scope”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx); [`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts`, `@section Background Work & Scopes`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts))
- **Bindings:** Effect Workers obtain least-privilege typed clients in init (for example `Cloudflare.R2.ReadBucket`, `WriteBucket`, or `ReadWriteBucket`) and must `Effect.provide` the corresponding `...Binding` Layer. Async Workers instead declare `env` and derive its native runtime type with `Cloudflare.InferEnv<typeof Worker>`. Runtime binding errors remain typed and must be handled in Effect handlers. ([`repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx`, “Bindings” and “Typed env for async Workers”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-2.mdx`, “Provide the binding layer” and “Handle R2 errors”](../../repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-2.mdx))
- **URLs/domains:** `worker.url` is `worker.urls[0]`. A custom `domain` outranks `workers.dev`, but its Cloudflare zone must already exist. `Worker.URL` is the self-URL binding; an ordinary Worker cannot directly close over its own unresolved `worker.url`. Redirect domains execute before and never invoke the Worker. ([`repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx`, “URLs & domains” and “The Worker's own URL”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx))
- **Assets:** `assets` adds Cloudflare static assets; omitting both `main` and `script` makes an assets-only Worker. Static asset hits do not invoke Worker code. For Vite, remove `@cloudflare/vite-plugin`: Alchemy installs its own incompatible integration, only `VITE_` values enter the client bundle, and secrets must never use that prefix. ([`repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx`, “Static assets”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/frontend/vite.mdx`, “Remove @cloudflare/vite-plugin if present” and “Environment”](../../repos/alchemy/website/src/content/docs/cloudflare/frontend/vite.mdx))
- **Observability/cache:** Worker logs and invocation logs are enabled by default; traces are not. Workers Cache is disabled unless configured. Cache hits bypass the handler, and cache is version-scoped by default, so a deploy starts cold unless `crossVersionCache` is enabled. ([`repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts`, `@section Observability` and `@section Workers Cache`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts))
- **Versions:** normal deploys send 100% to the new immutable version. Gradual deployments split at most two versions; the first deploy is always 100%. Static assets and Durable Object migrations cannot ride gradual rollouts. Preview URLs require `workers.dev`; Workers implementing Durable Objects do not get preview URLs; version Workers cannot host Durable Object or Workflow classes. Script-level settings apply across versions rather than being version snapshots. ([`repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx`, “Versions & gradual deployments”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/compute/gradual-deployments.mdx`, “What a version carries”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/gradual-deployments.mdx))

## Cross-platform caveats found in the Cloudflare corpus

These are not needed for hello-world, but materially affect the next resource added:

- Schemaless RPC has no runtime validation; use schema-validated Effect RPC/HTTP API at external trust boundaries. Init code must only construct layers/bindings, never run a request-dependent server. ([`repos/alchemy/website/src/content/docs/cloudflare/apis/schemaless-rpc.mdx`, “When you need schemas”](../../repos/alchemy/website/src/content/docs/cloudflare/apis/schemaless-rpc.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/apis/effect-rpc.mdx`, “Build the Worker”](../../repos/alchemy/website/src/content/docs/cloudflare/apis/effect-rpc.mdx))
- Workflows replay; all external I/O belongs inside `task`, or it may execute repeatedly. Queues are at-least-once, not exactly-once. Cron event-source failures are caught, so handlers must log/report failures themselves. ([`repos/alchemy/website/src/content/docs/cloudflare/compute/workflows.mdx`, “Always wrap I/O in task”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workflows.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/messaging/queues.mdx`, introduction](../../repos/alchemy/website/src/content/docs/cloudflare/messaging/queues.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/messaging/cron.mdx`, “Declare a cron on the Worker”](../../repos/alchemy/website/src/content/docs/cloudflare/messaging/cron.mdx))
- KV is eventually consistent; Vectorize writes are asynchronous; D1's driver lacks interactive transactions and streaming queries; Hyperdrive can cache reads for 60 seconds by default. Design tests and read-after-write flows accordingly. ([`repos/alchemy/website/src/content/docs/cloudflare/data/kv.mdx`, “Create a namespace”](../../repos/alchemy/website/src/content/docs/cloudflare/data/kv.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/ai/vectorize.mdx`, “Insert vectors”](../../repos/alchemy/website/src/content/docs/cloudflare/ai/vectorize.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/data/d1-drizzle.mdx`, “Query from the Worker with Drizzle.D1”](../../repos/alchemy/website/src/content/docs/cloudflare/data/d1-drizzle.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/frontend/full-stack-tanstack-rpc-drizzle.mdx`, “The database”](../../repos/alchemy/website/src/content/docs/cloudflare/frontend/full-stack-tanstack-rpc-drizzle.mdx))
- `Redacted<string>` must be explicitly unwrapped with `Redacted.value`; interpolation produces the literal `"<redacted>"`. `VITE_` variables are public. ([`repos/alchemy/website/src/content/docs/cloudflare/security/secrets-env.mdx`, “Unwrap at the call site”](../../repos/alchemy/website/src/content/docs/cloudflare/security/secrets-env.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/security/secrets-store.mdx`, “Read it in a Worker”](../../repos/alchemy/website/src/content/docs/cloudflare/security/secrets-store.mdx))
- Existing zones/DNS are protected from accidental takeover; explicit adoption may be required. Zones default to retain on Stack removal. Changing the account's Workers subdomain changes every `workers.dev` Worker URL. ([`repos/alchemy/website/src/content/docs/cloudflare/networking/custom-domains.mdx`, “Create a Zone,” “Adopt an existing Zone,” and “Control the workers.dev subdomain”](../../repos/alchemy/website/src/content/docs/cloudflare/networking/custom-domains.mdx))
- Some surfaces are plan/entitlement constrained: Workers for Platforms is paid; some Turnstile options are Enterprise-only; Python Workers are async-only, need `uv` for dependencies, and support only Pyodide-compatible packages. ([`repos/alchemy/website/src/content/docs/cloudflare/compute/workers-for-platforms.mdx`, introduction](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workers-for-platforms.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/security/turnstile.mdx`, “Updates and replacement”](../../repos/alchemy/website/src/content/docs/cloudflare/security/turnstile.mdx); [`repos/alchemy/website/src/content/docs/cloudflare/compute/python-workers.mdx`, “Deploy a Python Worker” and “Dependencies with pyproject.toml”](../../repos/alchemy/website/src/content/docs/cloudflare/compute/python-workers.mdx))
- Email bindings are stubbed in local dev by default, but `dev: { remote: true }` sends real mail. ([`repos/alchemy/website/src/content/docs/cloudflare/email/send-and-receive.mdx`, “Declare a send_email binding”](../../repos/alchemy/website/src/content/docs/cloudflare/email/send-and-receive.mdx))

## Corpus reviewed

All first-party Cloudflare guide/tutorial pages under `repos/alchemy/website/src/content/docs/cloudflare/` were reviewed (65 files: `index.mdx`, `setup.mdx`, and every file under `ai/`, `apis/`, `compute/`, `data/`, `email/`, `frontend/`, `messaging/`, `networking/`, `observability/`, `security/`, and `tutorial/`).

The generated provider reference is not checked into the vendored tree: `repos/alchemy/scripts/generate-api-reference.ts`, `discoverFiles()` and `parseJSDoc()`, generates it from source JSDoc. All 531 TypeScript files under `repos/alchemy/packages/alchemy/src/Cloudflare/` were therefore read as the local reference source, including 253 `@resource` and 41 `@binding` declarations across 104 named products. The Worker reference—including every `WorkerProps` field and all `@section`/`@example` blocks—is at `repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts`. The output contract is documented at `repos/alchemy/AGENTS.md`, “Documentation Generation.” Only reference caveats that affect the basic Worker model or likely next steps are carried into this concise report.

The platform docs needed to interpret those Cloudflare pages were also reviewed: `getting-started.mdx`; CLI `login`, `state`, `deploy`, `dev`, and `cloudflare`; `environments/auth-providers.mdx`, `profiles.mdx`, `stages.mdx`, and `local-development.mdx`; `state-store/index.mdx`; and the Stack/provider/resource/output/local-provider plus functions/bindings/layers/phases concept pages. This report intentionally narrows their combined surface to the APIs and caveats relevant to creating and running one Worker.
