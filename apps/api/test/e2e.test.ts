import { Resolver } from "node:dns/promises";
import { assert } from "@effect/vitest";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Data, Effect, Redacted, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { isHttpClientError } from "effect/unstable/http/HttpClientError";
import { describe } from "vite-plus/test";
import OverseerApiStack from "../alchemy.run.ts";

const E2eTestStage = Schema.String.check(
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/),
);

const stage = Schema.decodeUnknownSync(E2eTestStage)(process.env.ALCHEMY_TEST_STAGE);

interface DeployedOverseerApi {
  readonly url: string;
  readonly agentClientId: string;
  readonly agentClientSecret: Redacted.Redacted<string>;
}

class OverseerApiDnsNotReady extends Data.TaggedError("OverseerApiDnsNotReady")<{
  readonly hostname: string;
  readonly message: string;
}> {}

class OverseerApiAuthenticationNotReady extends Data.TaggedError(
  "OverseerApiAuthenticationNotReady",
)<{
  readonly status: 401 | 403;
  readonly message: string;
}> {}

class OverseerApiResponseNotReady extends Data.TaggedError("OverseerApiResponseNotReady")<{
  readonly message: string;
}> {}

const waitForOverseerApiDns = (hostname: string) =>
  Effect.tryPromise({
    try: async () => {
      const bootstrapResolver = new Resolver();
      const nameServers = await bootstrapResolver.resolveNs("mulroy.ai");
      const serverAddresses = (
        await Promise.all(nameServers.map((nameServer) => bootstrapResolver.resolve4(nameServer)))
      ).flat();
      const authoritativeResolver = new Resolver();
      authoritativeResolver.setServers(serverAddresses);

      const answers = await authoritativeResolver.resolve6(hostname);
      if (answers.length === 0) {
        throw new Error("Authoritative DNS returned no AAAA records");
      }
    },
    catch: () =>
      new OverseerApiDnsNotReady({
        hostname,
        message: `Overseer API DNS is not ready for ${hostname}`,
      }),
  }).pipe(
    Effect.retry({
      schedule: Schedule.spaced("5 seconds"),
      times: 36,
    }),
  );

const makeAgentApiRequest = (api: DeployedOverseerApi) =>
  HttpClientRequest.get(api.url).pipe(
    HttpClientRequest.setHeader("CF-Access-Client-Id", api.agentClientId),
    HttpClientRequest.setHeader("CF-Access-Client-Secret", Redacted.value(api.agentClientSecret)),
  );

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
  stage,
  dev: false,
});

const deployedApi = beforeAll(
  Effect.gen(function* () {
    const output = yield* deploy(OverseerApiStack);

    if (
      output.url === undefined ||
      !("agentClientId" in output) ||
      !("agentClientSecret" in output) ||
      output.agentClientSecret === undefined
    ) {
      return yield* Effect.fail(
        new Error(
          "Overseer E2E deployment output is missing the API URL or Agent Access credentials.",
        ),
      );
    }

    const api: DeployedOverseerApi = {
      url: output.url,
      agentClientId: output.agentClientId,
      agentClientSecret: output.agentClientSecret,
    };

    const apiUrl = yield* Schema.decodeEffect(Schema.URLFromString)(api.url);
    yield* waitForOverseerApiDns(apiUrl.hostname);

    yield* Test.executeWhenReady(makeAgentApiRequest(api)).pipe(
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          if (response.status === 401 || response.status === 403) {
            const body = yield* response.text.pipe(
              Effect.orElseSucceed(() => "<unreadable response body>"),
            );
            return yield* Effect.fail(
              new OverseerApiAuthenticationNotReady({
                status: response.status,
                message: `Overseer API authentication failed with HTTP ${response.status}: ${body.slice(0, 500)}`,
              }),
            );
          }
          if (response.status !== 200) {
            return yield* Effect.fail(
              new OverseerApiResponseNotReady({
                message: `Overseer API response is not ready; received HTTP ${response.status}`,
              }),
            );
          }

          return yield* response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Literal("Overseer API"))),
            Effect.mapError(
              () =>
                new OverseerApiResponseNotReady({
                  message: "Overseer API response is not ready; identity response was unavailable",
                }),
            ),
          );
        }),
      ),
      Effect.retry({
        while: (error) =>
          error instanceof OverseerApiResponseNotReady ||
          (isHttpClientError(error) && error.reason._tag === "TransportError"),
        schedule: Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("3 seconds")]),
        times: 60,
      }),
    );

    return api;
  }),
  { timeout: 600_000 },
);

afterAll(destroy(OverseerApiStack), { timeout: 300_000 });

describe.concurrent("Overseer API", () => {
  test(
    "an Agent reaches the deployed Overseer API",
    Effect.gen(function* () {
      const api = yield* deployedApi;
      const response = yield* HttpClient.execute(makeAgentApiRequest(api));

      assert.strictEqual(response.status, 200);

      const identity = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)),
      );
      assert.strictEqual(identity, "Overseer API");
    }),
    { timeout: 120_000 },
  );
});
