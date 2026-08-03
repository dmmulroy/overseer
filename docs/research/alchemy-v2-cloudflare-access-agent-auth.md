# Alchemy v2 + Cloudflare Access: production human and Agent authentication

**Date:** 2026-07-30  
**Scope:** Alchemy v2, the vendored `repos/alchemy` snapshot, Cloudflare Access, and the `main` branch implementation as inspected with `git show main`.  
**Status:** Research report; no implementation files or `planning.md` were changed.

## Executive recommendation

Use one Cloudflare Access self-hosted application per Alchemy stage, with two narrowly scoped reusable policies:

- a human `allow` policy tied to the approved organization identity/group (the current branch uses one owner email); and
- an Agent `non_identity` / **Service Auth** policy including exactly that stage's service token.

Give each operational Agent its own service token. The Agent sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` to the Access hostname; it must not manufacture or send `Cf-Access-Jwt-Assertion`. Access authenticates the Agent and injects the application JWT on the request to the Gateway.

Keep the current Effect boundary: the Gateway adapter alone verifies the Access assertion and converts verified claims into a small `AuthenticatedPrincipal`; domain/application code sees only `HumanActor` or `AgentActor`. Retain the existing Agent session headers as attribution metadata, not credentials or authority.

Before production, change two things: make the local-authentication selection impossible outside a trusted `alchemy dev`/test composition, and separate the exact local HTTP origin from the deploy-time HTTPS hostname. Also harden the service-token claim discriminator and define a deliberate service-token rotation/distribution runbook.

## Evidence conventions

- **Verified fact** means directly stated by a cited Cloudflare/Alchemy source or observed in the repository.
- **Recommendation** is the design conclusion for Overseer.
- **Compatibility gap** is a mismatch between the current Alchemy/Access surface and the desired design.
- **Unresolved** means the cited sources do not settle the question and a live-stage test or product decision is needed.

## 1. What Alchemy v2 can provision

### Access applications, hostnames, and audiences — verified

Alchemy's vendored `Cloudflare.Access.Application` supports `type: "self_hosted"`, a primary `domain`, modern `destinations`, `sessionDuration`, selected identity providers, and references to standalone policies. The simple `domain` is the public hostname/path shorthand; `destinations` also supports public URIs, private hostname/CIDR targets, and MCP portal destinations ([`ApplicationProps`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts#L53-L159)). The resource does **not** itself create a DNS record or a Tunnel route: a hostname must be owned/routed separately.

The application output includes `applicationId`, `domain`, and the Access `aud` tag ([`ApplicationAttributes`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts#L162-L190)). Alchemy treats `applicationId`, `aud`, `type`, and `accountId` as stable, and its recovery code deliberately avoids blindly creating a second application for an existing domain because that would create a new audience and break JWT validation ([`ApplicationProvider`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts#L305-L359)). Cloudflare likewise says the AUD tag is unique to the application and does not change unless the application is deleted and recreated ([official validation guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag)).

For a public self-hosted application, Cloudflare requires an active Cloudflare domain with full or partial CNAME setup. The hostname is selected as the Access application's public hostname, policies are attached, and the origin is then connected directly or through a Tunnel ([Cloudflare: publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)). Cloudflare recommends creating Access before publishing a Tunnel route, because the route is public if no Access application protects it.

**Recommendation:** `stageOrigin.hostname` is a reasonable Access `domain` for this project, but DNS/Worker custom-domain/Tunnel lifecycle must remain explicit. Use separate hostnames, applications, audiences, tokens, and Alchemy state for `dev`, preview, staging, and production.

### Policies and identity versus service authentication — verified

Alchemy's `Cloudflare.Access.Policy` is reusable and account-scoped. Its `decision` supports `allow`, `deny`, `non_identity`, and `bypass`; `include` rules are OR, `exclude` rules are NOT, and `require` rules are AND ([`PolicyProps`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Policy.ts#L24-L97)). The rule type is re-exported from the Cloudflare API shape and includes email, groups, device posture, certificate/common name, and service-token selectors ([`PolicyRule`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/Policy.ts#L13-L22)).

Cloudflare calls `non_identity` **Service Auth** in the UI/API semantics. Service Auth is the action for non-IdP authentication such as service tokens and mTLS; a service-token selector must be included in the policy ([Cloudflare policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/#service-auth), [service-token policy example](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/#authenticate-a-service-using-a-service-token)). Access is deny-by-default, and policy action ordering matters: Service Auth and Bypass are evaluated before Block and Allow ([Cloudflare policy order](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/#cloudflare-access-policy-order-of-execution)).

The current `main` branch uses:

```ts
Cloudflare.Access.Policy("Human", {
  decision: "allow",
  include: [{ email: { email: accessConfiguration.ownerEmail } }],
})

Cloudflare.Access.Policy("Agent", {
  decision: "non_identity",
  include: [{ serviceToken: { tokenId: agentToken.serviceTokenId } }],
})
```

([`main:src/infra/gateway.ts#L59-L68`](../../src/infra/gateway.ts#L59-L68)). This is the correct Access policy shape. Whether one owner email is sufficient is a product authorization decision; for a real team, replace it with an organization domain/group plus any required MFA/device posture, while preserving a distinct Service Auth path for Agents.

### Service tokens, credentials, rotation, and revocation — verified

Alchemy's `Cloudflare.Access.ServiceToken` accepts a name, duration, `clientSecretVersion`, and `previousClientSecretExpiresAt` ([`ServiceTokenProps`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts#L15-L45)). Its output contains the service-token UUID, client ID, redacted client secret, expiration, and version. The provider documents that the secret is returned only on create/rotate and carried forward redacted ([`ServiceToken` output/docs](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts#L47-L118)).

The reconciler creates the token, performs a separate read for expiration, and rotates only when the declared version increases. The prior secret remains valid until the requested cutoff ([`ServiceTokenProvider.reconcile`](../../repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts#L214-L349)). Cloudflare's API confirms the same lifecycle:

- create: `POST /accounts/{account_id}/access/service_tokens`; the client secret is returned only then ([API create](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/create/));
- rotate: `POST /accounts/{account_id}/access/service_tokens/{service_token_id}/rotate`, optionally retaining the old secret until a specified timestamp ([API rotate](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/rotate/));
- revoke: delete the service token; deleting the token prevents further access ([API delete](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/delete/)).

Cloudflare's documented request pair is:

```http
CF-Access-Client-Id: <CLIENT_ID>
CF-Access-Client-Secret: <CLIENT_SECRET>
```

The client secret is shown only at creation. Cloudflare also documents a cookie/raw-token continuation mode, but says that an application with only Service Auth policies requires the service-token pair on every subsequent request ([service-token guide](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#connect-your-service-to-access)). Sending the pair on every Agent request is simpler and avoids treating an Access session cookie as the Agent's durable credential.

**Recommendation:** keep one token per Agent and stage, use a materially shorter lifetime than the current one-year default unless operational requirements justify it, and rotate on a scheduled version bump with an overlap window. Store the pair only in the Agent's secret store/CI secret manager. Do not put it in a browser bundle, committed Yaak workspace, logs, request bodies, or a Worker binding. The Worker does not need the pair; only the Agent-to-Access hop does.

### Deployment phases, stages, bindings, and secrets — verified

Alchemy stages isolate state, physical resource names, logs, and metrics; documented examples include `dev_<user>`, `pr-<n>`, `staging`, and `prod` ([Alchemy stages](../../repos/alchemy/website/src/content/docs/environments/stages.mdx#L8-L71)). This is the right isolation boundary for Access applications and service tokens.

`ALCHEMY_DEV` is set by `alchemy dev` and is false for deploy, plan, and deployed runtime; `ALCHEMY_PHASE` distinguishes plan from runtime ([vendored `Phase.ts`](../../repos/alchemy/packages/alchemy/src/Phase.ts#L20-L56)). The `main` stack uses that distinction to avoid provisioning Access in local dev and to use the real application audience in non-dev ([`main:src/infra/gateway.ts#L44-L83`](../../src/infra/gateway.ts#L44-L83)).

Alchemy's local Worker mode runs code in workerd, with emulated KV/R2/D1/Queues where providers exist; resources without local providers remain live cloud resources. The documented local URL is `http://localhost:1337` ([Alchemy local development](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx#L8-L43)). Cloudflare Access is an edge service and is not emulated by workerd.

Alchemy binds `Config` values yielded during Worker initialization as Cloudflare `secret_text` bindings; `Redacted` prevents accidental display. Shared, live-rotatable values can use the account-level Secrets Store and `ReadSecret` binding ([Alchemy secrets and env](../../repos/alchemy/website/src/content/docs/cloudflare/security/secrets-env.mdx#L12-L59), [Secrets Store](../../repos/alchemy/website/src/content/docs/cloudflare/security/secrets-env.mdx#L161-L205)). These mechanisms are appropriate for the Gateway's non-secret configuration and any runtime secret it truly needs. An Access service-token secret is different: it belongs to an external Agent, so binding it into the Gateway would increase blast radius and not help request verification.

**Local limitation:** a local request has no Cloudflare Access policy evaluation, browser redirect, service-token exchange, edge header injection, or real Access JWKS. A fixed development principal layer is honest for the normal loop; a signed local JWT/JWKS fixture is useful for verifier tests; a live Access stage is required for edge-to-origin smoke testing.

## 2. Cloudflare token facts and Gateway validation

### Exact application JWT shapes — verified

Cloudflare sends an application token to the origin in `Cf-Access-Jwt-Assertion`; a browser also has `CF_Authorization`, but Cloudflare recommends validating the assertion header because the cookie is not guaranteed to be passed ([Cloudflare authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/), [application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)).

The JWT header is:

```json
{
  "alg": "RS256",
  "kid": "<signing-key-id>",
  "typ": "JWT"
}
```

A human identity-token payload contains, at minimum for this design:

```json
{
  "aud": ["<application-AUD>"],
  "email": "user@example.com",
  "exp": 1659474457,
  "iat": 1659474397,
  "nbf": 1659474397,
  "iss": "https://<team>.cloudflareaccess.com",
  "type": "app",
  "sub": "<Access-user-id>"
}
```

A service-token application payload is materially different:

```json
{
  "type": "app",
  "aud": ["<application-AUD>"],
  "exp": 1659474457,
  "iss": "https://<team>.cloudflareaccess.com",
  "iat": 1659474397,
  "sub": "",
  "common_name": "<service-token-client-id>"
}
```

Cloudflare identifies `sub` as empty and `common_name` as the service-token Client ID for service-token authentication. Human tokens use the verified email and stable Access subject ([exact claim tables](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/#payload)). `aud` is an array in Cloudflare's examples; `jose`'s audience option correctly accepts a configured string as a member of that array.

### Issuer and JWKS — verified

The issuer is the exact team-domain origin, not the protected application hostname. The JWKS URL is:

```text
https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
```

Cloudflare says Access rotates signing keys by default every six weeks and keeps the previous key valid for seven days. Verification must select the JWK by JWT `kid`, use the external endpoint, and not hard-code only the current `public_cert` ([signing keys and rotation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#access-signing-keys)).

The Gateway should therefore reject a request unless all of the following succeed:

1. Read one `Cf-Access-Jwt-Assertion` header. Do not trust `CF_Authenticated-User-*` headers, `email` headers, cookies copied directly into an identity, or a caller-supplied Actor.
2. Verify the RS256 signature against a JWKS URL configured by the trusted composition root. Never follow token-controlled `jku`/`x5u` URLs.
3. Allow only `alg: RS256` and require `typ: JWT`; select the key by `kid`.
4. Require exact `iss` equal to the configured team-domain origin and exact `aud` membership for this stage's Access application's `aud`.
5. Validate time claims (`exp`, `iat`, and `nbf` when present), with a deliberately bounded clock-skew policy. Reject expired, not-yet-valid, malformed, unknown-key, wrong-issuer, wrong-audience, and wrong-algorithm tokens.
6. Require `type: "app"` and validate the identity shape before deriving a principal.
7. Map only the resulting typed principal inward. Keep raw JWT claims out of domain/application services.

The implementation in `main:src/adapters/gateway/access-principal.ts` already creates one isolate-scoped remote JWKS, restricts algorithms to RS256, requires `exp`/`iat`, and passes exact issuer/audience/type options to `jwtVerify` ([`make`, lines 112-167](../../src/adapters/gateway/access-principal.ts#L112-L167)). It also classifies missing assertion, invalid assertion, invalid identity, and verification-unavailable separately. That boundary should be retained.

## 3. Production request flows

### Human browser

1. The browser requests the stage's HTTPS Access hostname. If it lacks a valid application session, Access redirects to the configured IdP; the browser completes identity/MFA/device policy checks.
2. Access establishes its application session, normally via `CF_Authorization` on the application domain. Access checks the session on every request and emits/injects an application JWT toward the origin.
3. The browser calls `/api` with its Access cookies. Cloudflare forwards the request to the Worker with `Cf-Access-Jwt-Assertion`; the browser does not need to know or construct that header.
4. The Gateway verifies the JWT and derives `HumanPrincipal { subject, email }`, then `HumanActor { subject, email }`.
5. Safe reads proceed after authentication. For unsafe browser methods, the Gateway also requires an exact `Origin` equal to the configured application origin. This is an application CSRF boundary, independent of JWT `iss` and `aud`.
6. The HTTP adapter parses the operation. Domain objects and Durable Objects receive the derived Actor, never an actor supplied in JSON.

### Agent

1. The Agent targets the protected stage hostname and sends the two service-token headers. It must not follow a human login redirect.
2. Access matches the Service Auth policy's exact service-token ID, checks token validity and any additional policy requirements, and creates an application-scoped JWT for the request.
3. Access forwards the request to the Worker with `Cf-Access-Jwt-Assertion`. The Access client secret is not an application identity claim and should not be forwarded to the Gateway as an application credential.
4. The Gateway performs the same cryptographic validation as for a human, then recognizes the documented service shape (`type: app`, empty `sub`, string `common_name`) and derives `AgentPrincipal { agentId: common_name }`, then `AgentActor { agentId }`.
5. On unsafe methods, the Gateway requires `Overseer-Session-Id` and parses optional `Overseer-Harness`. These values identify a logical run/harness for attribution; they are untrusted metadata and do not authenticate, select an Agent, or grant authorization.
6. Authorization remains layered: Access admits the credential; the Gateway chooses human versus Agent mutation rules; the operation and authoritative Durable Object enforce resource/lifecycle permissions. A service token must not automatically imply all possible future operations.

The public contract documents this correctly: `Cf-Access-Jwt-Assertion` is the origin assertion, while an Agent authenticates at Access with `CF-Access-Client-Id` and `CF-Access-Client-Secret` ([`main:src/contract/http-api.ts#L881-L898`](../../src/contract/http-api.ts#L881-L898)).

## 4. Safe actor derivation

The repository's small domain model is good: `AuthenticatedPrincipal` has human and Agent variants; `Actor` has immutable `HumanActor` and `AgentActor` variants; `actorFromAuthenticatedPrincipal` is the only conversion ([`main:src/domain/actor.ts#L1-L106`](../../src/domain/actor.ts#L1-L106)).

The safe discriminator is **not** “email exists” or “common name exists.” Use the authenticated Access token shape:

- **Agent:** `type === "app"`, `sub === ""`, `common_name` is a bounded non-empty string, and it is the expected service-token client ID format/identity. Prefer an explicit allow-list or a stage-local mapping from Access client ID to internal `AgentId` if the system needs stable names independent of Cloudflare credentials.
- **Human:** `type === "app"`, `sub` is a non-empty bounded subject, `email` is present and validated, and the service-token marker is absent. The email is useful display/authorization data; the stable subject is the primary human identity.
- **Reject:** every other combination, including `sub` missing for a human, empty human email, non-`app` tokens, or a token with ambiguous human/service markers.

The current parser does most of this: it requires `type: "app"`; treats string `common_name` plus absent/empty `sub` as Agent; otherwise requires valid `sub` and `email` ([`main:src/adapters/gateway/access-principal.ts#L34-L66`](../../src/adapters/gateway/access-principal.ts#L34-L66)). **Change recommended:** make the two shapes mutually exclusive and explicit rather than using a broad “common name plus empty subject” branch. This protects against future custom claims or a changed Access token shape accidentally becoming an Agent. Do not derive an Agent from mTLS `common_name` unless a live token test proves that the origin JWT carries the intended certificate identity and the policy is configured to bind it.

## 5. Header, cookie, and secret handling

- At the Access edge, Agents send only `CF-Access-Client-Id` and `CF-Access-Client-Secret`; keep both in a secret manager and inject them at the HTTP client boundary.
- At the Gateway origin, validate only `Cf-Access-Jwt-Assertion`. Header names are case-insensitive; the Effect request implementation exposes them lower-case as `cf-access-jwt-assertion` ([`main:src/adapters/gateway/gateway-application.ts#L131-L162`](../../src/adapters/gateway/gateway-application.ts#L131-L162)).
- Do not make the Gateway accept `Authorization: Bearer` as a second protocol merely to accommodate an API client. Do not let an Agent send a self-signed JWT to the production assertion header.
- The browser's `CF_Authorization` cookie is an Access edge concern. The Gateway should not trust a cookie without verification, and the current header-first implementation is aligned with Cloudflare's recommendation.
- Never log JWTs, client secrets, cookies, or raw claims. Log only request ID, actor kind, stable internal Agent ID/subject where appropriate, and a non-secret failure category.
- Rotate the client secret by first distributing the new secret, then bumping `clientSecretVersion` and setting an overlap expiry. Verify both old/new requests during the planned overlap, then expire the old secret. Delete the Access service token immediately for compromise; revoking application sessions alone is insufficient because a still-valid client ID/secret can mint another session ([Cloudflare revocation note](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#revoke-service-tokens)).

## 6. Service token versus mTLS versus other mechanisms

| Mechanism | Strengths | Costs/risks | Overseer fit |
|---|---|---|---|
| **Access service token** | First-class headless Agent flow; simple HTTP clients; exact policy selector; Access supplies the same signed JWT Gateway already verifies; per-token revocation and rotation | Static secret pair is exportable; leakage grants the token's policy; needs distribution/rotation | **Recommended default** for production Agents |
| **Access mTLS** | Private-key possession at TLS handshake; no bearer secret in HTTP; can use `common_name`/valid-certificate policy; strong for managed devices | PKI issuance, renewal, revocation, client configuration, and debugging; current Alchemy mTLS resource uploads account certificates but does not provision the Access hostname association/policy as one composition | Use for high-assurance managed infrastructure or as an additional policy factor, not the first Agent path |
| `cloudflared access curl` / reusable user token | Convenient interactive development under a human identity | Agent actions become human-attributed; browser login/session lifecycle; poor headless identity separation | Good for interactive local diagnostics, not production Agent attribution |
| Managed OAuth | Standard Agent/client flow and delegated human authorization where supported | Access application OAuth configuration is beta/compatibility-dependent; more moving parts than this API needs | Revisit if Agents must act explicitly on behalf of a human |
| A custom API key/Bearer token | Easy to implement | Duplicates Access, requires another issuer/revocation system, and would bypass the desired human/Agent edge boundary | Reject |

Cloudflare documents mTLS as Service Auth for automated systems and IoT, with a CA associated to the protected FQDN and a policy selecting a common name or valid certificate ([mTLS](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)). Alchemy's vendored `Cloudflare.MtlsCertificate` is an account-level certificate-store resource for certificate-authority associations/Hyperdrive or Worker mTLS bindings, not an end-to-end Access mTLS application resource ([`MtlsCertificate` docs](../../repos/alchemy/packages/alchemy/src/Cloudflare/MtlsCertificate/MtlsCertificate.ts#L109-L170)). This is a compatibility gap, not a reason to put certificate types into the domain.

## 7. Audit of `main` branch implementation

### Retain

1. **One public Gateway composition root and verifier seam.** `AccessAssertionVerifier` is an Effect service; the production layer owns `jose`, JWKS, issuer, audience, and claim parsing. This keeps Cloudflare/platform types outside the domain.
2. **Independent Gateway verification.** The code does not merely trust that Access was in front of the Worker; it verifies the assertion, matching Cloudflare's direct-origin protection guidance ([self-hosted origin validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/#3-validate-the-access-token)).
3. **Correct cryptographic controls.** RS256 allow-list, `typ: JWT`, exact issuer/audience, required time claims, remote JWKS, and typed failure classification are all present ([`main:src/adapters/gateway/access-principal.ts#L101-L167`](../../src/adapters/gateway/access-principal.ts#L101-L167)).
4. **Correct edge policy composition.** The current `Human` plus `Agent` policies and self-hosted application reference are the right Alchemy resource graph ([`main:src/infra/gateway.ts#L39-L76`](../../src/infra/gateway.ts#L39-L76)).
5. **Actor and mutation boundaries.** Actor derivation occurs after authentication; human mutations use exact Origin and Agent mutations require bounded session metadata ([`main:src/adapters/gateway/gateway-application.ts#L164-L214`](../../src/adapters/gateway/gateway-application.ts#L164-L214), [`main:src/adapters/gateway/request-context.ts#L16-L98`](../../src/adapters/gateway/request-context.ts#L16-L98)).
6. **Local testing seam.** `layerLocalHuman` substitutes a fixed parsed principal rather than trusting an identity header ([`main:src/adapters/gateway/access-principal.ts#L169-L180`](../../src/adapters/gateway/access-principal.ts#L169-L180)); the existing research correctly distinguishes this from JWT/JWKS and live Access tests ([`docs/research/59-alchemy-cloudflare-local-authentication.md#L24-L33`](59-alchemy-cloudflare-local-authentication.md#L24-L33)).

### Change or verify before production

1. **Fail closed on local authentication mode.** `main:src/infra/gateway.ts#L119-L127` selects the fixed-human verifier from the runtime `OVERSEER_AUTHENTICATION_MODE` value. Configuration is deployment-controlled rather than request-controlled, but the code does not itself reject `local-human` when `dev !== true`. Make local mode a plan/composition-root-only choice and fail startup/deploy for the combination `dev !== true && mode === "local-human"`. Never ship a general auth bypass.
2. **Fix local exact-origin configuration.** `main:src/adapters/gateway/gateway-configuration.ts#L20-L54` turns `OVERSEER_HOSTNAME` into an HTTPS origin, while Alchemy local workerd serves `http://localhost:1337` ([Alchemy local provider/docs](../../repos/alchemy/website/src/content/docs/environments/local-development.mdx#L20-L35)). A local browser mutation can therefore fail the exact-Origin check. Keep production hostname and local `http://host:port` as separate configuration values; do not weaken comparison.
3. **Harden claim-shape parsing.** Replace the current permissive common-name branch with mutually exclusive, schema-checked human and service-token shapes. Consider mapping the Access client ID through a stage configuration table to an internal Agent ID, rather than persisting arbitrary future Cloudflare common-name values.
4. **Review policy scope.** `ownerEmail` currently grants exactly one human identity. Keep it if intentional for the MVP; otherwise use an organization group/domain policy and add explicit MFA/device posture requirements. Do not broaden the Agent policy to `any_valid_service_token` unless every token in the account is allowed to operate this Gateway.
5. **Operationalize the one-year token.** `AgentToken` is currently `duration: "8760h"` ([`main:src/infra/gateway.ts#L39-L42`](../../src/infra/gateway.ts#L39-L42)). Either document why that lifetime is acceptable or shorten it and schedule `clientSecretVersion` rotation. Ensure `agentClientSecret` from `alchemy.run.ts` is delivered through a redacted, access-controlled deployment channel and is never printed or committed ([`main:alchemy.run.ts#L13-L25`](../../alchemy.run.ts#L13-L25)).
6. **Add edge-parity coverage.** Retain unit/integration tests for wrong `iss`, `aud`, `kid`, algorithm, time, claim shape, and JWKS outage; add one live stage smoke that exercises a browser and a service-token Agent. Local workerd alone cannot prove Access policy matching or header injection.
7. **Resolve the origin exposure question.** Verify that the Worker hostname/origin cannot be reached in production without the Access application, or that direct-origin requests still fail Gateway verification. Cloudflare explicitly recommends origin validation for routing/network misconfiguration; do not rely only on Access edge admission.

## 8. Compatibility gaps and unresolved questions

### Compatibility gaps

- Alchemy v2 beta.64 exposes Access Application, Policy, and ServiceToken resources, but its `ApplicationProps` surface shown here does not expose every current Cloudflare application option (for example, the API's `read_service_tokens_from_header` and service-auth 401 setting). The standard two-header flow does not need those options.
- Alchemy local workerd does not emulate Access. A real Access hostname/tunnel or deployed stage is necessary for end-to-end parity.
- Alchemy's account-level `MtlsCertificate` resource is not a complete Access mTLS policy/hostname association abstraction.
- Cloudflare's documented application token distinguishes human and service-token claims, but does not promise that every future custom identity/mTLS configuration will preserve this exact shape. Claim parsing must be tested against the account's live configuration.

### Unresolved questions to answer with a live stage or decision

1. Should human access remain one owner email, or become an organization group/domain plus MFA/device posture?
2. Is one Agent token per named Agent sufficient, or does each ephemeral run require a separately provisioned credential?
3. What secret manager will receive the Alchemy output, and who can rotate/delete tokens without exposing production state?
4. What overlap duration is acceptable during rotation, and what is the emergency revocation procedure?
5. Does the chosen production Worker hostname have any direct route that bypasses Access, and does the Gateway reject it as intended?
6. If mTLS is later required, what exact Access-origin claim or trusted Worker TLS signal will become the internal `AgentId`? Do not assume the certificate Common Name is present in the application JWT.
7. Will Agents ever act on behalf of a human? If so, service-token `AgentActor` and human delegation must remain separate from simply accepting a human token in an Agent process; Managed OAuth or an explicit delegation model may be required.

## Primary sources

### Cloudflare

- [Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Common policies: service token and mTLS](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/)
- [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Application token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Validate JWTs, issuer, audience, JWKS, and Workers example](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Authorization cookie and assertion header](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)
- [Mutual TLS](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)
- [Create Access application API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/)
- [Create reusable Access policy API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/policies/methods/create/)
- [Create service token API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/create/)
- [Rotate service token API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/rotate/)
- [Delete service token API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/delete/)
- [Rotate Access signing keys API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/keys/methods/rotate/)

### Alchemy v2 vendored source and docs

Official rendered documentation: [Alchemy local development](https://alchemy.run/environments/local-development), [Alchemy stages](https://alchemy.run/environments/stages), and [Alchemy secrets and env](https://alchemy.run/cloudflare/security/secrets-env). The primary vendored source/docs used for the line-level citations are:

- `repos/alchemy/packages/alchemy/src/Cloudflare/Access/Application.ts`: `ApplicationProps`, `ApplicationAttributes`, `ApplicationProvider` (lines 18-190, 305-359).
- `repos/alchemy/packages/alchemy/src/Cloudflare/Access/Policy.ts`: `PolicyDecision`, `PolicyProps`, `PolicyRule`, `PolicyProvider` (lines 13-128, 171-247).
- `repos/alchemy/packages/alchemy/src/Cloudflare/Access/ServiceToken.ts`: `ServiceTokenProps`, output contract, create/read/rotate/delete reconciliation (lines 15-122, 214-359).
- `repos/alchemy/packages/alchemy/src/Cloudflare/MtlsCertificate/MtlsCertificate.ts`: account-level certificate resource and scope (lines 109-170).
- `repos/alchemy/packages/alchemy/src/Phase.ts`: `ALCHEMY_PHASE` and `ALCHEMY_DEV` (lines 20-56).
- `repos/alchemy/website/src/content/docs/environments/local-development.mdx`: workerd/local-provider behavior and local URL (lines 8-43, 66-81).
- `repos/alchemy/website/src/content/docs/environments/stages.mdx`: stage isolation and stage patterns (lines 8-71).
- `repos/alchemy/website/src/content/docs/cloudflare/security/secrets-env.mdx`: Config/Redacted bindings and Secrets Store (lines 12-59, 161-205).

### Overseer `main` branch audit targets

The report's implementation references are from the repository's `main` commit, not the current `V2` worktree:

- `main:src/infra/gateway.ts#L39-L127`: Agent token, Access policies/application, phase split, runtime verifier selection.
- `main:src/adapters/gateway/access-principal.ts#L34-L180`: claim parsing, JWT/JWKS verification, failures, local layer.
- `main:src/adapters/gateway/gateway-configuration.ts#L20-L103`: audience, issuer, origin, and authentication-mode configuration.
- `main:src/adapters/gateway/gateway-application.ts#L123-L214`: assertion header handling, verification, mutation admission, actor derivation.
- `main:src/adapters/gateway/request-context.ts#L16-L98`: exact human Origin and Agent session rules.
- `main:src/domain/actor.ts#L1-L120`: principal/actor types and conversion.
- `main:src/contract/http-api.ts#L881-L906`: public Cloudflare Access header contract.
- `main:alchemy.run.ts#L13-L25`: stage output of Agent client credentials.
- `docs/research/57-alchemy-local-runtime-testing.md#L1-L48` and `docs/research/59-alchemy-cloudflare-local-authentication.md#L1-L146`: existing local-runtime and local-auth research to retain and reconcile with this report.
