# Web client adapter

This directory turns Overseer's public HTTP contract into reactive browser resources for React. It is an outbound adapter: browser components consume atoms and parsed browser representations rather than constructing requests or decoding responses themselves.

## Main module

[`api-resources.ts`](api-resources.ts) defines:

- `OverseerHttpClient`, the generated `AtomHttpApi.Service` for `OverseerApi`;
- `discoveryQuery`, the conditionally validated API-discovery resource;
- `workspaceQuery`, the complete browser-owned Workspace collection resource;
- `DiscoveryResource` and `WorkspaceResource`, which retain validated browser representations;
- `BrowserResourceReadFailed`, the typed browser-boundary failure used by stale and unavailable UI states.

Each exact URL retains its representation, strong ETag, and validation time. Refreshes send `If-None-Match`; a `304` advances validation time without replacing the representation or ETag. Retryable reads use cancellation-safe 5, 15, 30, then 60 second delays and honor longer `Retry-After` advice.

`workspaceQuery` validates the origin, path, and query of each `links.next`, rejects repeated cursors, and assembles exact HTTP pages into a distinct browser-owned collection. `Atom.swr` keeps the previous successful value visible while a refresh runs or fails.

## Boundary rules

- Decode all server responses through the shared HTTP contract.
- Parse and constrain navigation links before following them.
- Keep network, conditional validation, and retry mechanics here, not in React components.
- Do not make browser caches authoritative; the server remains the source of truth.
- Keep secrets and authentication mechanics outside component props and rendered errors.
