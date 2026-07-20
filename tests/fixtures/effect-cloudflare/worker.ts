import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import type { DurableObjectState } from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

class IntentionalRollback extends Schema.TaggedErrorClass<IntentionalRollback>()(
  "IntentionalRollback",
  { message: Schema.String },
) {
  constructor() {
    super({ message: "The compatibility transaction must roll back" });
  }
}

const CountRow = Schema.Struct({ count: Schema.Number });
interface CountRow extends Schema.Schema.Type<typeof CountRow> {}

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
      const readCount = SqlSchema.findOne({
        Request: Schema.Void,
        Result: CountRow,
        execute: () => sql.unsafe("SELECT COUNT(*) AS count FROM compatibility_values"),
      });
      const count: CountRow = yield* readCount(undefined);
      return Response.json({ count: count.count });
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

/** Forward fixture requests to the representative Durable Object binding. */
export default {
  async fetch(request: Request, env: FixtureEnvironment): Promise<Response> {
    return env.COMPATIBILITY.getByName("default").fetch(request);
  },
};
