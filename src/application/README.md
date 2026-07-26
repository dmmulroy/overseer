# Application services

Application modules own caller-visible operations that coordinate policy and effects. They sit between inbound adapters and domain/persistence capabilities.

An application service may decide:

- which domain decisions run;
- which effects occur and in what order;
- where transactions begin and end;
- how expected dependency failures become application outcomes;
- which narrow persistence or integration capabilities an operation requires.

It must not know about HTTP requests, response codes, SQL statements, React, Cloudflare bindings, or provider SDK records.

## Current partition

- [`ulid-generator.ts`](ulid-generator.ts) owns the contextual clock and cryptographic entropy capability used by prefixed entity and request IDs.
- [`workspace-registry/`](workspace-registry/README.md) owns Workspace Registry policy, the Gateway-facing service interface, the object-local persistence seam, and the operation-specific private RPC contract.

## Effect conventions

Application modules use Effect services and Layers so dependencies remain visible in Effect requirements and propagate to composition roots. Constructors yield required services instead of accepting dependency bags or concrete adapters. Public and non-trivial operations use named `Effect.fn` values. Ports are declared beside the operation that needs them and use parsed domain/application values rather than adapter types.
