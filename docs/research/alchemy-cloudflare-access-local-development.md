# Alchemy v2 and Cloudflare Access for Overseer local development

**Date:** 2026-08-03  
**Scope:** the current Overseer worktree, vendored Alchemy v2, current first-party Cloudflare documentation, and Executor commit [`837e404`](https://github.com/UsefulSoftwareCo/executor/tree/837e404acbebdf32924059d6b76f715565329307).  
**Status:** research only; no application code or `planning.md` changed.

## Recommendation

Use **two deliberately different loops**:

1. **Normal `alchemy dev`: a fixed local authentication Layer**, selected structurally by a local-only Worker entry/composition root. Do not provision Access resources in this branch. It is fast and honest: it tests Overseer's behavior after authentication, not Cloudflare Access.
2. **Verifier tests: a checked-in public JWKS plus test-only private signing key**, issuing short-lived JWTs with the real Cloudflare claim shapes. This tests signature, `kid`, issuer, audience, expiry/not-before, human/service-token discrimination, and failures, but not Access policy enforcement.
3. **One live Access smoke path:** preferably a deployed personal/CI stage on a stage-specific Worker hostname; use a named Tunnel to local workerd only when true hot reload through the Access edge is worth the extra operational state. This is the only path that proves login redirects, Service Auth, service-token exchange, Access JWT injection, and hostname policy matching.

The strongest safety property is: **the production Worker bundle has no fixed-principal implementation and no runtime setting that can turn authentication off**. A separate local entry may import the same application and provide a local Layer; the deployed entry can provide only the Access JWT verifier. This is safer than Executor's convenient `ENABLE_DEV_AUTH=true` runtime escape hatch.

## What Alchemy does locally—and what it does not

### What it emulates

`alchemy dev` is a **plan-phase** command with `ALCHEMY_DEV=true`; `ALCHEMY_PHASE` is still `plan`, just as it is during deploy. Runtime bundles have the separate runtime phase. Therefore, branch on `AlchemyContext.dev` or `ALCHEMY_DEV`, not `ALCHEMY_PHASE`, to choose local development composition ([Alchemy phase source](../../repos/alchemy/packages/alchemy/src/Phase.ts#L20-L56), [phases guide](../../repos/alchemy/website/src/content/docs/infrastructure-as-effects/phases.mdx#L47-L98)).

Alchemy's `Cloudflare.Worker` has a dual provider: live deploy uses `LiveWorkerProvider`, while dev uses `LocalWorkerProvider` backed by local runtime services/workerd ([`WorkerProvider`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/WorkerProvider.ts#L982-L991)). Worker `dev` options configure local host/port and local `request.cf`; under dev, `worker.url`/`urls` are localhost/LAN URLs rather than cloud URLs ([`WorkerProps.dev`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts#L799-L859), [Worker URL outputs](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts#L947-L956)). KV, R2, D1, and Queues also have local simulators; resources without local providers execute against the live cloud in the current stage ([local-development guide](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx#L8-L43)).

### What it cannot emulate

Alchemy's Access `Application`, `Policy`, and `ServiceToken` providers are ordinary live providers, not `ProviderLayer.dual` local providers ([Application provider](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts#L305-L359), [Policy provider](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Policy.ts#L171-L247), [ServiceToken provider](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts#L128-L349)). Consequently, if Overseer yields them during `alchemy dev`, Alchemy calls Cloudflare and creates/updates real account-scoped Access resources in the personal stage. It does **not** simulate:

- Access policy evaluation or IdP login;
- browser redirects or the `CF_Authorization` session;
- Service Auth's exchange of client ID/secret for an application token;
- Access's edge injection of `Cf-Access-Jwt-Assertion`;
- the account's rotating signing service/JWKS; or
- hostname routing through Cloudflare's edge.

workerd can faithfully run the Worker code that consumes a header, but it is not the Access edge.

### Alchemy's outbound Access helper is not an emulator

Alchemy has an internal `AccessLive` helper that probes an outbound hostname for a `302` to `cloudflareaccess.com`. For a protected hostname it either returns `CF-Access-Client-Id`/`CF-Access-Client-Secret` from `CLOUDFLARE_ACCESS_CLIENT_ID` and `..._SECRET`, or invokes `cloudflared access login` and returns a `CF_Authorization` cookie ([`Cloudflare/Access.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access.ts#L28-L112)). It is wired into Alchemy's own protected state-store and edge-session HTTP calls ([state store use](../../repos/alchemy/packages/alchemy/src/Cloudflare/StateStore/State.ts#L866-L881), [edge-session use](../../repos/alchemy/packages/alchemy/src/Cloudflare/EdgeSession.ts#L125-L150)).

It is **not exported as the `Cloudflare.Access` resource namespace**, is not an inbound verifier, and does not make local workerd behave like Access. Overseer should implement its Agent HTTP client's two service-token headers explicitly rather than depend on this internal helper. Its 1-second/302 detection also should not be treated as a general policy oracle (for example, Access can be configured to answer unauthenticated Service Auth with 401).

## Exact Alchemy resource and phase pattern

### Normal local branch

At Stack plan time:

```ts
const { dev } = yield* Alchemy.AlchemyContext;

if (dev) {
  // Select a local-only entry that provides FixedLocalPrincipalLayer.
  // Do not yield Access.Application, Access.Policy, or Access.ServiceToken.
  return yield* Cloudflare.Worker("Api", {
    main: "./src/api-worker.local.ts",
    dev: { port: 8787, strictPort: true },
  });
}
```

The local entry should provide a fixed, visibly synthetic principal such as `local-owner`, not parse caller-controlled identity headers. It should preserve all authorization logic after principal creation. Prefer separate files/import graphs so bundling the production entry cannot retain the local provider as dead-but-reachable code.

### Every non-dev deploy, including a personal dev stage

A deployed stage is not `alchemy dev`; `dev` is false even if its stage is named `dev_dana`. Create Access before the production Worker so its `aud` can become a Worker env binding:

```ts
const stack = yield* Alchemy.Stack;
const hostname = hostnameForStage(stack.stage); // exact, stable FQDN

const agentToken = yield* Cloudflare.Access.ServiceToken("AgentToken", {
  duration: "2160h",
});
const human = yield* Cloudflare.Access.Policy("Human", {
  decision: "allow",
  include: [{ email: { email: ownerEmail } }],
});
const agent = yield* Cloudflare.Access.Policy("Agent", {
  decision: "non_identity", // Cloudflare UI: Service Auth
  include: [{ serviceToken: { tokenId: agentToken.serviceTokenId } }],
});
const access = yield* Cloudflare.Access.Application("ApiAccess", {
  type: "self_hosted",
  domain: hostname,
  policies: [human.policyId, agent.policyId],
  sessionDuration: "1w",
});
const api = yield* Cloudflare.Worker("Api", {
  main: "./src/api-worker.ts",
  domain: hostname,
  workersDev: false,
  env: {
    ACCESS_AUDIENCE: access.aud,
    ACCESS_ISSUER: `https://${teamDomain}`,
  },
});
```

This is a pattern, not a claim that the current file already has this shape. The current worktree creates the Worker before Access and does not attach `OVERSEER_HOSTNAME` to the Worker; an Access application's `domain` declares what Access protects but does not itself route that hostname to the Worker. Alchemy's Worker `domain` prop creates the custom-domain attachment/DNS/certificate, while `workersDev` defaults to enabled ([Worker domain and env props](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/Worker.ts#L700-L762), [custom-domain guide](../../repos/alchemy/website/src/content/docs/cloudflare/networking/custom-domains.mdx#L64-L101)).

For a custom hostname, configure both the Worker domain and Access application to the **same exact FQDN** and disable stable/preview `workers.dev` surfaces. If using the Worker's `workers.dev` hostname instead, protect that exact hostname; Cloudflare explicitly supports Access on `workers.dev`, but recommends a route/custom domain for production ([Cloudflare workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#manage-access-to-workersdev)).

Stages isolate Alchemy state and physical resource names, but Access policy/application domains must also be unique in DNS. Derive `api.<stage>.example.com` (with a defined sanitization rule) or use each stage's distinct `workers.dev` name. Keep `prod`, personal dev, and PR applications/audiences/tokens separate; destroying one stage must not remove shared DNS/Access resources owned by another ([Alchemy stages](../../repos/alchemy/website/src/content/docs/environments/stages.mdx#L8-L71)). Alchemy deliberately treats `aud` as stable and recovers an application by domain to avoid silently creating a duplicate with a new audience ([Application source](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts#L162-L190), [cold-recovery test](../../repos/alchemy/packages/alchemy/test/Cloudflare/Access/Application.test.ts#L194-L273)).

## Three honest local-authentication options

| Option | What it proves | What it does not prove | Cost/risk | Verdict |
|---|---|---|---|---|
| **Fixed local Layer** | Application behavior after authentication; human/Agent authorization when tests inject either typed principal | JWT crypto, JWKS, Access policies, redirects, token exchange | Fastest. Catastrophic only if the bypass can enter a deployment | **Default loop**, with a separate local entry and no production toggle |
| **Local JWT/JWKS fixture** | Verifier contract: RS256 signature/`kid`, exact issuer/audience, times, claim schema, rotation/error cases | Cloudflare issuance, policy selection, cookies, service-token exchange, edge headers | More test plumbing; checked-in test private key must never be accepted by production | **Required verifier test layer**, not the default browser workflow |
| **Live Access hostname** (deployed stage or Tunnel to local workerd) | Real IdP/Service Auth, hostname matching, Access-generated assertion, real remote JWKS, redirects/cookies | A deployed stage lacks local hot reload; a Tunnel adds connector/DNS lifecycle and machine availability | Real cloud resources, credentials, possible Access seats/cost, cleanup and collisions | **Required smoke test**; deployed stage preferred, Tunnel optional |

### Local JWT/JWKS fixture details

Use a dedicated test RSA key pair and stable `kid`. The test verifier must receive a local/in-memory JWK set through dependency injection; production constructs only the remote set at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. Mint short-lived JWTs with:

- header `alg: RS256`, `typ: JWT`, fixture `kid`;
- `iss: https://local-access.invalid` and a fixture-only `aud`;
- required `iat`, `exp`, and tested `nbf` behavior;
- human: `type: "app"`, non-empty `sub`, validated `email`;
- Agent/service token: `type: "app"`, `sub: ""`, and `common_name` equal to the client ID.

Cloudflare documents those exact human and service-token payload distinctions and RS256 header ([application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)). Production should validate the assertion header, signature, `kid`, exact issuer, audience membership, time claims, algorithm/type, and mutually exclusive identity shape. Cloudflare rotates signing keys by default every six weeks and retains the previous key for seven days, so production must use the external JWKS rather than a hard-coded key ([JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)).

Do not make production switch to the fixture based on a request header, hostname, `NODE_ENV`, or a generic env var. A test-only private key in the repository is acceptable only because production has no path to its issuer/JWK set.

### Live deployed dev stage

This is the simplest high-fidelity path:

```sh
alchemy deploy --stage dev_<user>
# browser -> https://api.dev-<user>.example.com
# Agent -> same URL with CF-Access-Client-Id / CF-Access-Client-Secret
```

Cloudflare Access creates an application-scoped JWT and forwards it as `Cf-Access-Jwt-Assertion`; origins should independently validate it to reject direct-origin/routing bypasses ([self-hosted app steps](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [JWT header guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)). Service-token callers send the two credentials to Access, not an assertion they minted themselves ([service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#connect-your-service-to-access)).

### Live hostname tunneled to local workerd

When hot reload through real Access is necessary, use a **named, stable tunnel**:

1. Start local workerd at a strict port such as `127.0.0.1:8787`.
2. Provision/reuse a per-developer `Cloudflare.Tunnel.Tunnel`, its ingress configuration targeting `http://localhost:8787`, a proxied CNAME at a fixed stage hostname, and an Access application/policies for that hostname.
3. Run `cloudflared tunnel run --token <redacted connector token>` as a supervised dev process.
4. Configure the local Worker's production verifier with that live application's issuer/audience; requests still enter through the public Access hostname.

Alchemy can provision the live Tunnel/config/DNS resources, but it does not turn Access into a local provider or automatically run the connector. Its Tunnel guide describes the token, ingress, and proxied `<tunnelId>.cfargotunnel.com` CNAME ([Alchemy Tunnel guide](../../repos/alchemy/website/src/content/docs/cloudflare/networking/tunnel.mdx#L8-L70)); Cloudflare documents running a named local connector to a localhost service ([locally managed Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/)). Create Access before publishing the route: Cloudflare warns that a tunnel route without Access is public ([self-hosted application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/#2-connect-your-origin-to-cloudflare)).

Prefer a long-lived per-developer tunnel/hostname over creating one on every hot reload. It introduces a real public edge route whose safety now depends on Access and local verifier configuration, connector-token custody, cleanup, and a strict local port.

## Executor: exactly what it does

The relevant public application is Executor's `apps/host-cloudflare` (a self-hosted deployment in the operator's Cloudflare account), not its separate Bun/container `apps/host-selfhost` application.

Executor's normal Cloudflare deployment verifies `Cf-Access-Jwt-Assertion` with `jose`, a remote team JWKS, exact issuer, and application audience. Its verifier constructs no remote JWKS when `config.enableDevAuth` is true; instead every request receives one fixed admin principal ([source at commit `837e404`](https://github.com/UsefulSoftwareCo/executor/blob/837e404acbebdf32924059d6b76f715565329307/apps/host-cloudflare/src/auth/cloudflare-access.ts#L58-L94)). Local instructions set this via `.dev.vars`:

```dotenv
EXECUTOR_SECRET_KEY=dev-secret-key-0123456789abcdef
ENABLE_DEV_AUTH=true
```

and run `wrangler dev --local`; Executor explicitly labels this as a bypass and warns never to deploy it ([Executor README](https://github.com/UsefulSoftwareCo/executor/blob/837e404acbebdf32924059d6b76f715565329307/apps/host-cloudflare/README.md#L67-L83)). Its workerd/Miniflare E2E test also passes `ENABLE_DEV_AUTH: "true"` and makes unauthenticated API calls ([E2E setup](https://github.com/UsefulSoftwareCo/executor/blob/837e404acbebdf32924059d6b76f715565329307/apps/host-cloudflare/src/worker.e2e.node.test.ts#L88-L105)). Missing Access variables otherwise fail closed with a 503 configuration response.

Executor has one useful mitigation: committed `wrangler.jsonc` explicitly sets `ENABLE_DEV_AUTH: "false"` so `keep_vars` cannot preserve a production override ([Wrangler config](https://github.com/UsefulSoftwareCo/executor/blob/837e404acbebdf32924059d6b76f715565329307/apps/host-cloudflare/wrangler.jsonc#L59-L72)). However, the code itself accepts the toggle in any environment and treats it as sufficient to skip required Access vars ([config](https://github.com/UsefulSoftwareCo/executor/blob/837e404acbebdf32924059d6b76f715565329307/apps/host-cloudflare/src/config.ts#L97-L114)). Thus it is a **fixed-local-principal model with an operational guard, not a cryptographic local Access emulator and not a code-level proof that a bypass cannot deploy**. Overseer should copy the model's simplicity but improve its structural safety with separate entries/composition roots.

Executor's preview environments demonstrate the complementary live approach: one Worker/D1/Access application per PR; the script derives a unique `workers.dev` hostname, creates a self-hosted Access app and policy, passes its `aud`/team domain to the Worker, and deletes the Access app during teardown ([preview source](https://github.com/UsefulSoftwareCo/executor/blob/837e404acbebdf32924059d6b76f715565329307/apps/host-cloudflare/scripts/preview.ts#L1-L35), [Access creation](https://github.com/UsefulSoftwareCo/executor/blob/837e404acbebdf32924059d6b76f715565329307/apps/host-cloudflare/scripts/preview.ts#L145-L192), [deployment](https://github.com/UsefulSoftwareCo/executor/blob/837e404acbebdf32924059d6b76f715565329307/apps/host-cloudflare/scripts/preview.ts#L218-L258)). That is a deployed preview, not local development. I found no local JWT/JWKS fixture or local Tunnel-to-workerd Access workflow in this commit.

## Secrets, hostname, and bypass rules

- **Non-secrets:** Access team-domain issuer, application `aud`, application ID, and public hostname may be Worker plain-text configuration.
- **Secrets:** service-token client secret, tunnel connector token, and fixture private signing key. Keep the Access service-token pair on the Agent/client side; the protected Worker needs only issuer/audience. Cloudflare shows the client secret once, and Alchemy's resource preserves it as redacted after creation ([Cloudflare service-token docs](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [Alchemy ServiceToken](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts#L47-L118)).
- **Exact host:** Access protects the configured hostname/path, not `localhost`. An app on `api.dev.example.com` does not protect `http://localhost:8787`; the latter is intentionally the fixed-layer/fixture loop unless reached through the former via Tunnel.
- **No Access `bypass` policy:** Alchemy exposes `decision: "bypass"`, which tells Access to skip authentication. It does not create a useful local identity or JWT and is dangerous on a public hostname. Use `non_identity` only with an exact service-token selector for Agents ([Alchemy Policy decisions](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Policy.ts#L24-L97)).
- **Close alternate origins:** for custom-domain deployments, set `workersDev: false` and disable previews unless intentionally protected. Independently reject requests without a valid assertion so DNS/routing mistakes fail closed.
- **Do not return secrets casually:** the current Stack returns `agentClientSecret`. If retained, ensure Alchemy's redaction remains intact and that CI/console output is not copied into logs; preferably deliver the credential directly to a secret manager. Never bind it into the API Worker.

## Concrete decision points for Overseer

1. **Choose the local identity contract:** one owner only, or easy injection of typed Human/Agent principals for authorization tests. Recommendation: default owner plus explicit test constructors for both actor kinds.
2. **Choose hostname strategy:** stage custom domains (best production model) versus stage-specific `workers.dev` (simpler dev smoke). Whichever is chosen must be the exact Access `domain` and Worker route.
3. **Choose live parity cadence:** manual pre-merge smoke, CI per-PR Access app, or both. Recommendation: personal deployed stage for development plus one automated service-token smoke; add browser automation only when human login behavior is product-critical.
4. **Decide whether Tunnel complexity pays off:** use it only if debugging/hot reload through real Access is frequent. Otherwise deploy a dev stage.
5. **Set secret ownership and rotation:** one token per Agent/stage, finite duration, named owner, secret-manager destination, overlap/revocation procedure. Deleting the token—not merely sessions—is required to prevent new exchanges ([Cloudflare revocation](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#revoke-service-tokens)).
6. **Enforce the no-bypass invariant:** production entry cannot import the fixed Layer or fixture key; deployment rejects/does not define local-auth variables; tests inspect that graph/config. Do not rely only on a warning comment.

## Bottom line

Alchemy gives Overseer an excellent local **Worker** runtime and a clean plan-time `dev` branch, but it does not provide local Cloudflare Access. Keep that boundary explicit. Use a structurally local fixed principal for speed, a local signing fixture for verifier correctness, and a real stage (or occasionally a named Tunnel) for Access parity. Provision Access only in non-dev/live-parity branches, attach it to the exact routed Worker hostname, pass only issuer/audience into the Worker, and make it impossible—not merely discouraged—to ship the fixed-principal path.
