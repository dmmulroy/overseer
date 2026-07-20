import type { DurableObjectState } from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import { migrateCatalog } from "../adapters/catalog-sqlite/catalog-migrations.ts";

/** Singleton Catalog Durable Object; binding-only and never an HTTP ingress. */
export class WorkspaceCatalog {
  /** Construct and migrate the singleton Catalog before it accepts work. */
  constructor(ctx: DurableObjectState) {
    ctx.blockConcurrencyWhile(() =>
      Effect.runPromise(
        migrateCatalog(ctx.storage).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              console.error("Catalog initialization failed", { error_type: error._tag });
            })
          ),
          Effect.orDie,
        ),
      )
    );
  }
}
