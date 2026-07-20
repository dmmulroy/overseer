import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  type CatalogCommand,
  CatalogOutcome,
  type CatalogOutcome as CatalogOutcomeType,
  type CatalogRead,
  type CatalogRpc,
} from "../../application/catalog/catalog-rpc.ts";

/** Schemaless-RPC wire exposed by the singleton Catalog object. */
export type CatalogRpcWire = {
  readonly read: (request: CatalogRead) => Effect.Effect<CatalogOutcomeType, unknown>;
  readonly command: (request: CatalogCommand) => Effect.Effect<CatalogOutcomeType, unknown>;
};

function safeErrorType(input: unknown): string {
  return typeof input === "object" && input !== null && "_tag" in input &&
      typeof input._tag === "string"
    ? input._tag
    : typeof input;
}

function decodeOutcome(
  effect: Effect.Effect<CatalogOutcomeType, unknown>,
  operation: "read" | "command",
): Effect.Effect<CatalogOutcomeType> {
  return Effect.gen(function* () {
    const result = yield* Effect.result(effect);
    if (Result.isFailure(result)) {
      yield* Effect.logError("Catalog RPC failed").pipe(
        Effect.annotateLogs({
          error_type: safeErrorType(result.failure),
          operation,
        }),
      );
      return CatalogOutcome.cases.CatalogStateUnavailable.make({});
    }
    const decoded = Schema.decodeUnknownResult(CatalogOutcome)(result.success);
    if (Result.isFailure(decoded)) {
      yield* Effect.logError("Catalog RPC returned an invalid outcome").pipe(
        Effect.annotateLogs({ operation }),
      );
      return CatalogOutcome.cases.CatalogProtocolInvalid.make({});
    }
    return decoded.success;
  });
}

/** Adapt a raw Durable Object stub to the application-owned Catalog RPC port. */
export function makeCatalogRpcClient(
  wireForRequest: () => CatalogRpcWire,
): CatalogRpc {
  return {
    read: (request: CatalogRead) => decodeOutcome(wireForRequest().read(request), "read"),
    command: (request: CatalogCommand) =>
      decodeOutcome(wireForRequest().command(request), "command"),
  };
}
