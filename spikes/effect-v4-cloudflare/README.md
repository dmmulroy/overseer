# Effect v4 Cloudflare compatibility spike

Throwaway integration fixture for Overseer's planning ticket **Validate Effect v4 on Workers and SQLite Durable Objects**. It is not product code.

The fixture pins Effect packages to `4.0.0-beta.98` and runs in Cloudflare's Vitest/workerd pool. Its black-box tests cover:

- an `HttpApi` Fetch handler routed through a Worker and Durable Object;
- declared, request-schema, unsupported-media-type, and route-not-found JSON errors;
- the `@effect/sql-sqlite-do` full-storage requirement;
- transaction commit, typed-failure rollback, and interruption rollback;
- Durable Object eviction/reconstruction with persisted SQLite state;
- an aborted first external request during deliberately delayed cold initialization.

Run:

```sh
npm install
npm run check
npm test
```
