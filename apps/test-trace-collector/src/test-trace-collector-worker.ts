import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  TestRunTraceClient,
  testRunTraceClientLayer,
} from "./test-run-traces/test-run-trace-client.ts";
import type { TestRunTraceServer } from "./test-run-traces/test-run-trace-server.ts";
import { resolveTestTraceCollectorDeploymentTarget } from "./test-trace-collector-deployment-target.ts";
import { TraceCollectorHttpApi } from "./trace-collector-http-api.ts";
import { traceCollectorHttpHandlersLayer } from "./trace-collector-http-handlers.ts";
import { traceCollectorHttpServerLayer } from "./trace-collector-http-server-layer.ts";

/** Standalone Worker host for OTLP ingestion and historical test trace retrieval. */
export class TestTraceCollectorWorker extends Cloudflare.Worker<
  TestTraceCollectorWorker,
  {},
  TestRunTraceServer
>()("TestTraceCollector") {}

/** Provides the independently deployed test trace collector Worker and Durable Objects. */
const testTraceCollectorWorkerLayer = TestTraceCollectorWorker.make(
  Effect.gen(function* () {
    const deploymentTarget = yield* resolveTestTraceCollectorDeploymentTarget;
    const commonProps = {
      main: import.meta.url,
      dev: {
        port: 8790,
        strictPort: true,
      },
      workersDev: deploymentTarget.workersDev,
    } as const;

    return deploymentTarget._tag === "Production"
      ? {
          ...commonProps,
          domain: { name: deploymentTarget.domain },
          name: deploymentTarget.workerName,
        }
      : commonProps;
  }),
  Effect.gen(function* () {
    const testRunTraceClient = yield* TestRunTraceClient;
    const handlersLayer = traceCollectorHttpHandlersLayer.pipe(
      Layer.provide(Layer.succeed(TestRunTraceClient, testRunTraceClient)),
    );

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        HttpApiBuilder.layer(TraceCollectorHttpApi).pipe(
          Layer.provide(handlersLayer),
          Layer.provide(traceCollectorHttpServerLayer),
        ),
      ),
    };
  }).pipe(Effect.provide(testRunTraceClientLayer)),
);

export default testTraceCollectorWorkerLayer;
