import type { DurableObjectState } from "@cloudflare/workers-types";
import { migrateProject } from "../adapters/project-sqlite/project-migrations.ts";

/** Per-Project Durable Object; binding-only and never an HTTP ingress. */
export class ProjectObject {
  /** Construct and migrate one Project object before it accepts work. */
  constructor(ctx: DurableObjectState) {
    ctx.blockConcurrencyWhile(async () => {
      migrateProject(ctx.storage);
    });
  }
}
