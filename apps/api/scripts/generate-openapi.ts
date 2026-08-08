import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import { OverseerHttpApi } from "../src/overseer-http-api.ts";

const generateOverseerOpenApiSpec = Effect.fn("generateOverseerOpenApiSpec")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outputPath = yield* path.fromFileUrl(new URL("../openapi.json", import.meta.url));
  const specification = OpenApi.fromApi(OverseerHttpApi);

  yield* fileSystem.writeFileString(outputPath, `${JSON.stringify(specification, null, 2)}\n`);
  yield* Effect.logInfo(`Generated Overseer OpenAPI specification at ${outputPath}`);
});

NodeRuntime.runMain(generateOverseerOpenApiSpec().pipe(Effect.provide(NodeServices.layer)));
