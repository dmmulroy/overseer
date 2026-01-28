#!/usr/bin/env node
/**
 * Postinstall script to ensure platform-specific binary is installed.
 *
 * npm's optionalDependencies may not install when users have `omit=optional`
 * in their npm config. This script detects that case and installs the
 * correct platform package.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { platform, arch, env } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const PLATFORMS = {
  "darwin-arm64": "@dmmulroy/overseer-darwin-arm64",
  "darwin-x64": "@dmmulroy/overseer-darwin-x64",
  "linux-arm64": "@dmmulroy/overseer-linux-arm64",
  "linux-x64": "@dmmulroy/overseer-linux-x64",
  "linux-arm64-musl": "@dmmulroy/overseer-linux-arm64-musl",
  "linux-x64-musl": "@dmmulroy/overseer-linux-x64-musl",
};

function isMusl() {
  if (platform !== "linux") return false;
  if (existsSync("/etc/alpine-release")) return true;
  try {
    return readFileSync("/proc/self/maps", "utf8").includes("musl");
  } catch {
    return false;
  }
}

function platformKey() {
  const cpuArch = arch === "arm64" ? "arm64" : "x64";
  const libc = isMusl() ? "-musl" : "";
  return `${platform}-${cpuArch}${libc}`;
}

function ensureInstalled() {
  // Allow opt-out for distros/offline environments
  if (env.OVERSEER_SKIP_POSTINSTALL === "1") return;

  const key = platformKey();
  const pkg = PLATFORMS[key];

  if (!pkg) {
    // Unsupported platform - bin/os will handle the error message
    return;
  }

  // Check if platform package is already installed
  try {
    require.resolve(`${pkg}/package.json`);
    return;
  } catch {
    // Platform package not found, try to install it
  }

  const pkgJson = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  );
  const version = pkgJson.version;
  const ua = env.npm_config_user_agent || "";
  const isNpm = ua.includes("npm/");

  if (!isNpm) {
    // Don't try to auto-install for pnpm/yarn - give clear instructions
    console.error(`\n⚠️  Platform package missing: ${pkg}`);
    console.error(`   Your package manager may be omitting optionalDependencies.`);
    console.error(`   Install manually: npm install -g ${pkg}@${version}\n`);
    process.exit(1);
  }

  console.log(`Installing platform package: ${pkg}@${version}`);

  try {
    execFileSync(
      platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--no-save",
        "--no-package-lock",
        "--silent",
        "--prefix",
        pkgRoot,
        `${pkg}@${version}`,
      ],
      { stdio: "inherit" }
    );
  } catch (err) {
    console.error(`\n⚠️  Failed to install platform package: ${pkg}`);
    console.error(`   Try installing manually: npm install -g ${pkg}@${version}`);
    console.error(`\n   If you have npm configured to omit optional deps, try:`);
    console.error(`     npm config set omit ""`);
    console.error(`   or reinstall with:`);
    console.error(`     npm install -g @dmmulroy/overseer --include=optional\n`);
    process.exit(1);
  }
}

ensureInstalled();
