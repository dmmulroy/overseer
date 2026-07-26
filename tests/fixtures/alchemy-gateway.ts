import { rm } from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { WorkerBundle } from "../../node_modules/alchemy/lib/Cloudflare/Workers/WorkerBundle.js";
import type { DurableObjectExport } from "alchemy/Cloudflare/Workers";
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { HttpApiSchemaError } from "effect/unstable/httpapi/HttpApiError";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { Miniflare } from "miniflare";
import { AccessAssertionVerifier } from "../../src/adapters/gateway/access-principal.ts";
import {
  AccessAudience,
  ExactOrigin,
  GatewayConfiguration,
  HttpsOrigin,
} from "../../src/adapters/gateway/gateway-configuration.ts";
import {
  GatewayApplication,
  layer as gatewayApplicationLayer,
} from "../../src/adapters/gateway/gateway-application.ts";
import { GatewayApi } from "../../src/adapters/gateway/gateway-http.ts";
import { layer as problemResponseLayer } from "../../src/adapters/gateway/problem-response.ts";
import { layer as ulidGeneratorLayer } from "../../src/application/ulid-generator.ts";
import { AuthenticatedPrincipal, EmailAddress, HumanPrincipalId } from "../../src/domain/actor.ts";

/** Failure modes exercised through the real Gateway application ingress. */
export type GatewayIngressFixtureMode =
  | "success"
  | "response_body_encoding_failure"
  | "unexpected_defect";

/** Build a local Web handler that crosses the real Gateway application ingress. */
export function makeGatewayIngressTestHandler(mode: GatewayIngressFixtureMode): Promise<{
  readonly dispose: () => Promise<void>;
  readonly handle: (request: Request) => Promise<Response>;
}> {
  const configuration = GatewayConfiguration.of({
    accessAudience: AccessAudience.make("test-audience"),
    accessIssuer: HttpsOrigin.make(new URL("https://test.cloudflareaccess.com")),
    allowedOrigin: ExactOrigin.make(new URL("https://overseer.test")),
    problemTypeBaseUrl: new URL("https://overseer.test/problems/"),
  });
  const ConfigurationLive = Layer.succeed(GatewayConfiguration, configuration);
  const ProblemsLive = problemResponseLayer.pipe(Layer.provide(ConfigurationLive));
  const VerifierLive = Layer.succeed(
    AccessAssertionVerifier,
    AccessAssertionVerifier.of({
      verify: () =>
        Effect.succeed(
          AuthenticatedPrincipal.cases.HumanPrincipal.make({
            subject: HumanPrincipalId.make("fixture-human"),
            email: EmailAddress.make("fixture@example.com"),
          }),
        ),
    }),
  );
  const ApiLive = Layer.succeed(
    GatewayApi,
    GatewayApi.of({
      handle: () => {
        if (mode === "success") {
          return Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true }));
        }
        if (mode === "unexpected_defect") {
          return Effect.die(new Error("Sensitive unexpected defect fixture"));
        }
        return Effect.die(
          new HttpApiSchemaError({
            kind: "Body",
            cause: new Schema.SchemaError(
              new SchemaIssue.InvalidValue(Option.some({ ok: true }), {
                message: "Fixture response does not match its contract",
              }),
            ),
          }),
        );
      },
    }),
  );
  const runtime = ManagedRuntime.make(
    gatewayApplicationLayer.pipe(
      Layer.provide([ConfigurationLive, VerifierLive, ApiLive, ProblemsLive, ulidGeneratorLayer]),
      Layer.provide(BrowserCrypto.layer),
    ),
  );

  return runtime.runPromise(GatewayApplication).then((gateway) => ({
    dispose: () => runtime.dispose(),
    handle: HttpEffect.toWebHandler(gateway.fetch),
  }));
}

/** Runtime values supplied to the production Alchemy Gateway fixture. */
export type AlchemyGatewayFixtureConfig = {
  readonly accessAudience: string;
  readonly accessIssuer: string;
  readonly accessJwks: string;
  readonly allowedOrigin: string;
  readonly durableObjectsPersist: string | boolean;
};

/** Start the actual Alchemy Worker and Durable Object bridges in workerd. */
export async function startAlchemyGateway(config: AlchemyGatewayFixtureConfig): Promise<Miniflare> {
  const bundleDirectory = ".alchemy/bundles/overseer-runtime-test";
  const bundle = await Effect.runPromise(
    Effect.gen(function* () {
      const workers = yield* WorkerBundle;
      return yield* workers.build({
        id: "overseer-runtime-test",
        main: new URL("../../src/infra/gateway.ts", import.meta.url).href,
        compatibility: {
          date: "2026-07-19",
          flags: ["nodejs_compat"],
        },
        entry: {
          kind: "effect",
          exports: {
            // SAFETY: WorkerBundle's virtual-entry generator reads only `kind` and the export key here. The production Gateway layer resolves the real registered constructor at runtime.
            WorkspaceRegistryObject: {
              kind: "durableObject",
            } as DurableObjectExport,
          },
        },
        stack: {
          name: "OverseerAlchemyRuntimeTest",
          stage: "test",
        },
        extraOptions: undefined,
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  const modules = bundle.files.flatMap((file) =>
    file.path.endsWith(".js")
      ? [
          {
            type: "ESModule" as const,
            path: file.path,
            contents:
              typeof file.content === "string"
                ? file.content
                : new TextDecoder().decode(file.content),
          },
        ]
      : [],
  );
  if (modules.length === 0) {
    throw new Error("Alchemy Gateway bundle was not produced");
  }
  await rm(bundleDirectory, { force: true, recursive: true });

  return new Miniflare({
    compatibilityDate: "2026-07-19",
    compatibilityFlags: ["nodejs_compat"],
    modules,
    durableObjects: {
      WorkspaceRegistryObject: {
        className: "WorkspaceRegistryObject",
        useSQLite: true,
      },
    },
    durableObjectsPersist: config.durableObjectsPersist,
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
    bindings: {
      ACCESS_AUDIENCE: config.accessAudience,
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: config.accessIssuer,
      OVERSEER_HOSTNAME: new URL(config.allowedOrigin).hostname,
      OVERSEER_OWNER_EMAIL: "owner@example.com",
    },
  });
}
