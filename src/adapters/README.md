# Adapters

Adapters own Overseer's external boundaries. They translate framework and provider values into parsed application/domain values, and translate typed application outcomes back into the protocol expected by the caller.

## Partitions

- [`gateway/`](gateway/README.md) is the inbound public HTTP adapter plus the outbound Workspace Registry Durable Object client.
- [`workspace-registry-sqlite/`](workspace-registry-sqlite/README.md) implements Workspace Registry persistence with SQLite.
- [`web-client/`](web-client/README.md) adapts the public HTTP API into reactive browser resources.

## Rules

Adapters may know about HTTP, React atoms, Cloudflare, SQLite, and provider-specific errors. Application and domain modules must not.

An adapter should:

1. parse untrusted boundary input;
2. call an application service through domain/application types;
3. classify external failures into precise typed failures;
4. render the result in the external protocol;
5. retain enough safe diagnostic context to debug failures.

Adapters do not decide business eligibility or invent domain state transitions. When an adapter needs application policy, that policy belongs in an application service and the adapter should call it.
