import type { DurableObjectState } from "@cloudflare/workers-types";
import { migrateCatalog } from "../adapters/catalog-sqlite/catalog-migrations.ts";

/** Singleton Catalog Durable Object; binding-only and never an HTTP ingress. */
export class WorkspaceCatalog {
  /** Construct and migrate the singleton Catalog before it accepts work. */
  constructor(ctx: DurableObjectState) {
    ctx.blockConcurrencyWhile(async () => {
      migrateCatalog(ctx.storage);
    });
  }
}
