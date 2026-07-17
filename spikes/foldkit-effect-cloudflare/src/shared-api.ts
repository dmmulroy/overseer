import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/unstable/httpapi";

/** Declared conflict used to verify typed HTTP error decoding. */
export class DeclaredFailure extends Schema.TaggedErrorClass<DeclaredFailure>()(
  "DeclaredFailure",
  {
    code: Schema.Literal("declared_failure"),
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

/** Stable JSON projection for malformed requests. */
export class InvalidRequest extends Schema.TaggedErrorClass<InvalidRequest>()(
  "InvalidRequest",
  {
    code: Schema.Literal("invalid_request"),
    message: Schema.String,
    component: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

/** Safe HTTP projection for persistence failures. */
export class PersistenceFailure extends Schema.TaggedErrorClass<PersistenceFailure>()(
  "PersistenceFailure",
  {
    code: Schema.Literal("persistence_failure"),
    message: Schema.String,
  },
  { httpApiStatus: 500 },
) {}

/** Server middleware contract that projects request parsing failures. */
export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "spike/SchemaErrorMiddleware",
  { error: InvalidRequest },
) {}

/** One contract consumed by both the workerd Gateway and browser client. */
export const SpikeApi = HttpApi.make("spike").add(
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
).middleware(SchemaErrorMiddleware);
