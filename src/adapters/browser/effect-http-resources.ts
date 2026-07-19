import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DiscoveryDocument } from "../../contract/http-api.ts";

/** The authenticated API discovery document could not be loaded. */
export class DiscoveryUnavailable extends Schema.TaggedErrorClass<DiscoveryUnavailable>()(
  "DiscoveryUnavailable",
  { cause: Schema.Defect() },
) {}

/** Load and parse the authenticated discovery document through same-origin REST. */
export const loadDiscovery: () => Effect.Effect<DiscoveryDocument, DiscoveryUnavailable> =
  Effect.fn("BrowserResources.loadDiscovery")(
  function* () {
    const input = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch("/api", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Discovery returned HTTP ${response.status}`);
      }
      return response.json();
    },
    catch: (cause) => new DiscoveryUnavailable({ cause }),
  });
    return yield* Schema.decodeUnknownEffect(DiscoveryDocument)(input).pipe(
      Effect.mapError((cause) => new DiscoveryUnavailable({ cause })),
    );
  },
);
