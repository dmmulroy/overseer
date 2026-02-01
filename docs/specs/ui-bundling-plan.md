# UI Bundling Plan

Bundle the UI webapp into `@dmmulroy/overseer` so `os ui` works without cloning repo.

## Current State

**MCP bundling (working):**
```
npm/overseer/
├── bin/os              # Entry: routes `os mcp` → dist/index.js
├── dist/               # Compiled MCP server (tsc output from mcp/build/)
└── package.json        # optionalDeps for platform binaries
```

**UI (dev-only):**
```
ui/
├── src/api/            # Hono API server (tsx watch)
├── src/client/         # React SPA (vite dev)
├── dist/               # Vite build output (static files)
└── package.json        # dev dependencies
```

## Target Architecture

```
npm/overseer/
├── bin/os              # Add: `os ui` → spawns node dist/ui/server.js
├── dist/
│   ├── index.js        # MCP server (existing)
│   └── ui/
│       ├── server.js   # Bundled Hono server
│       └── static/     # Vite-built SPA assets
└── package.json
```

## Tasks

### 1. Bundle Hono API server

**Problem:** `ui/src/api/` uses tsx (needs ts compilation).

**Solution:** Use esbuild to bundle API into single file.

```bash
cd ui
esbuild src/api/index.ts --bundle --platform=node --outfile=dist-server/server.js \
  --external:@hono/node-server --external:better-result
```

**Files:**
- Add `ui/esbuild.config.mjs` for server bundling
- Modify `ui/package.json` scripts

### 2. Configure Hono to serve static files in production

**Problem:** In dev, Vite serves static; in prod, Hono must serve them.

**Modify:** `ui/src/api/app.ts`
```ts
import { serveStatic } from "@hono/node-server/serve-static";

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./static" }));
}
```

### 3. Add `os ui` command to bin/os

**Modify:** `npm/overseer/bin/os`
```js
if (command === "ui") {
  const port = args[1] || process.env.PORT || "6969";
  process.env.PORT = port;
  process.env.NODE_ENV = "production";
  process.env.OVERSEER_CLI_PATH = getBinaryPath();
  
  const serverPath = join(__dirname, "..", "dist", "ui", "server.js");
  import(serverPath);
}
```

### 4. Build script for npm package

**Add:** `npm/scripts/build-ui.mjs`
```js
// 1. Run vite build (outputs to ui/dist/)
// 2. Run esbuild (outputs to ui/dist-server/)
// 3. Copy to npm/overseer/dist/ui/
//    - dist-server/server.js → dist/ui/server.js
//    - dist/* → dist/ui/static/
```

### 5. Update npm package.json

**Modify:** `npm/overseer/package.json`
```json
{
  "files": ["bin/", "dist/"],
  "dependencies": {
    "@hono/node-server": "^1.19.9",
    "better-result": "^2.7.0",
    ...existing
  }
}
```

### 6. CI/CD updates

**Modify:** GitHub Actions workflow to:
1. Build Rust CLI (existing)
2. Build MCP (existing)  
3. Build UI: `cd ui && npm run build:prod`
4. Assemble npm package

## File Changes Summary

| Action | File |
|--------|------|
| Create | `ui/esbuild.config.mjs` |
| Modify | `ui/package.json` (add build:prod script) |
| Modify | `ui/src/api/app.ts` (serve static in prod) |
| Modify | `npm/overseer/bin/os` (add ui command) |
| Modify | `npm/overseer/package.json` (add hono dep) |
| Create | `npm/scripts/build-ui.mjs` |
| Modify | `.github/workflows/release.yml` (add ui build) |

## Dependencies

npm/overseer needs (for UI runtime):
- `@hono/node-server` - HTTP server
- `better-result` - Already dep of MCP, shared
- `hono` - Already bundled into server.js

## Questions

1. **Should `os ui` open browser automatically?** 
   - Could use `open` package, but adds dep
   - Alternative: just print URL

2. **Port configuration?**
   - `os ui` → default 6969
   - `os ui 8080` → custom port
   - `PORT=8080 os ui` → env override

3. **Static file path resolution?**
   - Use `import.meta.url` to find dist/ui/static relative to server.js
   - Or embed path at build time

4. **Dev vs prod parity?**
   - Dev: Vite HMR + API proxy
   - Prod: Hono serves all
   - Need to test both flows work identically
