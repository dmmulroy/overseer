import { Resolver } from "node:dns/promises";
import * as Test from "alchemy/Test/Vitest";
import { Data, Effect, flow, Redacted, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { isHttpClientError } from "effect/unstable/http/HttpClientError";
import { AgentId } from "../../src/domain/actor.ts";
import type { OverseerTestTarget } from "./overseer-test-run.ts";

const OverseerApiAccessCredentials = Schema.Struct({
  clientId: AgentId,
  clientSecret: Schema.Redacted(Schema.NonEmptyString),
});

const LocalOverseerApiDeployment = Schema.Struct({
  target: Schema.tag("local"),
  url: Schema.URL,
});

const DeployedOverseerApiDeployment = Schema.Struct({
  target: Schema.tag("deployed"),
  url: Schema.URL,
  access: OverseerApiAccessCredentials,
});

/** Parsed local-runtime or real Cloudflare Overseer API deployment. */
export const OverseerApiDeployment = Schema.Union([
  LocalOverseerApiDeployment,
  DeployedOverseerApiDeployment,
]).pipe(Schema.toTaggedUnion("target"));

/** Deployment values derived from the local and deployed Overseer API schemas. */
export type OverseerApiDeployment = typeof OverseerApiDeployment.Type;

const LocalOverseerApiStackOutput = Schema.Struct({
  url: Schema.URLFromString,
});

const DeployedOverseerApiStackOutput = Schema.Struct({
  url: Schema.URLFromString,
  agentClientId: AgentId,
  agentClientSecret: Schema.Redacted(Schema.NonEmptyString),
});

const parseLocalOverseerApiStackOutput = Schema.decodeUnknownEffect(LocalOverseerApiStackOutput);
const parseDeployedOverseerApiStackOutput = Schema.decodeUnknownEffect(
  DeployedOverseerApiStackOutput,
);

const parseLocalOverseerApiDeployment = flow(
  parseLocalOverseerApiStackOutput,
  Effect.map((output) =>
    OverseerApiDeployment.make({
      target: "local",
      url: output.url,
    }),
  ),
);

const parseDeployedOverseerApiDeployment = flow(
  parseDeployedOverseerApiStackOutput,
  Effect.map((output) =>
    OverseerApiDeployment.make({
      target: "deployed",
      url: output.url,
      access: {
        clientId: output.agentClientId,
        clientSecret: output.agentClientSecret,
      },
    }),
  ),
);

/** Selects the Stack-output parser for the configured local or deployed target. */
export const parseOverseerApiDeployment = (
  target: OverseerTestTarget,
): typeof parseLocalOverseerApiDeployment =>
  target === "local" ? parseLocalOverseerApiDeployment : parseDeployedOverseerApiDeployment;

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

class OverseerWorkspaceDurableObjectNotReady extends Data.TaggedError(
  "OverseerWorkspaceDurableObjectNotReady",
)<{
  readonly status: number;
  readonly message: string;
}> {}

class OverseerWorkspaceDurableObjectResponseUnexpected extends Data.TaggedError(
  "OverseerWorkspaceDurableObjectResponseUnexpected",
)<{
  readonly status: number;
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
        throw new Error("Overseer API authoritative DNS returned no AAAA records");
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

const withOverseerApiAccessCredentials = (
  deployment: OverseerApiDeployment,
  request: HttpClientRequest.HttpClientRequest,
) => {
  if (deployment.target === "local") return request;

  return request.pipe(
    HttpClientRequest.setHeader("CF-Access-Client-Id", deployment.access.clientId),
    HttpClientRequest.setHeader(
      "CF-Access-Client-Secret",
      Redacted.value(deployment.access.clientSecret),
    ),
  );
};

const makeOverseerApiIdentityRequest = (deployment: OverseerApiDeployment) =>
  withOverseerApiAccessCredentials(deployment, HttpClientRequest.get(deployment.url.href));

const workspaceDurableObjectReadinessPath = "/v1/workspaces/workspace_00000000000000000000000000";

const waitForOverseerWorkspaceDurableObject = Effect.fn(
  "OverseerApiDeployment.waitForWorkspaceDurableObject",
)(function* (deployment: OverseerApiDeployment) {
  const client = yield* HttpClient.HttpClient;
  const request = withOverseerApiAccessCredentials(
    deployment,
    HttpClientRequest.get(new URL(workspaceDurableObjectReadinessPath, deployment.url)),
  );

  yield* client.execute(request).pipe(
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        const status = response.status;
        if (status === 404) return;
        if (status === 401 || status === 403) {
          const body = yield* response.text.pipe(
            Effect.orElseSucceed(() => "<unreadable response body>"),
          );
          return yield* Effect.fail(
            new OverseerApiAuthenticationNotReady({
              status,
              message: `Overseer API authentication failed with HTTP ${status}: ${body.slice(0, 500)}`,
            }),
          );
        }
        if (status >= 500) {
          return yield* Effect.fail(
            new OverseerWorkspaceDurableObjectNotReady({
              status,
              message: `Overseer Workspace Durable Object is not ready; received HTTP ${status}`,
            }),
          );
        }
        return yield* Effect.fail(
          new OverseerWorkspaceDurableObjectResponseUnexpected({
            status,
            message: `Overseer Workspace Durable Object readiness returned unexpected HTTP ${status}`,
          }),
        );
      }),
    ),
    Effect.retry({
      while: (error) =>
        error instanceof OverseerWorkspaceDurableObjectNotReady ||
        (isHttpClientError(error) && error.reason._tag === "TransportError"),
      schedule: Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("3 seconds")]),
      times: 60,
    }),
  );
});

/** Waits for target-specific readiness and verifies the API and Workspace runtime. */
export const waitForOverseerApiDeployment = Effect.fn("OverseerApiDeployment.waitUntilReady")(
  function* (deployment: OverseerApiDeployment) {
    if (deployment.target === "deployed") {
      yield* waitForOverseerApiDns(deployment.url.hostname);
    }

    yield* Test.executeWhenReady(makeOverseerApiIdentityRequest(deployment)).pipe(
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

    yield* waitForOverseerWorkspaceDurableObject(deployment);
  },
);
