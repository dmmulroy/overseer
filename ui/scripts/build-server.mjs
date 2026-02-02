#!/usr/bin/env node
/**
 * Build Hono API server for production bundling.
 * 
 * Bundles src/api/index.ts -> dist-server/server.js
 * Externalizes runtime dependencies (@hono/node-server, better-result)
 */
import * as esbuild from "esbuild";
import { rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outDir = join(rootDir, "dist-server");

// Clean output directory
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(rootDir, "src/api/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: join(outDir, "server.js"),
  
  // Bundle all dependencies into single file
  // Only externalize node builtins
  external: [],
  
  // Keep node: protocol imports external (builtins only)
  packages: "bundle",
  
  // Source maps for debugging
  sourcemap: true,
  
  // Minify for smaller bundle
  minify: true,
  
  // Banner for ESM compatibility
  banner: {
    js: "// Overseer UI Server - Bundled with esbuild",
  },
});

console.log("Built dist-server/server.js");
