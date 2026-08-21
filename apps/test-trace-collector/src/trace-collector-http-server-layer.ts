import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform } from "effect/unstable/http";

const traceCollectorHttpPlatformLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: () => Effect.die("Test trace collector compression is not supported"),
  },
  fileResponse: () => Effect.die("Test trace collector file responses are not supported"),
  fileWebResponse: () => Effect.die("Test trace collector file responses are not supported"),
});

/** Provides Effect HTTP infrastructure for the public test trace collector API. */
export const traceCollectorHttpServerLayer = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  traceCollectorHttpPlatformLayer,
  Path.layer,
);
