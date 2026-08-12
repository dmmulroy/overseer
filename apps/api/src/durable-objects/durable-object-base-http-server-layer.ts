import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform } from "effect/unstable/http";

const durableObjectBaseHttpPlatformLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: () => Effect.die("Internal Durable Object HTTP compression is not supported"),
  },
  fileResponse: () => Effect.die("Internal Durable Object HTTP file responses are not supported"),
  fileWebResponse: () =>
    Effect.die("Internal Durable Object HTTP web file responses are not supported"),
});

/** Provides the infrastructure required by internal Durable Object HTTP APIs without file serving. */
export const durableObjectBaseHttpServerLayer = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  durableObjectBaseHttpPlatformLayer,
  Path.layer,
);
