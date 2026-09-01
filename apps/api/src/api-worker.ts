import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  AccessAuthenticationMiddleware,
  accessAuthenticationMiddlewareLayer,
} from "./access-authentication-middleware.ts";
import { overseerHttpHandlersLayer } from "./overseer-http-handlers.ts";
import type { WorkspaceServer } from "./durable-objects/workspaces/workspace-server.ts";
import { OverseerApiAccessDeployment } from "./overseer-api-access.ts";
import { OverseerApiHostname } from "./overseer-api-hostname.ts";
import { OverseerHttpApi } from "./overseer-http-api.ts";
import { overseerSdkLayer } from "./overseer-sdk/overseer-sdk.ts";
import { overseerHttpSpanNameLayer } from "./overseer-http-span-names.ts";
import {
  RequestIdMiddleware,
  cloudflareRequestIdMiddlewareLayer,
} from "./request-id-middleware.ts";
import { overseerAxiomTraceTelemetryLayer } from "./overseer-axiom-trace-telemetry.ts";
import { withOverseerHttpObservability } from "./overseer-http-observability.ts";

const overseerHttpServerLayer = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  Layer.succeed(HttpPlatform.HttpPlatform, {
    platform: "web",
    compression: {
      algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
      compressResponse: () => Effect.die("Overseer API HTTP compression is not supported"),
    },
    fileResponse: () => Effect.die("Overseer API HTTP file responses are not supported"),
    fileWebResponse: () => Effect.die("Overseer API HTTP web file responses are not supported"),
  }),
  Path.layer,
);

/** Worker host for the Overseer API and Workspace Durable Objects. */
export class ApiWorker extends Cloudflare.Worker<ApiWorker, {}, WorkspaceServer>()("OverseerApi") {}

/** Provides the Overseer API Worker with its hosted Durable Object implementations. */
const apiWorkerLayer = ApiWorker.make(
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const workerName =
      stage === "production" ? "overseer-api" : `overseer-api-${stage.replaceAll("_", "-")}`;
    const commonProps = {
      name: workerName,
      main: import.meta.url,
      dev: {
        port: 8787,
        strictPort: true,
      },
      workersDev: false,
    } as const;

    if (globalThis.__ALCHEMY_RUNTIME__) {
      return commonProps;
    }

    const access = yield* OverseerApiAccessDeployment;
    const hostname = yield* OverseerApiHostname;

    return {
      ...commonProps,
      domain: { name: hostname },
      env: {
        OVERSEER_ENVIRONMENT: Option.isSome(access) ? "production" : "development",
        ...Option.match(access, {
          onNone: () => ({}),
          onSome: ({ accessTeamDomain, application }) => ({
            ACCESS_AUDIENCE: application.aud,
            CLOUDFLARE_ACCESS_TEAM_DOMAIN: accessTeamDomain,
          }),
        }),
      },
    };
  }),
  Effect.gen(function* () {
    const accessAuthenticationMiddleware = yield* AccessAuthenticationMiddleware;
    const requestIdMiddleware = yield* RequestIdMiddleware;

    const fetch = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(OverseerHttpApi).pipe(
        Layer.provide(overseerHttpHandlersLayer),
        Layer.provide(
          Layer.succeed(AccessAuthenticationMiddleware, accessAuthenticationMiddleware),
        ),
        Layer.provide(Layer.succeed(RequestIdMiddleware, requestIdMiddleware)),
        Layer.provide(overseerHttpServerLayer),
      ),
    );

    return {
      fetch: withOverseerHttpObservability(fetch, "api-worker"),
    };
  }).pipe(
    Effect.provide(overseerAxiomTraceTelemetryLayer),
    Effect.provide(overseerSdkLayer),
    Effect.provide(accessAuthenticationMiddlewareLayer),
    Effect.provide(cloudflareRequestIdMiddlewareLayer),
  ),
).pipe(Layer.provideMerge(overseerHttpSpanNameLayer));

export default apiWorkerLayer;
