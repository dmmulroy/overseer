import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import type { DurableObjectState } from "@cloudflare/workers-types";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

class IntentionalRollback extends Data.TaggedError("IntentionalRollback")<{}> {}

type CountRow = { readonly count: number };

/** Representative SQLite Durable Object for the pinned compatibility gate. */
export class CompatibilityObject {
  readonly #ctx: DurableObjectState;
  readonly #ready: Promise<void>;

  /** Prime the representative SQLite schema before the first fixture request. */
  constructor(ctx: DurableObjectState) {
    this.#ctx = ctx;
    this.#ready = ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS compatibility_values (id INTEGER PRIMARY KEY);",
      );
    });
  }

  /** Exercise transaction and query behavior through the object's binding seam. */
  async fetch(request: Request): Promise<Response> {
    await this.#ready;
    const path = new URL(request.url).pathname;
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (path === "/rollback") {
        const outcome = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql.unsafe("INSERT INTO compatibility_values DEFAULT VALUES");
            return yield* new IntentionalRollback();
          }),
        ).pipe(
          Effect.match({
            onFailure: () => ({ code: "intentional_rollback", retryable: false } as const),
            onSuccess: () => ({ code: "unexpected_commit", retryable: false } as const),
          }),
        );
        return Response.json(outcome, { status: 409 });
      }
      if (path === "/commit") {
        yield* sql.withTransaction(
          sql.unsafe("INSERT INTO compatibility_values DEFAULT VALUES"),
        );
        return Response.json({ committed: true });
      }
      const rows = yield* sql.unsafe<CountRow>(
        "SELECT COUNT(*) AS count FROM compatibility_values",
      );
      const first = rows[0];
      if (first === undefined) {
        return yield* Effect.die("SQLite count query returned no row");
      }
      return Response.json({ count: first.count });
    });

    return Effect.runPromise(
      Effect.scoped(
        program.pipe(
          Effect.provide(
            SqliteClient.layer({ storage: this.#ctx.storage }).pipe(
              Layer.orDie,
            ),
          ),
        ),
      ),
    );
  }
}

type FixtureEnvironment = {
  readonly COMPATIBILITY: {
    readonly getByName: (name: string) => {
      readonly fetch: (request: Request) => Promise<Response>;
    };
  };
};

export default {
  async fetch(request: Request, env: FixtureEnvironment): Promise<Response> {
    return env.COMPATIBILITY.getByName("default").fetch(request);
  },
};
