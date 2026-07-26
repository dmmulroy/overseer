# Gateway adapter

This directory is Overseer's public HTTP boundary. It authenticates requests, parses protocol input, invokes application services, and renders representations or safe RFC 9457 problems. It also contains the outbound Workspace Registry Durable Object adapter.

## Request path

`gateway-application.ts` builds the isolate-level application and performs request admission:

1. verify the Cloudflare Access assertion;
2. enforce human Origin or parse Agent-session metadata for unsafe requests;
3. provide request ID through `GatewayRequestContext`;
4. invoke the declared HTTP handler;
5. translate schema failures and defects into safe responses.

## Important modules

- `access-principal.ts` verifies Access JWTs and parses `AuthenticatedPrincipal`.
- `gateway-configuration.ts` parses deploy-time and runtime configuration.
- `request-context.ts` parses mutation metadata after authentication.
- `gateway-http.ts` builds the Effect HTTP API router and common routing behavior.
- `workspace-http.ts` and `project-http.ts` map typed `WorkspaceRegistryService` successes and failures to REST and RFC 9457.
- `representation-response.ts` owns media negotiation, strong ETags, HEAD, and 304 responses.
- `problem-response.ts` maps stable problem codes to statuses and safe documents.
- `workspace-registry-rpc-client.ts` confines the Alchemy namespace and stub, obtains the singleton by `WORKSPACE_REGISTRY_SINGLETON_NAME`, and directly provides `WorkspaceRegistryService`.

The RPC adapter calls the operation-specific Workspace and Project registry list, read, create, and rename methods directly. Create keys are owned by the authoritative Durable Object: first successful use wins, replay resolves the entity's current representation, and a key recorded for the other result type conflicts. Replays ignore body, authenticated principal, and Project target changes. Expected remote failures stay in Effect's typed error channel and retain their operation-specific tags. The adapter separately widens Alchemy's static stub type to include the runtime `RpcCallError`, logs it safely, and maps it to `WorkspaceRegistryRpcCallFailed`. Schemaless remote errors are matched by tag, never by prototype.

## Boundary rules

Keep HTTP handlers thin: parse, call, and render. HTTP paths, headers, status codes, namespaces, stubs, and Cloudflare types stay here or in infrastructure composition roots. Application policy, persistence, and domain invariants belong elsewhere.
