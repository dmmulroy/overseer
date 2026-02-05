#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");

const platform = os.platform();
const arch = os.arch();

const binName = (() => {
  if (platform === "win32" && arch === "x64") return "os-win32-x64.exe";
  if (platform === "linux" && arch === "x64") return "os-linux-x64";
  if (platform === "linux" && arch === "arm64") return "os-linux-arm64";
  if (platform === "darwin" && arch === "x64") return "os-darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "os-darwin-arm64";
  return null;
})();

if (!binName) {
  console.error(`unsupported platform: ${platform} ${arch}`);
  process.exit(1);
}

const binPath = path.join(__dirname, "bin", binName);
const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
