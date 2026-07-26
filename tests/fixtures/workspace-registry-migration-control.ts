import { build } from "esbuild";
import { Miniflare } from "miniflare";

/** Start the raw migration-control object against one persisted namespace. */
export async function startWorkspaceRegistryMigrationControl(
  durableObjectsPersist: string,
): Promise<Miniflare> {
  const bundle = await build({
    entryPoints: ["tests/fixtures/workspace-registry-migration-control-worker.ts"],
    bundle: true,
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:workers"],
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const output = bundle.outputFiles[0];
  if (output === undefined) {
    throw new Error("Workspace Registry migration-control bundle was not produced");
  }

  return new Miniflare({
    compatibilityDate: "2026-07-19",
    modules: [
      {
        type: "ESModule",
        path: "migration-control.js",
        contents: output.text,
      },
    ],
    durableObjects: {
      WorkspaceRegistryObject: {
        className: "WorkspaceRegistryObject",
        useSQLite: true,
      },
    },
    durableObjectsPersist,
  });
}
