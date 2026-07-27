# Workspace Registry application

This module owns Workspace and Project registry operation policy and the application interfaces on both sides of the private Durable Object seam.

## Main modules

### `workspace-registry.ts`

Defines:

- `WorkspaceRegistryService`, the application-owned interface consumed by Gateway HTTP handlers;
- `WorkspaceRegistryLocalService`, `make`, and `layer` for object-local Workspace and Project list, read, create, and rename policy;
- `WorkspaceRegistryStateService`, the cohesive transactional persistence service;
- the shared `UlidGeneratorService` used to allocate Workspace and Project IDs;
- operation inputs, successful results, and detailed object-local persistence failures.

The constructor yields persistence and ULID services from Effect context. Time comes from Effect's Clock through `DateTime.now`; there is no custom clock port. Each create performs one key lookup. First successful use stores the Workspace or Project and its key in one SQLite transaction; replay resolves and returns that entity's current state. A key recorded for the other result type conflicts.

### `workspace-registry-rpc.ts`

Defines eight operation-specific Alchemy schemaless RPC methods:

- `listWorkspaces`
- `readWorkspace`
- `createWorkspace`
- `renameWorkspace`
- `listProjects`
- `readProject`
- `createProject`
- `renameProject`

Each method has a plain structured-clone-safe input, success result, and precise typed error channel. There is no generic read/command dispatcher and no cross-operation outcome union. Expected failures cross as safe tagged records. Because schemaless RPC strips prototypes, callers use `_tag` and `Effect.catchTag`, never `instanceof`.

The file also owns `WORKSPACE_REGISTRY_SINGLETON_NAME`, the sole name used to resolve the singleton object, and `WorkspaceRegistryRpcCallFailed`, the Gateway's explicit typed form of Alchemy `RpcCallError`.

## Ownership

The object-local application constructor owns operation order, timestamps, ID allocation, and first-successful-key-use replay/conflict policy. The SQLite Layer owns SQL, key-to-entity references, and persisted-row parsing. The Durable Object boundary logs classified persistence details and replaces local errors that carry causes with safe remote tags. The Gateway RPC adapter directly provides `WorkspaceRegistryService`; there is no forwarding application Layer between RPC and HTTP.
