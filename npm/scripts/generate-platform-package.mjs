#!/usr/bin/env node
/**
 * Generate platform-specific package.json
 * Usage: node generate-platform-package.mjs <platform> <version>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const platform = process.argv[2];
const version = process.argv[3];

if (!platform || !version) {
  console.error("Usage: node generate-platform-package.mjs <platform> <version>");
  console.error("Example: node generate-platform-package.mjs darwin-arm64 0.1.0");
  process.exit(1);
}

const platforms = JSON.parse(
  readFileSync(join(__dirname, "platforms.json"), "utf8")
);

const config = platforms[platform];
if (!config) {
  console.error(`Unknown platform: ${platform}`);
  console.error(`Available: ${Object.keys(platforms).join(", ")}`);
  process.exit(1);
}

const pkgDir = join(__dirname, "..", `overseer-${platform}`);
mkdirSync(pkgDir, { recursive: true });

const pkg = {
  name: `@dmmulroy/overseer-${platform}`,
  version,
  description: `Overseer CLI binary for ${platform}`,
  files: ["os", "postinstall.js"],
  scripts: {
    postinstall: "node postinstall.js",
  },
  os: [config.os],
  cpu: [config.cpu],
  ...(config.libc && { libc: [config.libc] }),
  preferUnplugged: true,
  publishConfig: {
    access: "public",
    provenance: true,
  },
  repository: {
    type: "git",
    url: "git+https://github.com/dmmulroy/overseer.git",
  },
  license: "MIT",
};

// Generate postinstall script to set executable permission
const postinstallScript = `#!/usr/bin/env node
const { chmodSync } = require("node:fs");
const { join } = require("node:path");

try {
  chmodSync(join(__dirname, "os"), 0o755);
} catch {
  // Ignore errors (e.g., Windows)
}
`;

writeFileSync(join(pkgDir, "postinstall.js"), postinstallScript);

const pkgPath = join(pkgDir, "package.json");
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Generated: ${pkgPath}`);
