# Alchemy/Cloudflare Access service-token CLI for Agents

**Date:** 2026-08-06  
**Scope:** current Overseer worktree, pinned `alchemy@2.0.0-beta.67`, pinned first-party Effect Cloudflare SDK `@distilled.cloud/cloudflare@0.30.3`, vendored Alchemy sources, and current Cloudflare documentation.  
**Status:** research and recommendation only; no code or planning files were changed.

## Executive recommendation

Keep Agent service tokens **Alchemy-managed** for the first version. Add a small repository CLI as a safe operator front end to a dedicated Agent-access Alchemy stack and a complete, non-secret Agent manifest. The stack should own every Agent token and the one exact-token Service Auth policy; the API stack should only attach that policy by ID. The CLI should create by adding a manifest entry, rotate by monotonically increasing `clientSecretVersion` and setting an overlap cutoff, and revoke by removing the Agent from desired state and deploying. It should deploy programmatically so it can pass the returned `Redacted` secret directly to a delivery adapter without printing it.

Do **not** let a direct Cloudflare API script create tokens while the current `alchemy.run.ts` continues to own the same token or policy. Alchemy will reconcile its declared policy back to its own exact selector, and an out-of-band-deleted Alchemy token will be recreated on a later deployment. If “no repository change/deploy to issue a credential” becomes a hard requirement, use the imperative design in this report, but migrate both the Agent token set and Agent policy to that CLI as one ownership boundary; leave Alchemy owning only the Access application and referencing an externally managed policy ID.

The recommended default UX is:

```text
overseer-ops agent-token create <agent> --stage production --duration 2160h --to <destination>
overseer-ops agent-token rotate <agent> --stage production --overlap 2h --to <destination>
overseer-ops agent-token status <agent> --stage production
overseer-ops agent-token revoke <agent> --stage production --yes
```

No command prints a secret by default. `--to` writes to a secret-manager adapter, an already-open file descriptor, or an explicitly requested atomic mode-0600 file. A narrowly guarded `--show` escape hatch may display once only on an interactive TTY and must be rejected under CI or redirected output.

## 1. Current repository state

`apps/api/alchemy.run.ts` currently declares one module-level `OverseerApiAgentAccessToken` with a 90-day duration, creates one reusable `non_identity` policy selecting that token's exact `serviceTokenId`, attaches the policy to the self-hosted application, and returns the token client ID and redacted client secret in the production stack output ([current stack](../../apps/api/alchemy.run.ts#L7-L31), [current output](../../apps/api/alchemy.run.ts#L67-L76)). This is the correct Cloudflare policy shape, but it represents one shared Agent credential, has no declared rotation version, and couples credential lifecycle to deployment of the whole API stack.

The repository pins `alchemy` to `2.0.0-beta.67`; that package pins the generated Effect-native Cloudflare client to `0.30.3` ([root package](../../package.json), [Alchemy package metadata](../../node_modules/alchemy/package.json)). The installed source, rather than latest Alchemy documentation, is therefore the compatibility contract for an implementation.

## 2. Two different credentials must not be confused

| Credential                          | Purpose                                               | Holder                    | Required authority                                                                                                              |
| ----------------------------------- | ----------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare **API token**            | Lets the CLI/Alchemy call Cloudflare's management API | Operator/CI secret store  | For token-only operations, `Access: Service Tokens Write`; policy mutation additionally needs `Access: Apps and Policies Write` |
| Cloudflare Access **service token** | Lets one Agent call the protected Overseer hostname   | That Agent's secret store | Selected by a Service Auth policy; sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret`                                  |

Cloudflare explicitly distinguishes service-token creation from use: creation requires an API bearer token, while the resulting pair authenticates requests to Access ([Cloudflare service-token guide](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)). Cloudflare API tokens are themselves one-time-displayed management secrets and should be account/resource scoped and least privilege ([Cloudflare API-token guide](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)). Never deliver the management API token to an Agent.

## 3. What pinned Alchemy does

### Creation, observation, and ownership

`Cloudflare.Access.ServiceToken` accepts `name`, `duration`, `clientSecretVersion`, and `previousClientSecretExpiresAt`; its stable outputs are the Cloudflare token ID, account ID, and client ID ([pinned source](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts#L15-L73), [provider stables](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts#L128-L170)). On create, Alchemy calls the generated client's account endpoint and wraps the one-time secret in `Redacted` ([create reconciler](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts#L214-L287)). On subsequent GET/list calls Cloudflare does not return the secret, so Alchemy carries its prior redacted value forward from state ([read path](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts#L172-L212)).

A missing declared token is recreated, first by cached ID observation and then deterministic-name lookup ([observe/ensure](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts#L225-L287)). Consequences:

- An imperative emergency delete revokes the compromised credential immediately, but it is not the complete declarative fix. Remove the declaration/manifest entry promptly; otherwise a later deploy creates another token under the declared identity.
- Adoption or state recovery can recover token metadata by name but cannot recover its secret. A recovered token can be authorized yet undistributable until explicitly rotated.
- A direct Cloudflare script and Alchemy must never claim the same deterministic token name.

### Rotation and versioning

Pinned Alchemy rotates only when desired `clientSecretVersion` is greater than the version persisted in resource output; it calls `POST .../rotate`, wraps the returned secret, and stores the maximum version ([rotation reconciler](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts#L310-L349)). Versions are therefore a monotonic **desired-state trigger**, not a secret and not a Cloudflare secret value. Store them in the Agent manifest and review them like schema/deployment versions.

Cloudflare's rotate endpoint returns a new client secret. If `previous_client_secret_expires_at` is absent, the previous secret expires immediately; when supplied, it defines the overlap cutoff ([official rotate API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/rotate/)). Rotation does not require changing the policy because the service-token UUID remains the selector and only its secret changes.

There is one pinned-version caveat: although Alchemy's prop documentation says the prior-secret expiration may be extended later, this provider issues its update PUT only when name or duration differs; changing only `previousClientSecretExpiresAt` after rotation does not trigger a PUT ([sync predicate](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts#L289-L309), [rotation call](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts#L310-L323)). The first CLI should choose a conservative overlap at rotation time and not advertise “extend overlap” for Alchemy-managed tokens. The imperative Cloudflare API does support changing the timestamp later ([official create/update semantics](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/create/)).

### Secret state and output lifecycle

`Redacted` prevents ordinary string, JSON, and inspection output from revealing a value, but it is not encryption; trusted code can call `Redacted.value` ([Effect source](../../node_modules/effect/src/Redacted.ts#L1-L39), [value API](../../node_modules/effect/src/Redacted.ts#L223-L244)). Normal `alchemy deploy` logs the resolved stack output, so the current stack's returned client secret should display redacted ([deploy command](../../node_modules/alchemy/src/Cli/commands/deploy.ts#L153-L166)). That makes the stock CLI unsuitable as the delivery channel: it intentionally does not reveal the new secret.

Alchemy deliberately unwraps `Redacted` while encoding state into `{ "__redacted__": <actual value> }` so it can preserve one-time credentials ([state encoding](../../node_modules/alchemy/src/State/StateEncoding.ts#L47-L69)). The configured Cloudflare state store encrypts encoded resource state and stack outputs before Durable Object storage ([state-store encryption](../../node_modules/alchemy/src/Cloudflare/StateStore/Store.ts#L20-L72), [output storage](../../node_modules/alchemy/src/Cloudflare/StateStore/Store.ts#L208-L234)). The current stack also returns the secret, and Alchemy persists every evaluated stack output, so that secret exists in both token resource state and stack output ([apply output persistence](../../node_modules/alchemy/src/Apply.ts#L213-L228)).

Important operational warning: pinned `alchemy state get` calls `encodeState` and prints the encoded JSON, which exposes the value inside `__redacted__` to stdout ([state command](../../node_modules/alchemy/src/Cli/commands/state.ts#L184-L202)). Local state similarly writes encoded values to `.alchemy/state`. Therefore:

- Treat Alchemy state access as secret-reader access.
- Do not run `alchemy state get` for service-token resources in logged CI or paste its output into issues.
- Keep `.alchemy/` ignored and local files permission-restricted.
- Restrict the Cloudflare state-store bearer token and Cloudflare account access.
- Prefer stack outputs containing only policy/token metadata; if a custom deploy program temporarily needs a secret output, recognize that Alchemy persists that output too.

## 4. Policies and ownership

Cloudflare requires **Service Auth** for service-token authentication; in the API and Alchemy this action is `non_identity`. An exact token selector has the shape `{ service_token: { token_id } }` at the REST boundary and `{ serviceToken: { tokenId } }` in the generated/Alchemy TypeScript shape ([Cloudflare example](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/#authenticate-a-service-using-a-service-token), [Alchemy policy type](../../node_modules/alchemy/src/Cloudflare/Access/Policy.ts#L13-L72)). Multiple `include` rules are OR, so one policy may enumerate all authorized Agent token IDs ([Cloudflare policy semantics](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/#include)).

Use one token per named Agent and stage, and one exact-token Agent policy per Access application/stage. Do not use **Any Access Service Token**: Cloudflare says it accepts any service token created for the account, which would couple Overseer access to unrelated account credentials ([selector table](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/#cloudflare-access-selectors)). Do not use Bypass; it disables Access controls and logging.

There must be one writer for the reusable Agent policy. Pinned Alchemy updates reusable policies by resending the complete desired policy and explicitly does so on every reconciliation ([policy reconciler](../../node_modules/alchemy/src/Cloudflare/Access/Policy.ts#L244-L278)). Thus a Cloudflare API CLI that appends a token selector to the current Alchemy-managed `OverseerApiAgentAccess` policy will appear to work until the next Alchemy deployment removes it.

The Access application may remain Alchemy-managed because it references reusable policies by ID ([application policy props](../../node_modules/alchemy/src/Cloudflare/Access/Application.ts#L123-L160)). This permits a clean imperative alternative only if the externally managed policy ID is supplied to Alchemy and Alchemy no longer declares that policy's body.

## 5. Recommended implementation shape: Alchemy-managed

### Resource topology

Split credential infrastructure from the Worker deployment:

1. A dedicated `OverseerAgentAccess` stack, deployed to the same named stage as the API, reads a **complete non-secret manifest** of Agents: stable slug, duration, and integer secret version.
2. It declares one `Cloudflare.Access.ServiceToken` per Agent with an explicit stage-qualified name and creates one reusable `non_identity` policy whose `include` contains every token ID.
3. `OverseerApi` keeps the human policy and Access application, but references the Agent-access stack's policy ID through Alchemy's persisted cross-stack output. Alchemy persists stack outputs per `(stack, stage)`, and stages isolate state and physical names ([Alchemy stack-output source](../../node_modules/alchemy/src/State/State.ts#L115-L134), [Alchemy stage guide](../../repos/alchemy/website/src/content/docs/environments/stages.mdx)).
4. The local `alchemy dev --stage local` branch continues to create no Access resources. Production, staging, and live development stages have separate manifests/tokens/policies.

Do not implement the CLI as a parameterized stack that declares only the one Agent named on the command line. Alchemy treats omitted previously managed resources as deletions. Every deploy must compile the complete token set for that stack/stage.

### CLI layers

Keep the operator entrypoint under `apps/ops` and reserve `overseer` for the eventual user-facing API CLI. The operational executable may be named `overseer-ops`. Shared deployment, authenticated-client, stage, or test-orchestration capabilities move to `packages/*` when another app or test consumer needs them; `apps/ops` never imports `apps/api`.

Keep four small boundaries:

- **Command parser:** validates Agent slugs, explicit stage, durations, overlap, destination, and confirmation flags.
- **Manifest service:** performs locked, atomic updates to non-secret desired state. `create` adds version 1; `rotate` increments exactly once; `revoke` removes. It must prevent two concurrent rotations from choosing the same version.
- **Alchemy deployment service:** imports the pinned stack and calls the public programmatic deploy effect (`alchemy/Deploy`) for the exact stage; this API returns resolved output without the stock CLI's display step ([programmatic deploy](../../node_modules/alchemy/src/Deploy.ts#L11-L33)). It must not shell out and scrape `alchemy deploy` text.
- **Credential delivery service:** accepts a redacted `{ clientId, clientSecret }`, unwraps only at the sink boundary, writes it, verifies success, and wipes the in-memory wrapper when practical.

Because programmatic deploy still persists stack output, the cleanest long-term delivery is an Alchemy-managed secret-manager resource/action that consumes the token secret and returns only a destination reference. If the first version delivers locally, keep the secret out of the durable stack output where possible and accept that the token resource state remains the recovery copy.

### Command behavior

#### `create`

1. Require explicit `--stage`; reject `local` and reject production without confirmation/CI approval.
2. Refuse an existing Agent slug; add version 1 and a finite duration to the complete manifest.
3. Plan and display metadata-only changes: Agent, stage, token name, duration, policy membership, destination. Never display the secret.
4. Deploy the Agent-access stack; deliver the returned pair; smoke-test the protected stage URL with the pair.
5. Print only token ID suffix/fingerprint, client-ID fingerprint, expiration, policy ID, version, destination reference, and smoke result.

#### `rotate`

1. Acquire a per-stage manifest/deployment lock.
2. Compute an absolute RFC3339 cutoff from `--overlap` and show it in the confirmation.
3. Increment the manifest version, deploy once, and deliver the newly returned secret.
4. Smoke-test the new secret. Optionally smoke-test the old secret during overlap without reading/logging it outside its existing destination.
5. Record metadata-only evidence. Do not declare success until delivery and new-secret smoke succeed.

Rotation must occur **before** delivery because Cloudflare generates the value. The overlap is what keeps the old Agent working while the new value is distributed. If delivery fails, Alchemy's encrypted state preserves the new redacted secret and the old secret remains valid until the chosen cutoff; a retry can re-read carried state. This recovery advantage is not available to a stateless imperative create/rotate call.

#### `status` and `revoke`

`status` lists Cloudflare/Alchemy metadata and checks that the exact token ID is in the intended policy; it never reads or tests the client secret unless explicitly asked to perform a sink-backed smoke test.

Normal revoke removes the Agent from the complete manifest and deploys so desired policy and token state converge. For compromise, a break-glass direct Cloudflare DELETE is appropriate because Cloudflare says deletion, not merely session revocation, prevents new authentication ([revocation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#revoke-service-tokens)); immediately follow it with manifest removal and deployment so Alchemy cannot recreate a declared token.

## 6. Safe delivery contract

A one-time secret is not successfully created/rotated until it is durably delivered. The CLI should enforce:

- **No stdout by default.** stdout is metadata-only JSON/text; stderr contains secret-free progress.
- **No argv or environment delivery.** Both are commonly inspectable and leak into shell/process tooling. For an external destination command, spawn an executable without a shell and send one JSON document on stdin.
- **Secret-manager adapter preferred.** Store `{ CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET }` under a stage/Agent/version path; return only the destination reference/version.
- **File delivery is explicit.** Use a parent directory already controlled by the user, create a temporary sibling with mode `0600` and no-follow/exclusive semantics, fsync, then atomic rename. Refuse an existing path unless the operator explicitly requests replacement. Never create the file in the repository.
- **`--show` is exceptional.** Require an interactive TTY confirmation, reject CI and redirection, display once, and warn that terminal scrollback may persist it.
- **No secret telemetry.** Never include headers, request bodies, Cloudflare responses, Redacted unwrapped values, or sink payloads in logs/spans/errors. Sanitize HTTP-client debug output.
- **Fail closed.** If delivery or verification fails, report a metadata-only recovery instruction. Do not print the secret “to help.”
- **Agent use.** The Agent stores the pair and sends the two documented headers to the protected hostname on every request; the API Worker needs the Access audience/issuer, not the Agent client secret ([Cloudflare connection contract](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#connect-your-service-to-access)).

## 7. Imperative Cloudflare alternative

Choose this only when issuance must be independent of a repository manifest and Alchemy deployment.

### API/client shape

Use the pinned Effect-native generated client rather than hand-built `fetch` calls:

- `createAccessServiceTokenForAccount`
- `rotateAccessServiceToken`
- list/get/update/delete token operations
- get/update reusable Access policy operations

These exact operations and request/response codecs exist in `@distilled.cloud/cloudflare@0.30.3`; create and rotate are the only calls that return `clientSecret` ([generated source](../../node_modules/@distilled.cloud/cloudflare/src/services/zero-trust.ts#L48358-L48464), [rotate source](../../node_modules/@distilled.cloud/cloudflare/src/services/zero-trust.ts#L48766-L48839)). Add `@distilled.cloud/cloudflare: "0.30.3"` as a direct dependency rather than relying on Alchemy's transitive dependency. Its first-party README supplies `CredentialsFromEnv` plus `FetchHttpClient.layer` for `CLOUDFLARE_API_TOKEN` ([SDK README](../../node_modules/@distilled.cloud/cloudflare/README.md)).

### Required ownership migration

1. Remove all imperative Agent tokens from `Cloudflare.Access.ServiceToken` declarations.
2. Make the CLI the sole writer of a dedicated reusable Agent policy and all its exact token selectors.
3. Configure Alchemy's Access application with that external policy ID, but do not declare the policy body as an Alchemy `Policy` resource.
4. Keep a non-secret registry containing Agent slug, stage, deterministic Cloudflare name, token ID, client ID/fingerprint, duration/expiry, logical version, destination reference, and status. The registry never stores a client secret.
5. Serialize policy updates with a stage lock. Read the current complete policy, compute the exact desired selector set from the registry/Cloudflare, PUT the full body, then re-read and verify. Cloudflare/Alchemy policy updates are whole-body operations, not safe append primitives.

Imperative create/rotate has a harsher failure mode: if Cloudflare succeeds and the sink fails, the one-time secret cannot be fetched later. Rotation must use a generous old-secret overlap, and the recovery is another rotation. Create failure after token creation should either complete delivery immediately from in-memory response or delete the unusable token and report metadata only.

Do not solve policy membership with `Any Access Service Token`, and do not let the CLI mutate the Alchemy-managed Application's complete `policies` array. Both trade simple issuance for an unsafe authorization/drift boundary.

## 8. Concrete first-version decisions

1. **Management model:** Alchemy-managed, complete manifest, dedicated stack.
2. **Identity granularity:** one token per named Agent per live stage; no shared production token.
3. **Policy:** one stage-local Service Auth policy enumerating exact token IDs.
4. **Duration:** retain the current `2160h` (90 days) initially, with an expiration alert and scheduled rotation before expiry; make duration explicit per manifest rather than relying on Cloudflare's one-year default.
5. **Rotation:** monotonic integer version and a conservative two-hour overlap; no overlap extension command on pinned beta.67.
6. **Delivery:** secret-manager/stdin adapter first; explicit mode-0600 file as the local fallback; no stdout.
7. **Stages:** explicit and exact; `production` is not interchangeable with `prod`, and local is never allowed.
8. **State:** treat Cloudflare Alchemy state as a secret store and forbid logged `alchemy state get` for credential resources.
9. **Break glass:** direct Cloudflare delete, followed immediately by desired-state removal; never rely on Access session revocation.
10. **Tests:** fake generated Cloudflare client/sink for create, idempotence, concurrent version bumps, sink failure, overlap cutoff, policy exactness, and no-secret logs; one live non-production create/rotate/smoke/revoke test.

## Primary sources

### Repository and pinned first-party source

- [`apps/api/alchemy.run.ts`](../../apps/api/alchemy.run.ts)
- [`alchemy@2.0.0-beta.67` ServiceToken provider](../../node_modules/alchemy/src/Cloudflare/Access/ServiceToken.ts)
- [`alchemy@2.0.0-beta.67` Policy provider](../../node_modules/alchemy/src/Cloudflare/Access/Policy.ts)
- [`alchemy@2.0.0-beta.67` Application provider](../../node_modules/alchemy/src/Cloudflare/Access/Application.ts)
- [Alchemy state encoding](../../node_modules/alchemy/src/State/StateEncoding.ts)
- [Alchemy Cloudflare state-store encryption](../../node_modules/alchemy/src/Cloudflare/StateStore/Store.ts)
- [Alchemy programmatic deploy](../../node_modules/alchemy/src/Deploy.ts)
- [Alchemy deploy command output](../../node_modules/alchemy/src/Cli/commands/deploy.ts)
- [Alchemy state-get command](../../node_modules/alchemy/src/Cli/commands/state.ts)
- [`@distilled.cloud/cloudflare@0.30.3` generated Zero Trust service](../../node_modules/@distilled.cloud/cloudflare/src/services/zero-trust.ts)
- [Effect `Redacted`](../../node_modules/effect/src/Redacted.ts)

### Cloudflare

- [Service tokens: create, use, renew, revoke](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Create service token API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/create/)
- [Rotate service token API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/rotate/)
- [Access policy actions, selectors, and evaluation](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Exact service-token Service Auth policy](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/#authenticate-a-service-using-a-service-token)
- [Cloudflare API-token creation and least privilege](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
