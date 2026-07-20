import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { migrateCatalog } from "../adapters/catalog-sqlite/catalog-migrations.ts";

type WorkspaceCatalogShape = Readonly<Record<never, never>>;

/** Singleton Catalog Durable Object identifier for Workspace discovery. */
export class WorkspaceCatalog extends Cloudflare.DurableObject<
  WorkspaceCatalog,
  WorkspaceCatalogShape
>()(
  "WorkspaceCatalog",
) {}

/** Alchemy V2 implementation layer for the SQLite-backed Workspace Catalog. */
const WorkspaceCatalogLive = WorkspaceCatalog.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      yield* state.blockConcurrencyWhile(() =>
        migrateCatalog.pipe(
          Effect.tapError((error) =>
            Effect.logError("Catalog initialization failed").pipe(
              Effect.annotateLogs({ error_type: error._tag }),
            )
          ),
          Effect.orDie,
          Effect.provide(SqliteClient.layer({ storage: state.raw.storage })),
        )
      );

      return {};
    });
  }),
);

export default WorkspaceCatalogLive;
