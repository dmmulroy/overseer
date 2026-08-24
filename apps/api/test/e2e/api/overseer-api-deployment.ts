import { Resolver } from "node:dns/promises";
import * as Test from "alchemy/Test/Vitest";
import { Data, Effect, Redacted, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { isHttpClientError } from "effect/unstable/http/HttpClientError";
import type { OverseerApiStackDeployment } from "../../../alchemy.run.ts";
import { AgentId, type AgentId as AgentIdValue } from "../../../src/domain/actor.ts";
import type { OverseerTestTarget } from "../harness/overseer-test-run.ts";

/** Local-runtime or real Cloudflare Overseer API deployment used by E2E clients. */
export type OverseerApiDeployment =
  | {
      readonly target: "local";
      readonly url: URL;
    }
  | {
      readonly target: "deployed";
      readonly url: URL;
      readonly access: {
        readonly clientId: AgentIdValue;
        readonly clientSecret: Redacted.Redacted<string>;
      };
    };

/** Failure to recover the Access service-token secret required by a deployed E2E client. */
class OverseerApiAccessSecretUnavailable extends Schema.TaggedError<OverseerApiAccessSecretUnavailable>()(
  "OverseerApiAccessSecretUnavailable",
  { message: Schema.String },
) {}

/** Resolve a target-aware API deployment from Alchemy's typed Stack output. */
export const resolveOverseerApiDeployment = Effect.fn("OverseerApiDeployment.resolve")(function* (
  target: OverseerTestTarget,
  output: OverseerApiStackDeployment,
) {
  if (output.url === undefined) {
    return yield* Effect.die(
      new Error("Overseer API deployment URL is unavailable. Deploy the API Stack again."),
    );
  }
  const url = new URL(output.url);
  if (target === "local") return { target, url } as const;

  if (!("agentClientId" in output)) {
    return yield* Effect.die(
      new Error("Overseer API deployed Stack output is missing its Access credentials."),
    );
  }
  if (output.agentClientSecret === undefined) {
    return yield* Effect.fail(
      new OverseerApiAccessSecretUnavailable({
        message:
          "Overseer API Access service-token secret is unavailable. Rotate the service token before running deployed end-to-end tests.",
      }),
    );
  }

  return {
    target,
    url,
    access: {
      clientId: AgentId.make(output.agentClientId),
      clientSecret: output.agentClientSecret,
    },
  } as const;
});

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
)(
  function* (deployment: OverseerApiDeployment) {
    const client = yield* HttpClient.HttpClient;
    const request = withOverseerApiAccessCredentials(
      deployment,
      HttpClientRequest.get(new URL(workspaceDurableObjectReadinessPath, deployment.url)),
    );
    const response = yield* client.execute(request);
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
  },
  Effect.retry({
    while: (error) =>
      error instanceof OverseerWorkspaceDurableObjectNotReady ||
      (isHttpClientError(error) && error.reason._tag === "TransportError"),
    schedule: Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("3 seconds")]),
    times: 60,
  }),
);

const parseOverseerApiIdentity = Schema.decodeUnknownEffect(Schema.Literal("Overseer API"));

const waitForOverseerApiIdentity = Effect.fn("OverseerApiDeployment.waitForIdentity")(
  function* (deployment: OverseerApiDeployment) {
    const response = yield* Test.executeWhenReady(makeOverseerApiIdentityRequest(deployment));
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

    const identity = yield* response.json;
    return yield* parseOverseerApiIdentity(identity).pipe(
      Effect.mapError(
        () =>
          new OverseerApiResponseNotReady({
            message: "Overseer API response is not ready; identity response was unavailable",
          }),
      ),
    );
  },
  Effect.retry({
    while: (error) =>
      error instanceof OverseerApiResponseNotReady ||
      (isHttpClientError(error) && error.reason._tag === "TransportError"),
    schedule: Schedule.min([Schedule.exponential("500 millis"), Schedule.spaced("3 seconds")]),
    times: 60,
  }),
);

/** Waits for target-specific readiness and verifies the API and Workspace runtime. */
export const waitForOverseerApiDeployment = Effect.fn("OverseerApiDeployment.waitUntilReady")(
  function* (deployment: OverseerApiDeployment) {
    if (deployment.target === "deployed") {
      yield* waitForOverseerApiDns(deployment.url.hostname);
    }

    yield* waitForOverseerApiIdentity(deployment);
    yield* waitForOverseerWorkspaceDurableObject(deployment);
  },
);
