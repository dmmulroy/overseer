# Workspace Registry application

This module owns Workspace operation policy and the application interfaces on both sides of the private Durable Object seam.

## Main modules

### `workspace-registry.ts`

Defines:

- `WorkspaceRegistryService`, the application-owned interface consumed by Gateway HTTP handlers;
- `WorkspaceRegistryLocalService`, `make`, and `layer` for object-local list, read, create, and rename policy;
- `WorkspaceRegistryStateService`, the cohesive transactional persistence service;
- the shared `UlidGeneratorService` used to allocate Workspace IDs;
- operation inputs, successful results, and detailed object-local persistence failures.

The constructor yields persistence and ULID services from Effect context. Time comes from Effect's Clock through `DateTime.now`; there is no custom clock port. Creation fingerprints application input, and one SQLite transaction stores the Workspace and replay record.

### `workspace-registry-rpc.ts`

Defines four operation-specific Alchemy schemaless RPC methods:

- `listWorkspaces`
- `readWorkspace`
- `createWorkspace`
- `renameWorkspace`

Each method has a plain structured-clone-safe input, success result, and precise typed error channel. There is no generic read/command dispatcher and no cross-operation outcome union. Expected failures cross as safe tagged records. Because schemaless RPC strips prototypes, callers use `_tag` and `Effect.catchTag`, never `instanceof`.

The file also owns `WORKSPACE_REGISTRY_SINGLETON_NAME`, the sole name used to resolve the singleton object, and `WorkspaceRegistryRpcCallFailed`, the Gateway's explicit representation of Alchemy `RpcCallError`.

## Ownership

The object-local application constructor owns operation order, timestamps, ID allocation, and replay/conflict policy. The SQLite Layer owns SQL and persisted-row parsing. The Durable Object boundary logs classified persistence details and replaces local errors that carry causes with safe remote tags. The Gateway RPC adapter directly provides `WorkspaceRegistryService`; there is no forwarding application Layer between RPC and HTTP.
