# Alchemy v2 local runtime testing

Date: 2026-07-27

## Decision

Overseer should not keep its hand-built Miniflare Gateway and Durable Object as the main integration fixture. It recreates the production composition root and models expected RPC failures as rejected Promises, while Alchemy's real bridge returns typed failures in an envelope and reserves native rejection for defects. It can pass while the production Alchemy bundle is broken.

Use this order instead:

1. Run fast local integration through Alchemy's own test harness with `Test.make({ dev: true })`. This selects Alchemy's local workerd provider and uses its Worker bundler and generated bridges.
2. Keep a small live-Stack HTTP smoke test for deployment parity, matching Alchemy's documented default.
3. Retain a narrow, version-pinned production-bundle fixture only for controls Alchemy does not expose: isolated persistence roots, direct SQLite fault injection, reconstruction, and controlled outbound JWKS responses.

## Primary-source findings

### Alchemy has an official local test mode

`Test.make` accepts `dev: true`; the option runs providers in local-dev mode, matching `alchemy dev` ([Test/Core.ts](../../repos/alchemy/packages/alchemy/src/Test/Core.ts#L36-L67)). Its test adapter deliberately holds one scope across hooks and tests so the workerd sidecar remains alive, then closes it after destroy ([Test/Alchemy.ts](../../repos/alchemy/packages/alchemy/src/Test/Alchemy.ts#L125-L134), [cleanup](../../repos/alchemy/packages/alchemy/src/Test/Alchemy.ts#L253-L286)). Alchemy itself uses this shape in `RandomEnvLocal.test.ts` and `PythonWorkerLocal.test.ts` ([RandomEnvLocal.test.ts](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/RandomEnvLocal.test.ts#L1-L14), [PythonWorkerLocal.test.ts](../../repos/alchemy/packages/alchemy/test/Cloudflare/Workers/PythonWorkerLocal.test.ts#L1-L38)).

This mode runs Workers locally in workerd. It is not general Miniflare-style cloud emulation; ordinary infrastructure may still use real providers ([local development](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx#L24-L38), [why not emulate](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx#L61-L68)).

### Alchemy's documented default is a real deployed Stack

The testing overview says tests use real clouds, not mocks or emulators, with one deploy per suite and teardown afterward ([testing overview](../../repos/alchemy/website/src/content/docs/testing/index.mdx#L1-L19)). Repository guidance for Effect-native runtimes says to define a fixture with the real bindings, deploy it once, and drive its behavior over HTTP ([AGENTS.md](../../repos/alchemy/AGENTS.md#L720-L820)). The end-to-end guide follows the same pattern ([Testing a Stack](../../repos/alchemy/website/src/content/docs/testing/testing-a-stack.mdx#L6-L40)).

### The local provider uses Alchemy's real runtime shape

Alchemy's live and local Worker providers both use `WorkerBundle`; the local provider watches the bundle and runs it in workerd. `WorkerBundle` generates the Worker and Durable Object bridges. This exercises Alchemy-owned bundling, bridge generation, namespace wiring, workerd, and SQLite rather than a second application implementation ([WorkerProvider.ts](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerProvider.ts#L428-L441), [LocalWorkerProvider.ts](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts#L455-L499), [WorkerBundle.ts](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerBundle.ts#L42-L92)).

### The manual Promise adapter is not equivalent to Alchemy RPC

Schemaless RPC is Alchemy's recommended Durable Object path ([Durable Objects guide](../../repos/alchemy/website/src/content/docs/cloudflare/compute/durable-objects.mdx#L361-L387)). Expected Effect failures become tagged envelopes; defects reject the native call. The bridge implements that split, and `makeRpcStub` separately handles native rejection as `RpcCallError` ([WorkerBridge.ts](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerBridge.ts#L461-L494), [Rpc.ts](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Rpc.ts#L35-L64)). A fixture that manually turns every expected error into a rejected Promise does not test production behavior.

## Gaps

- Alchemy exposes no supported Miniflare fixture API. Its documented local runtime is the workerd sidecar. `WorkerBundle` is internal and is not re-exported from the public Workers barrel ([Workers/index.ts](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/index.ts#L1-L37)).
- The local harness does not expose direct namespace reset, raw SQL mutation, eviction, or reconstruction controls. Overseer's corruption, migration-repair, and reconstruction tests still need a lower-level compatibility fixture.
- `RpcCallError` exists at runtime but is omitted from the inferred schemaless stub error channel. Overseer's narrow production-side widening remains justified; tests should not duplicate the transport translation ([DurableObject.ts](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/DurableObject.ts#L1311-L1322)).
- Runner support is inconsistent in this snapshot. The website mentions a Vitest adapter, but the installed beta.64 package exports only `alchemy/Test/Bun` and `alchemy/Test/Http`. Use the supported Bun/Alchemy runner rather than building a Vite Plus adapter from internals.

## Recommendation for Overseer

1. Add a small Alchemy/Bun local suite using `Test.make({ providers: Cloudflare.providers(), dev: true })`.
2. Exercise the real Effect-native Gateway and Workspace Registry through HTTP. Vary only the Access/JWKS boundary if local Access provisioning would otherwise require cloud resources.
3. Move normal RPC, transaction, and expected-failure coverage off `tests/fixtures/gateway-worker.ts` and `tests/fixtures/workspace-registry.ts`.
4. Keep one narrow production-bundle compatibility fixture for deterministic persistence corruption, migration failure/repair, reconstruction, and intercepted JWKS. Treat its internal `WorkerBundle` import as pinned compatibility debt.
5. Keep one live deployment smoke test for metadata, migrations, bindings, and edge behavior.
