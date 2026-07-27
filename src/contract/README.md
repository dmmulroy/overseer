# Public contract

This directory is the single source for Overseer's public HTTP protocol. Gateway handlers and generated browser clients both depend on it, which keeps request parsing, response decoding, OpenAPI, and browser types aligned.

## Main modules

### `http-api.ts`

Defines the Effect HTTP API:

- stable paths and media types;
- request, response, header, path, and query schemas;
- Workspace response bodies and collection links;
- stable problem codes and RFC 9457 problem documents;
- endpoint groups and Cloudflare Access middleware metadata;
- the top-level `OverseerApi` contract.

### `api-discovery.ts`

Builds discovery documents and the schema index from the contract.

### `request-schemas.ts`

Derives published JSON Schema documents and content-addressed paths from the request contracts using canonical recursive key ordering and SHA-256.

### `openapi.ts`

Derives the OpenAPI document from `OverseerApi`. Do not maintain a separate handwritten API description.

## Rules

Contract schemas describe encoded public values. Domain schemas should be reused where wire and domain meaning are truly identical; explicit API response types belong in adapters when names or meanings differ. Adding an endpoint requires updating this contract and then implementing its adapter handler, rather than introducing an undeclared route.
