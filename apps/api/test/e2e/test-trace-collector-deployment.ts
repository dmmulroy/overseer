import {
  OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN,
  OverseerSharedInfrastructureStack,
} from "@overseer/shared-infrastructure";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

/** Production trace collector URL and redacted Access credentials used by the E2E harness. */
export interface ITestTraceCollectorConnection {
  readonly url: URL;
  readonly access: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
  };
}

/** Provides the resolved suite-wide test trace collector connection. */
export class TestTraceCollectorConnection extends Context.Service<
  TestTraceCollectorConnection,
  ITestTraceCollectorConnection
>()("@overseer/test/TestTraceCollectorConnection") {}

/** Provides one already-resolved test trace collector connection value. */
export const testTraceCollectorConnectionLayer = (
  connection: ITestTraceCollectorConnection,
): Layer.Layer<TestTraceCollectorConnection> =>
  Layer.succeed(TestTraceCollectorConnection, TestTraceCollectorConnection.of(connection));

const testTraceCollectorProductionUrl = new URL(
  `https://${OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN}`,
);

class TestTraceCollectorAccessSecretUnavailable extends Schema.TaggedError<TestTraceCollectorAccessSecretUnavailable>()(
  "TestTraceCollectorAccessSecretUnavailable",
  { message: Schema.String },
) {}

/** Resolve an authenticated production trace collector connection from typed Alchemy outputs. */
export const resolveTestTraceCollectorConnection = Effect.fn(
  "TestTraceCollectorConnection.resolve",
)(function* (clientId: string, clientSecret: Redacted.Redacted<string> | undefined) {
  if (clientSecret === undefined) {
    return yield* Effect.fail(
      new TestTraceCollectorAccessSecretUnavailable({
        message:
          "Test trace collector Access service-token secret is unavailable. Rotate the shared service token before running Overseer end-to-end tests.",
      }),
    );
  }

  return {
    url: testTraceCollectorProductionUrl,
    access: { clientId, clientSecret },
  } satisfies ITestTraceCollectorConnection;
});

/** Resolves the persistent production trace collector and its shared Access credentials. */
export const OverseerTestTraceCollectorDeploymentStack = Alchemy.Stack(
  "OverseerTestTraceCollectorDeployment",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const sharedInfrastructureReference =
      OverseerSharedInfrastructureStack.stage[OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE];
    if (sharedInfrastructureReference === undefined) {
      return yield* Effect.die(
        new Error("Overseer shared infrastructure production stage reference is unavailable."),
      );
    }
    const sharedInfrastructure = yield* sharedInfrastructureReference;

    return {
      clientId: sharedInfrastructure.traceCollectorAccessClientId,
      clientSecret: sharedInfrastructure.traceCollectorAccessClientSecret,
    };
  }),
);
