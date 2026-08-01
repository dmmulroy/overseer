# Authenticated local development for an Alchemy v2 Cloudflare Worker

Date: 2026-07-30

## Recommendation

Use two deliberately different paths:

1. **Default local loop:** run the real Alchemy-built Gateway in local workerd, but provide `AccessAssertionVerifier` with an explicit development-only Layer that returns one fixed, parsed development principal. Use an Agent principal for Yaak and require the normal `Overseer-Session-Id`; use a fixed Human principal for browser development and keep the normal exact-Origin check. This substitutes only the external Access capability. It does not add a public bypass route, trust a caller-selected identity header, or weaken the production verifier.
2. **Deployment-parity smoke:** keep a small stage behind a real, separately named Access application/domain. Use its service token from Yaak and exercise browser login there. A tunnel to local workerd is useful only when debugging the complete edge-to-local path; it is too cloud-dependent for the default edit loop.

Keep locally signed Access-shaped JWTs plus a local JWKS for tests that specifically exercise signature, claim, cache, key-rotation, and failure classification. Do not make that the everyday developer login. Never ship a mode that merely decodes a JWT, accepts `Cf-Access-Jwt-Assertion` without verifying it, or disables authentication.

This preserves ADR-0001's production boundary: Cloudflare Access admits public traffic, then the Gateway independently validates Access's assertion and derives an `AuthenticatedPrincipal` ([ADR-0001](../adr/0001-mvp-system-architecture.md#component-ownership-and-trust), [trust order](../adr/0001-mvp-system-architecture.md#trust-and-admission-order)). Local principal injection is a composition-root substitution for a missing external edge, not a claim that local workerd has reproduced Cloudflare Access.

## What Alchemy local development does—and does not do

Alchemy v2's local mode deploys ordinary infrastructure to real providers while running Worker code locally in workerd behind a local proxy. It intentionally does not emulate every cloud service ([Alchemy local-development guide](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx#L24-L38), [rationale](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx#L61-L68)). `Test.make({ dev: true })` selects the same local-dev provider behavior ([Alchemy `Test/Core.ts`](../../repos/alchemy/packages/alchemy/src/Test/Core.ts#L36-L67)), and the local Worker provider defaults to port 1337 and returns its local proxy URL ([`LocalWorkerProvider.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts#L455-L482), [returned URL](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts#L674-L695)). Research 57 therefore correctly recommends Alchemy's local harness plus a small live-stack smoke, with only the Access/JWKS boundary varied locally ([research 57](57-alchemy-local-runtime-testing.md#recommendation-for-overseer)).

Access is not part of workerd. Overseer's current stage graph already recognizes that: in dev it reads a local audience instead of creating the Access application and policies, while non-dev provisioning obtains the real application's `aud` ([`src/infra/gateway.ts`](../../src/infra/gateway.ts#L40-L70)). Alchemy exposes `ALCHEMY_DEV` specifically for this plan-time distinction ([`Phase.ts`](../../repos/alchemy/packages/alchemy/src/Phase.ts#L34-L56)). This is the right place to choose a local authentication implementation; it is not evidence that the runtime is behind Access.

The installed Alchemy version is `2.0.0-beta.64`, and the installed Effect version is `4.0.0-beta.101`. The vendored Effect API treats a `Context.Service` as a dependency supplied by surrounding context and `Layer.succeed` as the constructor for an already-built implementation ([Effect `Context.ts`](../../repos/effect/packages/effect/src/Context.ts#L99-L200), [`Layer.ts`](../../repos/effect/packages/effect/src/Layer.ts#L745-L783)). Overseer's existing `AccessAssertionVerifier` is already exactly that capability seam ([`access-principal.ts`](../../src/adapters/gateway/access-principal.ts#L112-L157)); its fixture already substitutes a fixed principal with `Layer.succeed` without replacing the Gateway application ([`tests/fixtures/alchemy-gateway.ts`](../../tests/fixtures/alchemy-gateway.ts#L43-L62)). That is more idiomatic here than adding a request-header convention or branching throughout HTTP handlers.

## Production Access boundary versus local JWT verification

These are different guarantees:

- **Cloudflare Access admission** evaluates the configured identity or Service Auth policy at Cloudflare's edge. For a protected site, Access checks requests for its application session and blocks requests that do not have one ([authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)). For machine callers, the client sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` to Access; Access exchanges them for an application-scoped JWT ([service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#connect-your-service-to-access)).
- **Gateway verification** authenticates the assertion received at the origin. Cloudflare explicitly says a Worker behind Access still must validate the injected `Cf-Access-Jwt-Assertion`, including signature, issuer, and audience, using the account JWKS endpoint ([Cloudflare validation guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#cloudflare-workers-example)). This protects against direct-origin access and routing mistakes; Cloudflare's self-hosted application guide makes that reason explicit ([validate the Access token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/#3-validate-the-access-token)).
- **A locally signed JWT** proves only that the application verifier accepts a token signed by a configured local key with configured local claims. No Access policy ran, no service credential was exchanged at Cloudflare, and no edge stripped or injected headers. It is valuable verifier coverage, not an emulation of Access admission.
- **A development principal adapter** proves the behavior after authentication: request-context construction, Human Origin rules, Agent session metadata, HTTP parsing, application calls, and attribution. It intentionally does not claim JWT or Access coverage.

Cloudflare's application-token examples explain the identity shapes Overseer parses: Human application tokens contain `type: "app"`, `sub`, and `email`; service-token application tokens contain `type: "app"`, an empty `sub`, and `common_name` equal to the service-token client ID ([application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/#payload)). The production parser should remain the only code that translates those Cloudflare claims into Overseer principals.

## Option evaluation

| Pattern                                                  | What it covers                                                                                              | Security and fidelity                                                                                                                                                                                                             | Yaak ergonomics                                                                                                                                                                                             | Fit for Overseer                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Real Access domain, optionally tunneled to local workerd | Actual Access policy, browser session/service-token exchange, edge assertion injection, production verifier | Highest boundary fidelity. Requires cloud DNS/Access resources and a connector; Internet-dependent. Local direct URL remains a bypass path to the origin, but the unchanged Gateway verifier rejects it without a real assertion. | Good: inherit the two Access service-token headers across a folder/workspace.                                                                                                                               | Keep as a focused edge-to-local diagnostic or use a deployed dev stage for smoke tests; not the default loop. |
| Locally signed JWT plus local JWKS                       | Real `jose` verification, `kid`, algorithm, issuer/audience/time claims, JWKS caching/failure behavior      | Good verifier fidelity but no Access admission. Adds key generation, issuer hosting, TLS/trust, minting, and rotation mechanics that are not product features.                                                                    | Fair to poor: Yaak's JWT auth signs fresh tokens but always sends them as `Authorization: Bearer`; Overseer expects `Cf-Access-Jwt-Assertion`, so a custom template/plugin or external mint step is needed. | Keep for narrow integration tests and fault injection, matching research 57's compatibility fixture.          |
| Explicit dev-only verifier/principal Layer               | Everything after the external authentication capability                                                     | Honest about the omitted boundary. Safe if selected only by trusted dev composition, fixed to known principals, and bound locally. Does not test JWT parsing.                                                                     | Best: no synthetic JWT lifecycle. Yaak acts as a fixed Agent and sends only ordinary API headers such as session metadata.                                                                                  | **Default recommendation.** It uses the existing Effect service seam and least code.                          |
| Disable verification / trust a header or decoded claims  | Almost nothing about authentication; only downstream routing                                                | Creates an identity-spoofing path and risks production leakage. A signed-looking but unchecked token is worse than explicit injection because it disguises the missing guarantee.                                                 | Easy, but misleading.                                                                                                                                                                                       | Reject.                                                                                                       |

### 1. Real Access tunnel/domain

Cloudflare Tunnel can publish a local service such as `http://localhost:8000` at a public hostname ([published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/), [route setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/#2a-publish-an-application)). Cloudflare recommends creating the Access application before publishing the tunnel because an unprotected tunnel hostname is public ([self-hosted application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/#2-connect-your-origin-to-cloudflare)). Alchemy has first-class Tunnel and Access resources; its Tunnel source shows a declared ingress mapping a hostname to localhost, while its Access Application returns the stable `aud` required by the verifier ([Alchemy `Tunnel.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Tunnel/Tunnel.ts#L104-L125), [`Access/Application.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts#L155-L176)).

Guardrails:

- use a distinct per-developer or dev-stage hostname, Access application, audience, tunnel, and state; never point a development tunnel at production data;
- make Access before the public route, default deny, and retain the Gateway's own verification;
- let Alchemy own declared cloud resources if this becomes a regular stage resource, consistent with ADR-0001; a temporary manually launched connector may be acceptable for diagnosis, but it should not become hidden permanent infrastructure;
- do not expose the local workerd listener beyond loopback;
- tear down or stop the connector when unused.

This path makes browser Origin simple: the browser's exact origin is the HTTPS Access hostname. It is also the only option that demonstrates Cloudflare's production boundary. Its cost and dependency on cloud state make a deployed dev-stage smoke simpler than tunneling every edit.

### 2. Locally signed JWT and local JWKS

Overseer's production verifier already follows Cloudflare's recommended form: one isolate-scoped remote JWKS, exact configured issuer and audience, RS256 only, `typ: JWT`, and required `exp`/`iat` ([`access-principal.ts`](../../src/adapters/gateway/access-principal.ts#L123-L151)). RFC 7519 requires recipients to reject an audience that does not identify them and defines issuer and audience comparisons as case-sensitive strings ([RFC 7519 §§4.1.1–4.1.4](https://www.rfc-editor.org/rfc/rfc7519#section-4.1)). JWT BCP further requires an algorithm allow-list, issuer-to-key binding, audience validation, and mutually exclusive validation rules for different token kinds ([RFC 8725 §§3.1, 3.8–3.12](https://datatracker.ietf.org/doc/html/rfc8725#section-3)). A JWKS is a JSON object with a `keys` array; `kid` exists to select a key during rollover ([RFC 7517 §§4.5, 5](https://www.rfc-editor.org/rfc/rfc7517#section-5)).

A local fixture should therefore:

- generate a development-only asymmetric key, expose only its public JWK, set a stable local `kid`, and keep the private key out of source, bundles, logs, Alchemy state outputs, and Yaak workspace files;
- issue short-lived RS256 tokens with exact local `iss` and `aud`, `typ: JWT`, `type: app`, `iat`, and `exp`, plus either the Human (`sub` and `email`) or Agent (`common_name`, empty `sub`) claim shape;
- bind issuer configuration to that one JWKS endpoint rather than trusting a token-provided `jku`/`x5u`; RFC 8725 warns that following attacker-selected key URLs creates SSRF and trust-confusion risks ([RFC 8725 §3.10](https://datatracker.ietf.org/doc/html/rfc8725#section-3.10));
- bind the issuer/minting sidecar to loopback, expose no arbitrary “mint any principal” endpoint to the LAN, use a locally trusted HTTPS certificate if retaining Overseer's current HTTPS-only issuer schema, and fail closed when JWKS is unavailable;
- test wrong issuer, wrong audience, expired/future token, wrong algorithm, unknown `kid`, malformed identity, and key rotation.

Polis is a useful first-party open-source precedent: its development OIDC simulator issues JWTs, serves a local JWKS, uses configurable issuer/audience, and runs over locally trusted HTTPS; its documentation says explicitly that the simulator and credentials are development/testing-only ([Polis simulator source](https://github.com/compdemocracy/polis/blob/dev/oidc-simulator/src/index.ts), [README and TLS setup](https://github.com/compdemocracy/polis/blob/dev/oidc-simulator/README.md)). It also demonstrates the operational weight of this choice: a sidecar, certificates, trust-store setup, test identities, and separate configuration.

Overseer already has the lighter test form: tests generate an RSA pair, sign Cloudflare-shaped tokens, and intercept only the configured issuer's `/cdn-cgi/access/certs` response ([`tests/fixtures/alchemy-gateway.ts`](../../tests/fixtures/alchemy-gateway.ts#L103-L198), [research 57](57-alchemy-local-runtime-testing.md#decision)). Keep that capability focused on verifier behavior rather than promoting it into a developer identity system.

### 3. Explicit development-only principal injection

The best local default is a separate implementation of the existing `AccessAssertionVerifier` capability. It returns a fixed, already parsed `AuthenticatedPrincipal`; the unchanged Gateway still constructs request context, applies Human/Agent mutation admission, and derives attribution. No raw Cloudflare claims cross inward.

Backstage provides a strong first-party precedent. Its guest auth provider is documented as development-only and explicitly disabled outside development ([Backstage guest provider](https://backstage.io/docs/auth/guest/provider/)). Its source checks `NODE_ENV`, refuses authentication outside development unless a conspicuously named dangerous override is set, and issues one configured guest identity rather than trusting arbitrary request identity ([authenticator](https://github.com/backstage/backstage/blob/master/plugins/auth-backend-module-guest-provider/src/authenticator.ts), [resolver](https://github.com/backstage/backstage/blob/master/plugins/auth-backend-module-guest-provider/src/resolvers.ts)). Grafana's proxy-auth documentation supplies the complementary warning: when identity comes from a header, callers can spoof it unless the application restricts which proxy addresses may send it ([Grafana AuthProxy](https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-authentication/auth-proxy/)). Overseer should avoid that extra hazard by injecting a configured fixed principal, not by accepting `X-Overseer-User` or caller-supplied Cloudflare claims.

Required guardrails:

- select the Layer only from Alchemy's trusted dev plan/composition root, never from an HTTP header, query parameter, cookie, or bundled runtime toggle;
- fail deployment if the development Layer is selected when `dev !== true`, and keep the production stack's real Access resources and verifier as the default non-dev branch;
- bind local workerd to loopback and print a clear startup message such as “development principal injection active”; never print identity secrets or assertions;
- use a fixed typed principal from parsed configuration. If both browser and Yaak must run simultaneously, prefer two explicit local launch profiles or a tiny allow-listed profile selector at the composition boundary; do not accept arbitrary subjects, emails, Agent IDs, or roles from requests;
- retain all post-authentication controls. A Human profile still requires the exact allowed Origin on unsafe methods. An Agent profile still requires `Overseer-Session-Id`, with optional harness metadata remaining non-authoritative;
- keep verifier integration tests and a live Access smoke so the easy local path cannot silently become the only authentication coverage.

This is not “verification disabled.” The local composition explicitly states that its authentication source is a fixed development principal. Production still has exactly one implementation that accepts public assertions, and that implementation verifies them.

### 4. Disabling verification

Reject all variants:

- decoding JWT payloads without checking the signature;
- accepting any non-empty `Cf-Access-Jwt-Assertion`;
- trusting `Cf-Access-Authenticated-User-Email` or a custom identity header directly from a publicly reachable request;
- allowing all requests and synthesizing identity deep in handlers;
- accepting `alg: none` or widening the production algorithm list for local convenience.

Cloudflare says header/payload inspection alone is insufficient because it permits identity spoofing ([application-token signature warning](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)). RFC 8725 requires explicit algorithm verification and rejection of failed cryptographic operations ([RFC 8725 §§3.1–3.3](https://datatracker.ietf.org/doc/html/rfc8725#section-3.1)). A bypass also contradicts ADR-0001 and spreads environment checks into inner HTTP code rather than using the repository's existing service seam.

## Issuer, audience, and Origin are independent

These values must not be collapsed into one “local URL” setting:

- **Issuer (`iss`)** identifies who signed the token and binds verification keys to that issuer. For production it is the exact Cloudflare team-domain origin, not the application hostname ([Cloudflare validation guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#access-signing-keys)). Overseer currently fetches `/cdn-cgi/access/certs` relative to this issuer and verifies `issuer.origin` exactly ([`access-principal.ts`](../../src/adapters/gateway/access-principal.ts#L123-L146)). A local JWT fixture needs its own exact issuer and keys; it must not pretend to be the production team domain.
- **Audience (`aud`)** is the opaque recipient identifier assigned to one Access application. Alchemy exposes it as the Access Application's stable `aud` output ([`Access/Application.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts#L155-L176)). It is not the Gateway URL. A local fixture may use a clearly local audience, but token and verifier must match exactly.
- **Request Origin** protects unsafe Human browser requests from cross-site submission. It is the exact scheme/host/port of the browser application, unrelated to JWT issuer and audience. Yaak is not a Human browser and generally does not supply browser Origin semantics; it should authenticate as an Agent and satisfy Agent session metadata instead of forging `Origin`.

There is a current local configuration issue independent of authentication: `OVERSEER_HOSTNAME` is transformed into an HTTPS origin, while Alchemy's local provider returns an HTTP localhost URL with a port ([`gateway-configuration.ts`](../../src/adapters/gateway/gateway-configuration.ts#L20-L54), [`LocalWorkerProvider.ts`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Workers/LocalWorkerProvider.ts#L477-L481)). Unsafe Human mutations will therefore fail exact-Origin checking if local configuration says `https://localhost` while the browser runs at `http://localhost:1337`. Local runtime configuration should accept the exact Alchemy local origin, including scheme and port, separately from the deploy-time DNS hostname. Do not solve this by weakening the Origin comparison.

## Yaak setup by pattern

### Recommended local adapter

- Set a Yaak sub-environment `BASE_URL` to the Alchemy local URL; do not commit machine-specific values.
- Run the Gateway with the fixed local Agent principal.
- Inherit `Overseer-Session-Id` and optional `Overseer-Harness` at the workspace/folder level. Yaak supports inherited headers/auth with lower-level overrides ([request inheritance](https://yaak.app/docs/authentication/request-inheritance)).
- Use a fresh stable session ID for one logical agent run. It is metadata, not a credential.
- No Access secret or synthetic assertion is required.

### Real Access stage or tunnel

- Set `BASE_URL` to the protected HTTPS hostname.
- Inherit `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Store values in Yaak encrypted secrets, 1Password integration, or local-only environment values—not shared workspace files. Cloudflare shows the client secret only at creation and recommends revocation/rotation through the service-token lifecycle ([service-token creation](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#create-a-service-token)).
- Do **not** create or send `Cf-Access-Jwt-Assertion`; the Agent authenticates to the edge and Access injects that origin assertion. Overseer's OpenAPI description already states this distinction ([`http-api.ts`](../../src/contract/http-api.ts#L687-L701)).
- Continue sending Overseer Agent session headers on mutations.

Yaak environments are designed to switch base URLs and credentials among development/staging/production ([environments and variables](https://yaak.app/docs/templating/environments-and-variables)); cookie jars can preserve application cookies, but direct service-token headers are simpler for Agent calls ([cookie jars](https://yaak.app/docs/authentication/cookies)).

### Local JWT/JWKS

Yaak can generate RS256 JWTs from a private key and environment-backed claims, but its built-in JWT auth writes `Authorization: Bearer ...` ([Yaak JWT](https://yaak.app/docs/authentication/jwt)). Overseer deliberately consumes Cloudflare's origin-only `Cf-Access-Jwt-Assertion`. Bridging the two requires a custom Yaak template/plugin, an externally minted short-lived token inserted into that custom header, or an additional local mint request. Yaak supports custom Node-backed template functions, but that is extra project-specific tooling ([template functions](https://yaak.app/docs/templating/template-functions)). Do not teach the Gateway to accept Bearer tokens merely to fit the client; that would create a second public authentication protocol.

## Concrete repository direction

1. Keep `src/adapters/gateway/access-principal.ts` unchanged as the production Cloudflare assertion adapter.
2. Add at most one honest local implementation of the same `AccessAssertionVerifier` service, owned by the Gateway composition root. It should return a fixed typed Human or Agent principal and contain no HTTP parsing.
3. Select that Layer only in `alchemy dev` / `Test.make({ dev: true })`; make an impossible production combination fail during plan/startup. Do not add a general “skip auth” flag.
4. Separate local exact application origin from the production hostname configuration so browser Origin remains exact for the actual local URL.
5. Give Yaak a local Agent profile with inherited session headers, and a real-Access profile with inherited Access service-token headers stored outside version control.
6. Preserve the current signed-JWT/JWKS integration fixtures for verifier behavior, add rotation/issuer/audience failures there as needed, and retain one live Access stage smoke.
7. If full edge-to-local diagnosis becomes frequent, declare a per-dev Alchemy Tunnel, DNS record, Access application/policies, and connector lifecycle as an explicit optional profile. Do not burden the default loop with it.

This is the smallest design that is honest about what local workerd can prove, keeps Cloudflare Access as the sole production admission system, and follows Overseer's Effect service/layer composition rules.
