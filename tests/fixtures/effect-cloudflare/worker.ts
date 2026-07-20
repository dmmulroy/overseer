import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import type {
  DurableObjectState,
  DurableObjectStorage,
} from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

class IntentionalRollback extends Schema.TaggedErrorClass<IntentionalRollback>()(
  "IntentionalRollback",
  {
    code: Schema.Literal("intentional_rollback"),
    retryable: Schema.Literal(false),
  },
) {
  constructor() {
    super({ code: "intentional_rollback", retryable: false });
  }
}

const Count = Schema.Struct({ count: Schema.Number });
interface Count extends Schema.Schema.Type<typeof Count> {}
const Commit = Schema.Struct({ committed: Schema.Literal(true) });
const Interruption = Schema.Struct({ interrupted: Schema.Literal(true) });

const rollback = HttpApiEndpoint.post("rollback", "/rollback", {
  success: Schema.Never,
  error: IntentionalRollback.pipe(HttpApiSchema.status(409)),
});
const interrupt = HttpApiEndpoint.post("interrupt", "/interrupt", {
  success: Interruption,
});
const commit = HttpApiEndpoint.post("commit", "/commit", {
  success: Commit,
});
const count = HttpApiEndpoint.get("count", "/count", { success: Count });

class CompatibilityGroup extends HttpApiGroup.make("compatibility")
  .add(rollback)
  .add(interrupt)
  .add(commit)
  .add(count) {}

class CompatibilityApi extends HttpApi.make("compatibility")
  .add(CompatibilityGroup) {}

const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("The compatibility API does not serve files"),
  fileWebResponse: () => Effect.die("The compatibility API does not serve files"),
});

function makeCompatibilityHandler(
  storage: DurableObjectStorage,
): (request: Request) => Promise<Response> {
  const handlers = HttpApiBuilder.group(
    CompatibilityApi,
    "compatibility",
    (handlers) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const readCount = SqlSchema.findOne({
          Request: Schema.Void,
          Result: Count,
          execute: () => sql.unsafe("SELECT COUNT(*) AS count FROM compatibility_values"),
        });
        const rollback = Effect.fn("Compatibility.rollback")(function* () {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql.unsafe("INSERT INTO compatibility_values DEFAULT VALUES");
              return yield* new IntentionalRollback();
            }),
          ).pipe(
            Effect.catchTag("SqlError", Effect.die),
          );
        });
        const interrupt = Effect.fn("Compatibility.interrupt")(function* () {
          const outcome = yield* Effect.exit(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql.unsafe("INSERT INTO compatibility_values DEFAULT VALUES");
                return yield* Effect.interrupt;
              }),
            ),
          );
          if (!Exit.hasInterrupts(outcome)) {
            return yield* Effect.die("The compatibility transaction was not interrupted");
          }
          return { interrupted: true as const };
        });
        const commit = Effect.fn("Compatibility.commit")(function* () {
          yield* sql.withTransaction(
            sql.unsafe("INSERT INTO compatibility_values DEFAULT VALUES"),
          ).pipe(Effect.orDie);
          return { committed: true as const };
        });
        const count = Effect.fn("Compatibility.count")(function* () {
          return yield* readCount(undefined).pipe(Effect.orDie);
        });
        return handlers.handleAll({
          rollback,
          interrupt,
          commit,
          count,
        });
      }),
  );
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(CompatibilityApi).pipe(
      Layer.provide(handlers),
      Layer.provide(SqliteClient.layer({ storage })),
      Layer.provide([
        Etag.layer,
        HttpPlatformStub,
        Path.layer,
        FileSystem.layerNoop({}),
      ]),
    ),
    { disableLogger: true },
  ).handler;
}

/** Representative SQLite Durable Object for the pinned compatibility gate. */
export class CompatibilityObject {
  readonly #handle: (request: Request) => Promise<Response>;
  readonly #ready: Promise<void>;

  /** Build, migrate, and prime the declared Effect HTTP handler before external work. */
  constructor(ctx: DurableObjectState) {
    this.#handle = makeCompatibilityHandler(ctx.storage);
    const handle = this.#handle;
    this.#ready = ctx.blockConcurrencyWhile(() =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            ctx.storage.sql.exec(
              "CREATE TABLE IF NOT EXISTS compatibility_values (id INTEGER PRIMARY KEY);",
            );
          });
          const primed = yield* Effect.promise(() =>
            handle(new Request("https://fixture/count"))
          );
          if (primed.status !== 200) {
            return yield* Effect.die("The compatibility handler did not prime");
          }
        }),
      )
    );
  }

  /** Exercise declared HTTP, transaction, and query behavior through the binding seam. */
  async fetch(request: Request): Promise<Response> {
    await this.#ready;
    return this.#handle(request);
  }
}

let shouldAbortInitialization = true;

/** Fixture object that proves rejected initialization resets and can be retried. */
export class AbortingCompatibilityObject {
  readonly #ready: Promise<void>;

  /** Reject the first initialization so the runtime must reconstruct the object. */
  constructor(ctx: DurableObjectState) {
    this.#ready = ctx.blockConcurrencyWhile(() =>
      Effect.runPromise(
        Effect.suspend(() => {
          if (shouldAbortInitialization) {
            shouldAbortInitialization = false;
            return Effect.die("Intentional initialization abort");
          }
          return Effect.void;
        }),
      )
    );
  }

  /** Confirm that work is accepted only after initialization succeeds. */
  async fetch(): Promise<Response> {
    await this.#ready;
    return Response.json({ primed_after_abort: true });
  }
}

type FixtureNamespace = {
  readonly getByName: (name: string) => {
    readonly fetch: (request: Request) => Promise<Response>;
  };
};

type FixtureEnvironment = {
  readonly ABORTING: FixtureNamespace;
  readonly COMPATIBILITY: FixtureNamespace;
};

/** Forward fixture requests to the representative Durable Object bindings. */
export default {
  async fetch(request: Request, env: FixtureEnvironment): Promise<Response> {
    const namespace = new URL(request.url).pathname === "/initialization"
      ? env.ABORTING
      : env.COMPATIBILITY;
    return namespace.getByName("default").fetch(request);
  },
};
