import { Effect, Schema } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import { Command } from "foldkit";
import * as Http from "foldkit/http";
import {
  FailedEcho,
  SucceededEcho,
} from "./project-message";
import { SpikeApi } from "../shared-api";

/** Foldkit Command backed by a browser HttpApiClient derived from the Gateway contract. */
export const FetchEcho = Command.define(
  "FetchEcho",
  { value: Schema.NonEmptyString },
  SucceededEcho,
  FailedEcho,
)(({ value }) =>
  Effect.gen(function* () {
    const client = yield* HttpApiClient.make(SpikeApi, { baseUrl: globalThis.location.origin });
    const echoed = yield* client.probe.echo({ payload: { value } });
    return SucceededEcho({ value: echoed.value });
  }).pipe(
    Effect.catch((error) => Effect.succeed(FailedEcho({ message: String(error) }))),
    Effect.provide(Http.layer),
  ),
);
