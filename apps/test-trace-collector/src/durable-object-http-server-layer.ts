import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform } from "effect/unstable/http";

const durableObjectHttpPlatformLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: () =>
      Effect.die("Test trace collector Durable Object compression is not supported"),
  },
  fileResponse: () =>
    Effect.die("Test trace collector Durable Object file responses are not supported"),
  fileWebResponse: () =>
    Effect.die("Test trace collector Durable Object file responses are not supported"),
});

/** Provides Effect HTTP infrastructure for internal test trace Durable Object APIs. */
export const durableObjectHttpServerLayer = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  durableObjectHttpPlatformLayer,
  Path.layer,
);
