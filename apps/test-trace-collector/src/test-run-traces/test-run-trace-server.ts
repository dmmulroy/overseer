import { SqliteClient } from "@effect/sql-sqlite-do";
import * as Cloudflare from "alchemy/Cloudflare";
import type { HttpEffect } from "alchemy/Http";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { durableObjectHttpServerLayer } from "../durable-object-http-server-layer.ts";
import { testRunTraceDatabaseLayerWithoutDependencies } from "./test-run-trace-database.ts";
import { testRunTraceHttpHandlersLayer } from "./test-run-trace-http-handlers.ts";
import { TestRunTraceHttpApi } from "./test-run-trace-http-api.ts";

interface TestRunTraceServerContract {
  readonly fetch: HttpEffect;
}

/** Durable Object namespace that owns every retained trace for one test run. */
export class TestRunTraceServer extends Cloudflare.DurableObject<
  TestRunTraceServer,
  TestRunTraceServerContract
>()("TestRunTraceServer") {}

/** Hosts the test-run trace Durable Object with invocation-scoped SQLite resources. */
export const testRunTraceServerLayerWithoutDependencies: Layer.Layer<
  TestRunTraceServer,
  never,
  Cloudflare.Worker
> = TestRunTraceServer.make<never>(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const databaseLayer = testRunTraceDatabaseLayerWithoutDependencies.pipe(
      Layer.provide(SqliteClient.layer({ storage: state.raw.storage })),
    );
    const handlersLayer = testRunTraceHttpHandlersLayer.pipe(Layer.provide(databaseLayer));

    return Effect.gen(function* () {
      const httpLayer = HttpApiBuilder.layer(TestRunTraceHttpApi).pipe(
        Layer.provide(handlersLayer),
        Layer.provide(durableObjectHttpServerLayer),
      );
      return { fetch: yield* HttpRouter.toHttpEffect(httpLayer) };
    }).pipe(Effect.orDie);
  }),
);

/** Hosts the production test-run trace Durable Object implementation. */
const testRunTraceServerLayer = testRunTraceServerLayerWithoutDependencies;

export default testRunTraceServerLayer;
