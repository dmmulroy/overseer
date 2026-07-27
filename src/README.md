# Source architecture

`src/` is split by responsibility rather than by feature screen or transport route. Dependencies should point inward: infrastructure code wires adapters to application services; application services use domain values and application-owned ports; domain code knows nothing about HTTP, SQLite, React, Cloudflare, or Alchemy.

## Directory map

- [`domain/`](domain/README.md) defines Overseer values and invariants with Effect Schema.
- [`application/`](application/README.md) owns operation policy, effect ordering, ports, and typed success/error channels.
- [`adapters/`](adapters/README.md) translates browser, HTTP, RPC, SQLite, and provider behavior at system boundaries.
- [`contract/`](contract/README.md) is the shared public HTTP contract and response-schema source.
- [`infra/`](infra/README.md) contains the Alchemy v2 composition roots for deployed Workers and Durable Objects.
- [`browser/`](browser/README.md) boots React, owns URL navigation, and renders the application shell.
- [`ui/`](ui/README.md) contains reusable presentation concerns that do not own application policy.

## Request flow

A public request normally follows this path:

```text
Cloudflare Access
  -> Gateway infrastructure root
  -> Gateway HTTP adapter
  -> application-owned Workspace Registry service provided by the RPC adapter
  -> Workspace Registry Durable Object
  -> SQLite adapter
```

The browser consumes the same HTTP contract through generated Effect clients and atoms. It treats server data as a cached observation, never as authoritative state.

## Where code belongs

- Put intrinsic meaning and validation in `domain/`.
- Put operation policy and sequencing in `application/`.
- Put protocol, framework, database, and provider mechanics in `adapters/`.
- Put resource construction and layer wiring in `infra/`.
- Put wire schemas and public API response types in `contract/`.

Do not bypass these boundaries by passing raw requests, database rows, Cloudflare bindings, or provider failures into application or domain code.
