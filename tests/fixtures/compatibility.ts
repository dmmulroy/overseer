import { build } from "esbuild";
import { Miniflare } from "miniflare";

/** Start the pinned Effect/Cloudflare compatibility fixture in workerd. */
export async function startCompatibilityFixture(): Promise<Miniflare> {
  const bundle = await build({
    entryPoints: ["tests/fixtures/effect-cloudflare/worker.ts"],
    bundle: true,
    conditions: ["workerd", "worker", "browser"],
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const output = bundle.outputFiles[0];
  if (output === undefined) {
    throw new Error("Compatibility fixture bundle was not produced");
  }
  return new Miniflare({
    compatibilityDate: "2026-07-19",
    modules: [{ type: "ESModule", path: "worker.js", contents: output.text }],
    durableObjects: {
      ABORTING: { className: "AbortingCompatibilityObject", useSQLite: true },
      COMPATIBILITY: { className: "CompatibilityObject", useSQLite: true },
    },
  });
}
