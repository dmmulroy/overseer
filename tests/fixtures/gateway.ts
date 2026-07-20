import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { build as buildVite } from "vite";

/** Configuration supplied to the Gateway fixture. */
export type GatewayFixtureConfig = {
  readonly accessAudience: string;
  readonly accessIssuer: string;
  readonly accessJwks: string;
  readonly allowedOrigin: string;
  readonly assetsDirectory?: string;
};

/** Start the production Gateway bundle in workerd. */
export async function startGateway(config: GatewayFixtureConfig): Promise<Miniflare> {
  if (config.assetsDirectory !== undefined) {
    await buildVite({ logLevel: "silent" });
  }
  const bundle = await build({
    entryPoints: ["tests/fixtures/gateway-worker.ts"],
    bundle: true,
    conditions: ["workerd", "worker", "browser"],
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const output = bundle.outputFiles[0];
  if (output === undefined) {
    throw new Error("Gateway bundle was not produced");
  }

  return new Miniflare({
    compatibilityDate: "2026-07-19",
    modules: [{ type: "ESModule", path: "gateway.js", contents: output.text }],
    outboundService: (request: Request) => {
      const url = new URL(request.url);
      if (
        request.method === "GET" &&
        url.origin === config.accessIssuer &&
        url.pathname === "/cdn-cgi/access/certs"
      ) {
        return new Response(config.accessJwks, {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
    ...(config.assetsDirectory === undefined
      ? {}
      : {
          assets: {
            directory: config.assetsDirectory,
            binding: "ASSETS",
            routerConfig: {
              has_user_worker: true,
              invoke_user_worker_ahead_of_assets: true,
            },
            assetConfig: { not_found_handling: "single-page-application" as const },
          },
        }),
    bindings: {
      ACCESS_AUDIENCE: config.accessAudience,
      ACCESS_ISSUER: config.accessIssuer,
      ALLOWED_ORIGIN: config.allowedOrigin,
    },
  });
}
