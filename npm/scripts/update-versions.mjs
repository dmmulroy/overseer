#!/usr/bin/env node
/**
 * Update version across all npm packages
 * Usage: node update-versions.mjs <version>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const version = process.argv[2];
if (!version) {
  console.error("Usage: node update-versions.mjs <version>");
  console.error("Example: node update-versions.mjs 0.2.0");
  process.exit(1);
}

// Validate semver
try {
  execSync(`npx --yes semver ${version}`, { stdio: "pipe" });
} catch {
  console.error(`Invalid semver: ${version}`);
  process.exit(1);
}

const platforms = JSON.parse(
  readFileSync(join(__dirname, "platforms.json"), "utf8")
);

// All packages to update
const packages = [
  join(__dirname, "..", "..", "host", "package.json"),
  join(__dirname, "..", "overseer", "package.json"),
  ...Object.keys(platforms).map((p) =>
    join(__dirname, "..", `overseer-${p}`, "package.json")
  ),
];

let updated = 0;

for (const pkgPath of packages) {
  if (!existsSync(pkgPath)) {
    console.warn(`Skipping (not found): ${pkgPath}`);
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = version;

  // Update optionalDependencies in main package
  if (pkg.optionalDependencies) {
    for (const dep of Object.keys(pkg.optionalDependencies)) {
      if (dep.startsWith("@dmmulroy/overseer-")) {
        pkg.optionalDependencies[dep] = version;
      }
    }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`Updated: ${pkgPath}`);
  updated++;
}

console.log(`\nUpdated ${updated} package(s) to version ${version}`);
