/// <reference types="@cloudflare/workers-types" />

import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { DurableObject } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  CatalogCommand,
  CatalogOutcome,
  CatalogRead,
  type CatalogCommand as CatalogCommandType,
  type CatalogOutcome as CatalogOutcomeType,
  type CatalogRead as CatalogReadType,
} from "../../src/application/catalog/catalog-rpc.ts";
import { migrateCatalog } from "../../src/adapters/catalog-sqlite/catalog-migrations.ts";
import { CatalogSqliteState } from "../../src/adapters/catalog-sqlite/catalog-sqlite-state.ts";
import {
  makeCatalogCommandHandler,
  makeCatalogReadHandler,
} from "../../src/application/catalog/catalog.ts";
import { makeWorkspaceId } from "../../src/domain/entity-id.ts";

/** Representative SQLite Catalog Durable Object used by Gateway integration tests. */
export class TestWorkspaceCatalog extends DurableObject<Readonly<Record<never, never>>> {
  readonly #ready: Promise<void>;
  readonly #run: <A>(
    effect: Effect.Effect<A, never, SqlClient.SqlClient>,
  ) => Promise<A>;
  readonly #catalog = new CatalogSqliteState();
  readonly #read = makeCatalogReadHandler(this.#catalog);
  readonly #command = makeCatalogCommandHandler(
    this.#catalog,
    { now: () => new Date() },
    {
      next: (now) => makeWorkspaceId(
        now,
        crypto.getRandomValues(new Uint8Array(10)),
      ),
    },
  );

  constructor(ctx: DurableObjectState, env: Readonly<Record<never, never>>) {
    super(ctx, env);
    const runtime = ManagedRuntime.make(
      SqliteClient.layer({ storage: ctx.storage }),
    );
    this.#run = (effect) => runtime.runPromise(effect);
    this.#ready = ctx.blockConcurrencyWhile(() =>
      runtime.runPromise(migrateCatalog)
    );
  }

  /** Decode and execute one binding-only Catalog read. */
  async read(input: CatalogReadType): Promise<CatalogOutcomeType> {
    await this.#ready;
    const request = Schema.decodeUnknownResult(CatalogRead)(input);
    return Result.isSuccess(request)
      ? this.#run(this.#read(request.success))
      : CatalogOutcome.cases.CatalogProtocolInvalid.make({});
  }

  /** Decode and execute one binding-only Catalog command. */
  async command(input: CatalogCommandType): Promise<CatalogOutcomeType> {
    await this.#ready;
    const request = Schema.decodeUnknownResult(CatalogCommand)(input);
    return Result.isSuccess(request)
      ? this.#run(this.#command(request.success))
      : CatalogOutcome.cases.CatalogProtocolInvalid.make({});
  }
}
