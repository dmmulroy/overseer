import { Context, Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { OverseerHttpApi } from "../../src/overseer-http-api.ts";
import type { OverseerApiDeployment } from "./overseer-api-deployment.ts";

/** Schema-derived operations exposed by a local or deployed Overseer API. */
export interface IOverseerApiClient extends HttpApiClient.ForApi<typeof OverseerHttpApi> {}

/** Provides authority to drive one parsed Overseer API deployment. */
export class OverseerApiClient extends Context.Service<OverseerApiClient, IOverseerApiClient>()(
  "@overseer/test/OverseerApiClient",
) {}

/** Constructs the schema-derived API client using the ambient HTTP transport. */
export const makeOverseerApiClient = (
  deployment: OverseerApiDeployment,
): Effect.Effect<OverseerApiClient["Service"], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const configuredHttpClient =
      deployment.target === "local"
        ? httpClient
        : httpClient.pipe(
            HttpClient.mapRequest((request) =>
              request.pipe(
                HttpClientRequest.setHeader("CF-Access-Client-Id", deployment.access.clientId),
                HttpClientRequest.setHeader(
                  "CF-Access-Client-Secret",
                  Redacted.value(deployment.access.clientSecret),
                ),
              ),
            ),
          );
    const client = yield* HttpApiClient.makeWith(OverseerHttpApi, {
      baseUrl: deployment.url,
      httpClient: configuredHttpClient,
    });

    return OverseerApiClient.of(client);
  });

/** Provides a target-aware Overseer API client while preserving the HTTP transport requirement. */
export const overseerApiClientLayer = (
  deployment: OverseerApiDeployment,
): Layer.Layer<OverseerApiClient, never, HttpClient.HttpClient> =>
  Layer.effect(OverseerApiClient, makeOverseerApiClient(deployment));
