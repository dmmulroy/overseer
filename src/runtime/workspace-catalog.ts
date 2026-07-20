import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  CatalogCommand,
  CatalogOutcome,
  CatalogRead,
  type CatalogCommand as CatalogCommandType,
  type CatalogOutcome as CatalogOutcomeType,
  type CatalogRead as CatalogReadType,
} from "../application/catalog/catalog-rpc.ts";
import { migrateCatalog } from "../adapters/catalog-sqlite/catalog-migrations.ts";
import { CatalogSqliteState } from "../adapters/catalog-sqlite/catalog-sqlite-state.ts";
import {
  makeCatalogCommandHandler,
  makeCatalogReadHandler,
} from "../application/catalog/catalog.ts";
import { makeWorkspaceId } from "../domain/entity-id.ts";

type WorkspaceCatalogShape = {
  readonly read: (request: CatalogReadType) => Effect.Effect<CatalogOutcomeType>;
  readonly command: (request: CatalogCommandType) => Effect.Effect<CatalogOutcomeType>;
};

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
      const sql = yield* SqliteClient.make({ storage: state.raw.storage }).pipe(
        Effect.provide(Reactivity.layer),
      );
      return yield* state.blockConcurrencyWhile(() =>
        Effect.gen(function* () {
          yield* migrateCatalog.pipe(
            Effect.tapError((error) =>
              Effect.logError("Catalog initialization failed").pipe(
                Effect.annotateLogs({ error_type: error._tag }),
              )
            ),
            Effect.orDie,
          );
          const catalog = new CatalogSqliteState();
          const read = makeCatalogReadHandler(catalog);
          const command = makeCatalogCommandHandler(
            catalog,
            { now: () => new Date() },
            {
              next: (now) => makeWorkspaceId(
                now,
                crypto.getRandomValues(new Uint8Array(10)),
              ),
            },
          );
          return {
            read: (input: CatalogReadType) => {
              const request = Schema.decodeUnknownResult(CatalogRead)(input);
              return Result.isSuccess(request)
                ? read(request.success).pipe(
                    Effect.provideService(SqlClient.SqlClient, sql),
                  )
                : Effect.succeed(CatalogOutcome.cases.CatalogProtocolInvalid.make({}));
            },
            command: (input: CatalogCommandType) => {
              const request = Schema.decodeUnknownResult(CatalogCommand)(input);
              return Result.isSuccess(request)
                ? command(request.success).pipe(
                    Effect.provideService(SqlClient.SqlClient, sql),
                  )
                : Effect.succeed(CatalogOutcome.cases.CatalogProtocolInvalid.make({}));
            },
          };
        }).pipe(Effect.provideService(SqlClient.SqlClient, sql))
      );
    });
  }),
);

export default WorkspaceCatalogLive;
