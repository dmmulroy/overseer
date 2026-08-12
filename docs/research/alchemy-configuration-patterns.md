# Alchemy configuration patterns and the Overseer E2E failure

_Research snapshot: Overseer pins `alchemy@2.0.0-beta.67`. The checked-in Alchemy source and installed `node_modules/alchemy` implementation are byte-for-byte identical for the relevant runtime and test-harness files. I also compared current upstream `main` at [`f6ad48d`](https://github.com/alchemy-run/alchemy/commit/f6ad48d1ed2fc64aa7fa0614595398df35efeea8) (`2.0.0-beta.70`); the configuration model described here has not materially changed._

## Direct answers

1. **Alchemy does not recommend a centralized application-config service.** Its documented default is to use `effect/Config` directly where a deploy-time value is consumed, especially in a Function's outer Init Effect. Alchemy documents `Context.Service` and `Layer` for application capabilities and infrastructure-bearing implementations, but neither the config docs nor representative examples introduce one global config service ([Secrets & Config](../../repos/alchemy/website/src/content/docs/environments/secrets.mdx), [Layers](../../repos/alchemy/website/src/content/docs/infrastructure-as-effects/layers.mdx), [Functions & Servers](../../repos/alchemy/website/src/content/docs/infrastructure-as-effects/functions-and-servers.mdx)).
2. **Alchemy distinguishes three value flows:** ambient host/deploy inputs (`Config`, stage, profile), lazy generated resource values (`Output<T>` and bindings), and values available in a deployed runtime (native/resource bindings or automatically captured Init-phase `Config`). Stack outputs are a fourth, outward-facing projection used by the CLI, tests, and other stacks; they are not the normal mechanism for configuring the same Stack's Worker ([Stages](../../repos/alchemy/website/src/content/docs/environments/stages.mdx), [Inputs & Outputs](../../repos/alchemy/website/src/content/docs/infrastructure-as-code/outputs.mdx), [Bindings](../../repos/alchemy/website/src/content/docs/infrastructure-as-effects/binding.mdx), [Stacks](../../repos/alchemy/website/src/content/docs/infrastructure-as-code/stack.mdx)).
3. **Deployed-stack tests receive required deploy config from the same `.env`/process environment provider as the CLI.** They receive generated values by yielding the `beforeAll(deploy(Stack))` output accessor. Focused tests instead commonly inject a `ConfigProvider.fromEnv`/`fromUnknown` layer ([Test harness](../../repos/alchemy/website/src/content/docs/testing/test-harness.mdx), [test Core](../../repos/alchemy/packages/alchemy/src/Test/Core.ts), [Config-provider loader](../../repos/alchemy/packages/alchemy/src/Util/ConfigProvider.ts)).
4. **Use `Config.redacted` for sensitive source values and `Config.string`/schema/number for non-sensitive values—but understand that every `Config` captured into a Worker is deployed as a secret binding.** Literal `Redacted` Worker env values become `secret_text`; literal strings become `plain_text`. `Alchemy.Secret` and `Alchemy.Variable` no longer exist ([beta.45 migration](../../repos/alchemy/website/src/content/docs/blog/2026-05-29-beta-45.md), [Cloudflare secrets & env](../../repos/alchemy/website/src/content/docs/cloudflare/security/secrets-env.mdx)).
5. **Separate `OverseerStackConfig` and `OverseerRuntimeConfig` services would preserve the right architectural boundary, but the services themselves are an Overseer abstraction, not an Alchemy idiom.** They align if Stack config contains only pre-deploy host inputs and Runtime config is constructed inside Worker Init. They diverge if they create one global bag, read `process.env` directly, hide generated Outputs as “config,” or construct runtime config only inside request handlers.
6. **The immediate E2E fix is to put `OVERSEER_OWNER_EMAIL` into the test process's environment (or its cwd `.env`) before `beforeAll(deploy(...))` runs.** The same run also needs `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, `ALCHEMY_TEST_STAGE`, and Cloudflare deployment credentials. Creating a config service, adding a default, returning the email as a Stack output, or binding it to the Worker would not supply the missing deploy input ([current Stack](../../apps/api/alchemy.run.ts), [current E2E test](../../apps/api/test/e2e.test.ts)).

## Documented guidance

### Host/deploy inputs: Config, stage, and profile

The CLI installs a `ConfigProvider` that reads an explicitly selected dotenv file when provided; otherwise it reads `.env` in the current working directory if present, with the process environment as fallback. The test harness calls the same loader. `Test.make` has `profile` and `stage` options but no arbitrary config-record option ([loader](../../repos/alchemy/packages/alchemy/src/Util/ConfigProvider.ts), [CLI deploy composition](../../repos/alchemy/packages/alchemy/src/Cli/commands/deploy.ts), [test Core](../../repos/alchemy/packages/alchemy/src/Test/Core.ts)).

This means Alchemy does **not** implicitly load `.env.test`, `.env.production`, or a file selected from the stage. A caller may choose an env file through CLI support, export values before launching the process, or install a `ConfigProvider` Layer explicitly. The docs phrase these values as coming from “the env of whoever runs the deploy” ([Secrets & Config](../../repos/alchemy/website/src/content/docs/environments/secrets.mdx)).

Stages and profiles solve different concerns:

- a **stage** selects an isolated Stack instance and exposes its name through the `Stack`/`Stage` service;
- a **profile** selects how provider APIs authenticate;
- ordinary application/deployment settings remain `Config` values supplied by `.env` or the process environment.

Profiles are credential bundles, not general application-config profiles, and stage does not itself choose config values ([Profiles](../../repos/alchemy/website/src/content/docs/environments/profiles.mdx), [Stages](../../repos/alchemy/website/src/content/docs/environments/stages.mdx), [Auth Providers](../../repos/alchemy/website/src/content/docs/environments/auth-providers.mdx)). CI follows the same model: pass credentials and required inputs in each deploy/destroy step's `env`, and derive the stage independently ([CI](../../repos/alchemy/website/src/content/docs/environments/ci.mdx)).

### Generated values: Outputs and bindings, not ambient config

A resource property such as a Worker URL, Access audience, bucket name, or token secret is an `Output<T>` until its resource has been reconciled. Outputs describe graph dependencies and can be passed directly into another resource's props. They are categorically different from Config values, which are available immediately from the deploy host ([Inputs & Outputs](../../repos/alchemy/website/src/content/docs/infrastructure-as-code/outputs.mdx)).

Bindings are the runtime form of this graph relationship. One binding declaration records permissions, resource identifiers/configuration, and a typed runtime client. On Cloudflare, async Workers declare resources and values in `env`; Effect Workers normally yield binding services in Init and provide the corresponding Layer ([Bindings](../../repos/alchemy/website/src/content/docs/infrastructure-as-effects/binding.mdx), [Workers](../../repos/alchemy/website/src/content/docs/cloudflare/compute/workers.mdx)).

A Stack's returned record is different again. It is persisted/printed after deploy, returned by the test harness, and can be referenced by another Stack. It is an external interface over selected resource outputs—not a general in-Stack configuration container ([Stacks](../../repos/alchemy/website/src/content/docs/infrastructure-as-code/stack.mdx), [References](../../repos/alchemy/website/src/content/docs/infrastructure-as-code/references.mdx), [Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx)).

### Worker runtime config: capture in Init

Alchemy's Function model is an Effectful Constructor:

- outer Effect = Init, run at plan time and again at runtime cold start;
- returned handlers = Runtime, run per event.

When a `Config` source is evaluated in Init, Alchemy's Platform interceptor records its raw source in the runtime context during plan. The Worker provider deploys that value as a binding, and the Worker bridge installs an env-backed provider at cold start. Combinators run in both phases against the same source ([Phases](../../repos/alchemy/website/src/content/docs/infrastructure-as-effects/phases.mdx), [Platform interceptor](../../repos/alchemy/packages/alchemy/src/Platform.ts), [Worker bridge](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerBridge.ts), [runtime marker reification](../../repos/alchemy/packages/alchemy/src/Runtime.ts)).

A Config read that occurs **only** inside `fetch` is not discovered at deploy time and therefore is not bound. The documented pattern is to resolve it in outer Init, close over the resulting value, and optionally re-read that same Config later from a nested runtime Effect ([Secrets & Config](../../repos/alchemy/website/src/content/docs/environments/secrets.mdx), [complete env fixture](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/fixtures/env/effect.ts)).

All Init-captured Config sources are deployed as secrets because the interception mechanism cannot infer sensitivity. Thus `Config.string("HOST")` communicates a non-sensitive type to application code, but if captured into a Worker it still lands as encrypted `secret_text`. In contrast, explicitly declared async Worker `env` values classify by resolved shape: string is plaintext, `Redacted` is secret, other data is JSON ([Cloudflare secrets & env](../../repos/alchemy/website/src/content/docs/cloudflare/security/secrets-env.mdx), [Worker env test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/WorkerEnv.test.ts)).

## First-party code and examples

### No first-party global config service

The reviewed application examples define small named Config values or read Config directly in the component that needs it. Examples include direct top-level config for a Vite site, direct database project/name config, direct Worker Init config, and static async Worker `env` config. Searches across `examples`, docs, package tests, and non-generated source found no recommended `AppConfig extends Context.Service` aggregation pattern ([AWS Vite example](../../repos/alchemy/examples/aws-vite/alchemy.run.ts), [Prisma Effect example](../../repos/alchemy/examples/prisma-compute-effect/src/Database.ts), [Cloudflare dev example](../../repos/alchemy/examples/cloudflare-dev/alchemy.run.ts), [async Worker example](../../repos/alchemy/examples/cloudflare-worker-async/alchemy.run.ts)).

Alchemy's Layers guide does recommend one `Context.Service` per application capability with swappable implementations. That supports an application choosing to wrap parsed config behind a service, but the guide's examples are behavior-bearing services that own infrastructure/bindings, not one central settings object ([Layers](../../repos/alchemy/website/src/content/docs/infrastructure-as-effects/layers.mdx)).

### How first-party tests get configuration

The deployed Config tests set `process.env` at module initialization, before `beforeAll(deploy(Stack))`, then let the harness install its ordinary provider. The tests prove deploy-to-runtime round trips for `Config.redacted`, string, number, object/default, nested, and composite forms ([Cloudflare secret test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Secret/Secret.test.ts), [Worker env test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/WorkerEnv.test.ts)).

Focused tests avoid global mutation when practical by supplying an explicit provider:

```ts
Effect.provideService(
  ConfigProvider.ConfigProvider,
  ConfigProvider.fromEnv({ env: { KEY: "value" } }),
);
```

This is used in first-party auth/provider tests, with an explicit comment that the default provider snapshots the environment ([GitHub base-URL test](../../repos/alchemy/packages/alchemy/test/GitHub/BaseUrl.test.ts)). `ConfigProvider.fromUnknown` is likewise used to configure provider tests ([Prisma provider test](../../repos/alchemy/packages/alchemy/test/Prisma/Providers.test.ts)).

Deployed application tests obtain generated runtime endpoints and credentials from Stack outputs by yielding the `beforeAll` accessor. That is exactly what Overseer's E2E test does with the Worker URL and generated Access service-token outputs ([Testing](../../repos/alchemy/website/src/content/docs/testing/index.mdx), [Cloudflare tutorial, part 3](../../repos/alchemy/website/src/content/docs/cloudflare/tutorial/part-3.mdx), [Overseer E2E](../../apps/api/test/e2e.test.ts)).

### Secrets and non-secrets

The first-party patterns are:

| Need                                             | Alchemy pattern                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Sensitive deploy-host input used by one Function | `Config.redacted("KEY")`, resolved during Init                                  |
| Non-sensitive deploy-host input                  | `Config.string`/`number`/`schema`; note Init capture still deploys it as secret |
| Literal async Worker variable                    | plain string in `env` → `plain_text`                                            |
| Generated non-sensitive Worker value             | `Output<string>` in `env`/binding data → resolved `plain_text`                  |
| Literal or generated sensitive Worker value      | `Redacted`/`Output<Redacted>` in `env` → `secret_text`                          |
| Infrastructure-owned stable token                | `Alchemy.Random`; value persists in state and is redacted                       |
| Shared/independently rotated Cloudflare secret   | Cloudflare Secrets Store and a runtime read binding                             |
| Provider deployment credentials                  | profile locally; CI environment/auth method in automation                       |
| Generated secret needed by a caller/test         | redacted resource output, selectively returned as Stack output                  |

See [Cloudflare secrets & env](../../repos/alchemy/website/src/content/docs/cloudflare/security/secrets-env.mdx), [Secrets Store](../../repos/alchemy/website/src/content/docs/cloudflare/security/secrets-store.mdx), [Profiles](../../repos/alchemy/website/src/content/docs/environments/profiles.mdx), and the service-token contract, which notes that Cloudflare reveals the client secret only on create/rotation and Alchemy carries it as redacted state ([ServiceToken](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts)).

`Alchemy.Secret` is not a current option. It and `Alchemy.Variable` were removed in beta.45 in favor of Effect Config. Resource-specific names such as `GitHub.Secret`, `Cloudflare.SecretsStore.Secret`, and `AWS.SecretsManager.Secret` remain cloud resources and should not be confused with the removed helper ([beta.45 migration](../../repos/alchemy/website/src/content/docs/blog/2026-05-29-beta-45.md)).

### Access example shape

Alchemy's Access examples construct a reusable Policy, pass its generated `policyId` to Application, and use the generated application `aud` as an output. Service-token examples pass the generated `serviceTokenId` into a non-identity policy and retain the generated client secret as redacted output ([Application](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts), [ServiceToken](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts), [complete Access test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Access/Application.test.ts)). Overseer's Policy → Application and ServiceToken → Policy dependency flow matches these examples.

## Application of those patterns to Overseer

### Current separation follows the generated-env pattern

Overseer currently has all three value classes:

- **Host/deploy Config:** `OVERSEER_OWNER_EMAIL` is read by the Access resource module, while `CLOUDFLARE_ACCESS_TEAM_DOMAIN` is read by the Stack before declaring the deployed Worker ([Access resources](../../apps/api/src/overseer-api-access.ts), [Stack](../../apps/api/alchemy.run.ts)).
- **Derived/resource outputs:** the stage derives the custom hostname; Access produces `aud`; ServiceToken produces ID/secret; the Worker produces `url` ([hostname](../../apps/api/src/overseer-api-hostname.ts), [Stack](../../apps/api/alchemy.run.ts)).
- **Worker runtime Config:** the trusted composition root explicitly declares environment, team domain, and the generated Access audience in Worker `env`. The audience remains an Output until apply resolves it, so the Worker depends on the Access Application without formatting or erasing that dependency ([Stack](../../apps/api/alchemy.run.ts)).
- **Stack outputs for the external test client:** URL plus generated service-token credentials are returned; the test consumes them to authenticate through Access ([Stack](../../apps/api/alchemy.run.ts), [E2E](../../apps/api/test/e2e.test.ts)).

The Worker has one runtime implementation for planning, local development, and deployment. Its Access verifier Layer creates a cached deferred selection: planning constructs the capability without reading runtime-only Worker configuration, while the first runtime request parses the env-backed Config and initializes either the synthetic local verifier or the production remote-JWKS verifier. This follows Alchemy's binding principle that planning registers bindings while runtime operations read their resolved values; it removes the former placeholder `ConfigProvider` and planning-only middleware implementations ([Worker](../../apps/api/src/api-worker.ts), [Access verifier](../../apps/api/src/cloudflare-access-verifier.ts), [Alchemy binding layer](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/BindingLayer.ts)).

### `OverseerStackConfig` versus `OverseerRuntimeConfig`

**Aligned with Alchemy's model:**

- `OverseerStackConfig` contains only values known before planning, such as owner email and Access team domain, parsed from Effect Config once at the Stack composition root.
- `OverseerRuntimeConfig` contains only values the deployed Worker needs, such as environment, Access audience, and issuer/team domain.
- Runtime config is either captured in Worker Init or explicitly declared in Worker `env`; explicitly declared runtime-only values may be parsed through a deferred accessor after planning has registered them.
- Generated values remain typed Outputs/bindings until the composition root deliberately connects them to the Worker.
- Tests can provide either service with a Layer in focused tests while deployed tests still exercise the real Config/binding path.

**Divergent from Alchemy's demonstrated idioms:**

- one global service combines deploy credentials, stage metadata, resource Outputs, runtime settings, and application feature settings;
- it reads `process.env` directly rather than Effect Config;
- it turns generated Outputs into ordinary strings early, obscuring graph dependencies;
- it is built only in `fetch`, too late for automatic binding;
- or it is presented as something Alchemy recommends. The first-party default is direct, local `Config` reads plus capability Layers.

**Inference:** two narrow services can be a good Overseer design because they make the host/runtime trust boundary explicit, but they should be described as an application architecture layered on Alchemy—not as compliance with a prescribed Alchemy config-service pattern. A collection of exported schema-backed Config values may be simpler and closer to first-party style unless tests or multiple consumers materially benefit from service substitution.

## What fixes `OVERSEER_OWNER_EMAIL` now

`OVERSEER_OWNER_EMAIL` is required while the Stack creates the human Access policy. It is neither generated by a resource nor needed by Worker runtime code. The harness cannot recover it from Stack outputs, and `Test.make` does not invent or accept an application config record. The active provider must contain it before Stack deployment starts ([Stack](../../apps/api/alchemy.run.ts), [test Core](../../repos/alchemy/packages/alchemy/src/Test/Core.ts)).

A correct local invocation is therefore structurally:

```sh
cd apps/api
ALCHEMY_TEST_STAGE="$UNIQUE_DNS_SAFE_STAGE" \
OVERSEER_OWNER_EMAIL="$REAL_OWNER_EMAIL" \
CLOUDFLARE_ACCESS_TEAM_DOMAIN="https://$ACCESS_TEAM.cloudflareaccess.com" \
pnpm test:e2e
```

Cloudflare credentials must also resolve from the selected Alchemy profile or CI environment. Alternatively, put the two application values in `apps/api/.env` when the test process runs with that cwd; Alchemy loads `.env` automatically. For reproducible CI, inject them explicitly into the test step (an Actions variable is suitable for a non-secret owner email; use a secret only if organizational policy treats it as sensitive). Keep the same values available to fallback destroy commands where provider/state configuration needs them.

If a test-specific fixed email is acceptable to the Access policy, a test runner may export that value before launching Vitest. A focused test could install `ConfigProvider.fromUnknown`, but ambient env/`.env` is the first-party deployed-stack pattern. Mutating `process.env` late—after effects/providers have been constructed—is fragile because Config providers may snapshot it; first-party tests that mutate it do so at module initialization before deploy ([Cloudflare secret test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Secret/Secret.test.ts), [GitHub config test](../../repos/alchemy/packages/alchemy/test/GitHub/BaseUrl.test.ts)).

Do **not** fix this by:

- adding a fake/default owner to production Stack code;
- returning the owner email as a Stack output;
- binding owner email to the Worker, which does not consume it;
- moving it into an auth profile, whose job is provider authentication;
- or introducing `OverseerStackConfig` without also supplying its source value.

A config service can improve validation and organization, but the missing source must still come from the E2E process environment or dotenv provider.

## Upstream check

At current upstream `main` (`2.0.0-beta.70`), the secrets/config documentation and dotenv loader are unchanged from the pinned package ([current secrets doc](https://github.com/alchemy-run/alchemy/blob/f6ad48d1ed2fc64aa7fa0614595398df35efeea8/website/src/content/docs/environments/secrets.mdx), [current loader](https://github.com/alchemy-run/alchemy/blob/f6ad48d1ed2fc64aa7fa0614595398df35efeea8/packages/alchemy/src/Util/ConfigProvider.ts)). The material test-harness changes since beta.67 concern local-provider sidecar lifecycle, not application config injection ([current test Core](https://github.com/alchemy-run/alchemy/blob/f6ad48d1ed2fc64aa7fa0614595398df35efeea8/packages/alchemy/src/Test/Core.ts)). Current upstream therefore does not change the recommendation or the E2E fix.
