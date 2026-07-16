import { SqliteClient } from "@effect/sql-sqlite-do";
import { DurableObject } from "cloudflare:workers";
import {
  Context,
  Deferred,
  Effect,
  FileSystem,
  Fiber,
  Layer,
  Path,
  Schema,
} from "effect";
import {
  Etag,
  HttpPlatform,
  HttpRouter,
} from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/unstable/httpapi";

class DeclaredFailure extends Schema.TaggedErrorClass<DeclaredFailure>()(
  "DeclaredFailure",
  {
    code: Schema.Literal("declared_failure"),
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

class InvalidRequest extends Schema.TaggedErrorClass<InvalidRequest>()(
  "InvalidRequest",
  {
    code: Schema.Literal("invalid_request"),
    message: Schema.String,
    component: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

class RollbackProbe extends Schema.TaggedErrorClass<RollbackProbe>()(
  "RollbackProbe",
  { message: Schema.String },
) {}

class PersistenceFailure extends Schema.TaggedErrorClass<PersistenceFailure>()(
  "PersistenceFailure",
  {
    code: Schema.Literal("persistence_failure"),
    message: Schema.String,
  },
  { httpApiStatus: 500 },
) {}

function mapPersistenceFailure<A, R>(
  effect: Effect.Effect<A, { readonly message: string }, R>,
): Effect.Effect<A, PersistenceFailure, R> {
  return Effect.mapError(
    effect,
    () =>
      new PersistenceFailure({
        code: "persistence_failure",
        message: "The SQLite operation failed.",
      }),
  );
}

class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "spike/SchemaErrorMiddleware",
  { error: InvalidRequest },
) {}

const schemaErrorMiddlewareLive = HttpApiMiddleware.layerSchemaErrorTransform(
  SchemaErrorMiddleware,
  (error) =>
    Effect.fail(
      new InvalidRequest({
        code: "invalid_request",
        message: `The request ${error.kind.toLowerCase()} is invalid.`,
        component: error.kind,
      }),
    ),
);

const SpikeApi = HttpApi.make("spike")
  .add(
    HttpApiGroup.make("probe")
      .add(
        HttpApiEndpoint.get("health", "/health", {
          success: Schema.Struct({
            instanceId: Schema.String,
            initialized: Schema.Boolean,
          }),
        }),
      )
      .add(
        HttpApiEndpoint.post("echo", "/echo", {
          payload: Schema.Struct({ value: Schema.NonEmptyString }),
          success: Schema.Struct({ value: Schema.String }),
        }),
      )
      .add(
        HttpApiEndpoint.get("declaredFailure", "/declared-failure", {
          error: DeclaredFailure,
        }),
      )
      .add(
        HttpApiEndpoint.get("rows", "/rows", {
          success: Schema.Struct({ count: Schema.Number }),
          error: PersistenceFailure,
        }),
      )
      .add(
        HttpApiEndpoint.post("insertRow", "/rows", {
          payload: Schema.Struct({ name: Schema.NonEmptyString }),
          success: Schema.Struct({ count: Schema.Number }),
          error: PersistenceFailure,
        }),
      )
      .add(
        HttpApiEndpoint.post("transactionSuccess", "/transaction/success", {
          success: Schema.Struct({ count: Schema.Number }),
          error: PersistenceFailure,
        }),
      )
      .add(
        HttpApiEndpoint.post("transactionFailure", "/transaction/failure", {
          success: Schema.Struct({ count: Schema.Number, errorTag: Schema.String }),
          error: PersistenceFailure,
        }),
      )
      .add(
        HttpApiEndpoint.post("transactionInterruption", "/transaction/interruption", {
          success: Schema.Struct({ count: Schema.Number }),
          error: PersistenceFailure,
        }),
      )
      .add(
        HttpApiEndpoint.get("sqlOnlyTransaction", "/transaction/sql-only", {
          success: Schema.Struct({ errorMessage: Schema.String }),
        }),
      ),
  )
  .middleware(SchemaErrorMiddleware);

const platformLive = Layer.mergeAll(
  Path.layer,
  Etag.layerWeak,
  HttpPlatform.layer,
).pipe(Layer.provideMerge(FileSystem.layerNoop({})));

function makeApiLayer(
  storage: DurableObjectStorage,
  instanceId: string,
) {
  const sqliteLive = SqliteClient.layer({ storage });
  const sqlOnlyLive = SqliteClient.layer({ db: storage.sql });
  const groupLive = HttpApiBuilder.group(
    SpikeApi,
    "probe",
    (handlers) =>
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient;

        // Make cold initialization long enough for the abort integration test to overlap it.
        yield* Effect.sleep("40 millis");
        yield* sql`
          CREATE TABLE IF NOT EXISTS transaction_probe (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
          )
        `;

        const countRows = Effect.map(
          sql`SELECT id FROM transaction_probe ORDER BY id`,
          (rows) => rows.length,
        );
        const clearRows = sql`DELETE FROM transaction_probe`;

        return handlers
          .handle("health", () =>
            Effect.succeed({ instanceId, initialized: true }),
          )
          .handle("echo", ({ payload }) => Effect.succeed(payload))
          .handle("declaredFailure", () =>
            Effect.fail(
              new DeclaredFailure({
                code: "declared_failure",
                message: "The declared failure was serialized.",
              }),
            ),
          )
          .handle("rows", () =>
            mapPersistenceFailure(
              Effect.map(countRows, (count) => ({ count })),
            ),
          )
          .handle("insertRow", ({ payload }) =>
            mapPersistenceFailure(
              Effect.gen(function* () {
                yield* sql.withTransaction(
                  sql`INSERT INTO transaction_probe (name) VALUES (${payload.name})`,
                );
                return { count: yield* countRows };
              }),
            ),
          )
          .handle("transactionSuccess", () =>
            mapPersistenceFailure(
              Effect.gen(function* () {
                yield* clearRows;
                yield* sql.withTransaction(
                  sql`INSERT INTO transaction_probe (name) VALUES ('committed')`,
                );
                return { count: yield* countRows };
              }),
            ),
          )
          .handle("transactionFailure", () =>
            mapPersistenceFailure(
              Effect.gen(function* () {
                yield* clearRows;
                const failure = yield* sql`INSERT INTO transaction_probe (name) VALUES ('rolled-back')`.pipe(
                  Effect.andThen(
                    Effect.fail(new RollbackProbe({ message: "rollback requested" })),
                  ),
                  sql.withTransaction,
                  Effect.flip,
                );
                return { count: yield* countRows, errorTag: failure._tag };
              }),
            ),
          )
          .handle("transactionInterruption", () =>
            mapPersistenceFailure(
              Effect.gen(function* () {
                yield* clearRows;
                const inserted = yield* Deferred.make<void>();
                const fiber = yield* sql`INSERT INTO transaction_probe (name) VALUES ('interrupted')`.pipe(
                  Effect.tap(() => Deferred.succeed(inserted, undefined)),
                  Effect.andThen(Effect.never),
                  sql.withTransaction,
                  Effect.forkChild,
                );
                yield* Deferred.await(inserted);
                yield* Fiber.interrupt(fiber);
                return { count: yield* countRows };
              }),
            ),
          )
          .handle("sqlOnlyTransaction", () =>
            Effect.gen(function* () {
              const sqlOnly = yield* SqliteClient.SqliteClient;
              return yield* Effect.match(
                sqlOnly.withTransaction(Effect.void),
                {
                  onFailure: (error) => ({ errorMessage: error.message }),
                  onSuccess: () => ({ errorMessage: "Transaction unexpectedly succeeded." }),
                },
              );
            }).pipe(
              Effect.provide(sqlOnlyLive),
              Effect.scoped,
            ),
          );
      }),
  ).pipe(Layer.provide(sqliteLive));

  return HttpApiBuilder.layer(SpikeApi).pipe(
    Layer.provide(groupLive),
    Layer.provide(schemaErrorMiddlewareLive),
    Layer.provide(platformLive),
  );
}

function projectOuterHttpError(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status < 400 || contentType.includes("application/json")) {
    return response;
  }

  const error = (() => {
    switch (response.status) {
      case 404:
        return { code: "route_not_found", message: "No route matches this request." };
      case 405:
        return { code: "method_not_allowed", message: "This method is not allowed for the route." };
      case 415:
        return { code: "unsupported_media_type", message: "The request media type is not supported." };
      default:
        return { code: "http_error", message: "The HTTP adapter rejected the request." };
    }
  })();

  return Response.json(error, { status: response.status });
}

/**
 * Throwaway Durable Object composition root used to exercise Effect's Web and SQLite adapters.
 */
export class EffectSqliteDurableObject extends DurableObject<Cloudflare.Env> {
  readonly #handler: (request: Request) => Promise<Response>;
  readonly #ready: Promise<void>;

  /**
   * Builds and primes the Effect handler outside an external request's I/O context.
   */
  constructor(state: DurableObjectState, env: Cloudflare.Env) {
    super(state, env);
    const instanceId = crypto.randomUUID();
    const { handler } = HttpRouter.toWebHandler(
      makeApiLayer(state.storage, instanceId),
      { disableLogger: true },
    );
    this.#handler = (request) => handler(request, Context.empty());
    this.#ready = state.blockConcurrencyWhile(async () => {
      const response = await this.#handler(new Request("https://effect-spike.invalid/health"));
      if (!response.ok) {
        throw new Error(`Effect handler initialization failed with ${response.status}`);
      }
    });
  }

  /**
   * Runs the primed Fetch-compatible Effect handler and normalizes outer framework errors to JSON.
   */
  override async fetch(request: Request): Promise<Response> {
    await this.#ready;
    return projectOuterHttpError(await this.#handler(request));
  }
}

/**
 * Routes the public Worker request to a named spike Durable Object.
 */
export default {
  fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const objectName = request.headers.get("x-spike-object") ?? "default";
    return env.EFFECT_SQLITE_DO.getByName(objectName).fetch(request);
  },
};
