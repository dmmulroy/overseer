# Effect service and Layer audit

## Scope

This audit covers the current `Context.Service`, constructors, Layers, and runtime wiring under `src/`, plus the fixtures that assemble them. It follows `AGENTS.md`, the coding-standards skill's Effect references, Effect's service/layer examples, and Alchemy's Worker and Durable Object bridges.

## Result

The dependency graph now uses yielded Effect services at each real seam. Constructors and canonical Layers are colocated with their services, and runtime roots provide concrete adapters without passing dependency bags through request handlers.

| Capability            | Constructor and Layer                                 | Requirements                                    | Lifetime                                               |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| ULID allocation       | `UlidGeneratorService`, `make`, `layer`               | `Crypto.Crypto`; Effect Clock is read by `next` | service per runtime; time per call                     |
| Gateway configuration | `GatewayConfiguration`, `make`, `layer`               | Effect `ConfigProvider`                         | once per Worker initialization                         |
| Access verification   | `AccessAssertionVerifier`, `make`, `layer`            | `GatewayConfiguration`                          | remote JWK cache once per Worker initialization        |
| Problem responses     | `ProblemResponse`, `make`, `layer`                    | `ProblemTypeBaseUrl`                            | once per Worker initialization                         |
| Gateway HTTP API      | `GatewayApi`, `make`, `layer`                         | Crypto, problem responses, Workspace Registry   | router once; request Effect per call                   |
| Gateway application   | `GatewayApplication`, `make`, `layer`                 | configuration, verifier, API, problems, ULIDs   | application once; request data per call                |
| Object-local registry | `WorkspaceRegistryLocalService`, `make`, `layer`      | registry state, ULIDs                           | once per Durable Object activation                     |
| SQLite registry state | `workspace-registry-sqlite-state.ts`: `make`, `layer` | object-local `SqlClient`                        | once per Durable Object activation                     |
| Gateway registry RPC  | `workspace-registry-rpc-client.ts`: `make`, `layer`   | hosted Alchemy namespace                        | once per Worker initialization; stub selected per call |

The adapter files currently export plain `make` and `layer` names rather than module namespace objects; callers disambiguate them at direct imports. This matches the repository's present import style and avoids a new barrel or wrapper abstraction.

## Findings closed

### One contextual ULID capability

`UlidGeneratorService` is the only random identity capability. Workspace IDs and request IDs wrap the generated domain `Ulid`; there is no separate Workspace-ID generator and no `crypto.randomUUID()` path.

The production constructor yields Effect's `Crypto` service. `randomBytes(10)` uses the fixed ULID entropy width. Effect's standard Crypto implementations can reject `randomBytes` only when the size argument is invalid, so that impossible rejection is converted to a defect rather than widening every identity operation with an unusable error case. Runtime roots provide `@effect/platform-browser/BrowserCrypto`, which is backed by the Web Crypto API available in workerd.

### Gateway dependencies and lifetimes

The Gateway no longer accepts service values, Layers, or configuration Effects as constructor arguments. Each constructor yields its requirements.

`GatewayApi.make` builds the declared `HttpRouter` once during Layer acquisition. Its `handle` method reuses that router and supplies only request-scoped services for each call. Access key discovery, runtime configuration, Durable Object namespace acquisition, and router assembly do not occur per request.

`GatewayRequestContext` remains a request-scoped service supplied after authentication. It intentionally has no global or test Layer.

### Response hashing

`finalizeApiResponse` yields Effect's `Crypto` service and uses `digest("SHA-256", ...)`. A platform digest failure is logged with safe request context and rendered as the standard internal problem. The adapter no longer calls ambient `crypto.subtle` through a raw Promise.

### Configuration and Access

`GatewayConfiguration.make` reads the Access audience, issuer, allowed origin, and problem type base through Effect Config during Worker initialization. `AccessAssertionVerifier.make` yields that service and closes over audience and issuer, so `verify` accepts only the redacted assertion.

Tests that do not exercise environment decoding provide a parsed `GatewayConfiguration` service directly. Runtime configuration tests still parse untrusted binding values at the raw Worker boundary.

### Workspace Registry services

The object-local policy is a named `WorkspaceRegistryLocalService` with colocated `make` and `layer`. It yields `WorkspaceRegistryStateService` and `UlidGeneratorService`; Effect Clock remains contextual inside operations.

The Gateway-facing `WorkspaceRegistryService` stays a separate application-owned port. The Alchemy RPC adapter directly implements it. There is no forwarding application Layer between RPC and HTTP.

### Migration ordering

The Durable Object constructor acquires both the migration Layer and the registry service before returning any RPC method. Layer acquisition must finish before the service value is yielded, so migrations complete before callers can invoke registry methods. The production Alchemy workerd tests cover concurrent first calls, failed initialization, repair, retry, and reconstruction.

### Test Layers

Focused identity and Workspace Registry tests provide small complete service values locally for only the behavior they exercise. No reusable test Layer is exported because there is no second caller. SQL parsing, transactions, migrations, and reconstruction continue to use SQLite/workerd fixtures rather than a misleading in-memory persistence implementation.

## Boundaries retained

- `WorkspaceRegistryStateService` belongs to the application module; its SQLite implementation belongs to the SQLite adapter.
- `WorkspaceRegistryService` belongs to the application module; its Alchemy namespace implementation belongs to the Gateway adapter.
- `Cloudflare.DurableObjectState` and `state.raw.storage` appear only in the infrastructure composition root.
- Alchemy's nested Durable Object constructor remains intact.
- React props, URL values, Miniflare fixture options, and pure domain constructor inputs remain ordinary values rather than Effect services.
- Explicit GET and HEAD endpoints remain in the HTTP contract because Effect HttpApi requires both declarations. Shared response finalization prevents their behavior from drifting.

## Remaining interop exception

Alchemy beta.64's schemaless stub method types still omit the runtime `RpcCallError` channel. `withRpcCallError` contains one narrow type widening with a safety comment, then the adapter maps that transport failure into `WorkspaceRegistryRpcCallFailed`. No operation-specific overload layer remains.
