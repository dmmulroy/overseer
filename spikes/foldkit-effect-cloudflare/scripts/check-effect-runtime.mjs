import { readFile } from "node:fs/promises";

const parseJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const manifest = await parseJson(new URL("../package.json", import.meta.url));
const lock = await parseJson(new URL("../package-lock.json", import.meta.url));
const modelSource = await readFile(
  new URL("../src/frontend/project-state.ts", import.meta.url),
  "utf8",
);

const expected = Object.freeze({
  effect: "4.0.0-beta.97",
  foldkit: "0.128.1",
  "@foldkit/ui": "0.128.1",
  "@effect/platform-browser": "4.0.0-beta.97",
  "@effect/platform-node": "4.0.0-beta.97",
  "@effect/platform-node-shared": "4.0.0-beta.97",
  "@effect/sql-sqlite-do": "4.0.0-beta.97",
  alchemy: "2.0.0-beta.62",
});

for (const [name, version] of Object.entries(expected)) {
  if (manifest.dependencies[name] !== version) {
    throw new Error(`${name} is not pinned to ${version}.`);
  }
  const installed = await parseJson(
    new URL(`../node_modules/${name}/package.json`, import.meta.url),
  );
  if (installed.version !== version) {
    throw new Error(`${name} resolved to ${installed.version}, expected ${version}.`);
  }
}

const effectInstallations = Object.entries(lock.packages)
  .filter(([path]) => path.endsWith("node_modules/effect"))
  .map(([path, value]) => ({ path, version: value.version }));
if (
  effectInstallations.length !== 1
  || effectInstallations[0]?.version !== expected.effect
) {
  throw new Error(`Expected one Effect runtime: ${JSON.stringify(effectInstallations)}`);
}

const [effectModule, alchemyCloudflareModule] = await Promise.all([
  import("effect"),
  import("alchemy/Cloudflare"),
]);
if (
  typeof effectModule.Effect !== "object"
  || typeof alchemyCloudflareModule.Worker !== "function"
  || typeof alchemyCloudflareModule.DurableObject !== "function"
) {
  throw new Error("One or more pinned package entrypoints failed their runtime shape check.");
}

const forbiddenModelTypes = /\b(?:WebSocket|Request|Response|HttpClient|HttpApi)\b/g;
const leakedTypes = modelSource.match(forbiddenModelTypes) ?? [];
if (leakedTypes.length > 0) {
  throw new Error(`Transport types leaked into ProjectModel: ${leakedTypes.join(", ")}`);
}

console.log(JSON.stringify({
  packages: expected,
  effectInstallations,
  projectModelTransportTypes: leakedTypes,
}, null, 2));
