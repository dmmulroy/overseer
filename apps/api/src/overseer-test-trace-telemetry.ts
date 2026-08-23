import {
  OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN,
  OverseerTraceCollectorServiceTokenReference,
} from "@overseer/shared-infrastructure";
import { makeTestRunIdFromStage, TestRunId, TestStage } from "@overseer/test-trace-protocol";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import { Config, Effect, Layer, Option } from "effect";

const overseerTestRunIdConfig = Config.option(Config.schema(TestRunId, "OVERSEER_TEST_RUN_ID"));
const overseerTestStageConfig = Config.schema(TestStage, "OVERSEER_TEST_STAGE");

/** Installs run-scoped TTC export through Alchemy's per-event Worker telemetry bridge. */
export const overseerTestTraceTelemetryLayer: Layer.Layer<never> = Layer.unwrap(
  Effect.gen(function* () {
    const testRunId = yield* overseerTestRunIdConfig;
    if (Option.isNone(testRunId)) return Layer.empty;

    const stage = yield* overseerTestStageConfig;
    const expectedTestRunId = makeTestRunIdFromStage(stage);
    if (testRunId.value !== expectedTestRunId) {
      return yield* Effect.die(
        new Error(
          `Overseer test trace telemetry run identity mismatch: stage ${stage} requires ${expectedTestRunId}.`,
        ),
      );
    }

    const serviceToken = yield* OverseerTraceCollectorServiceTokenReference;
    const clientSecret = serviceToken.clientSecret.pipe(
      Output.map((secret) => {
        if (secret === undefined) {
          throw new Error(
            "Overseer test trace telemetry cannot bind the collector Access secret. Rotate the shared service token and deploy again.",
          );
        }
        return secret;
      }),
    );

    return Alchemy.Telemetry.layerOtlp({
      traces: {
        url: `https://${OVERSEER_TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN}/v1/test-runs/${testRunId.value}/traces`,
        headers: {
          "CF-Access-Client-Id": serviceToken.clientId,
          "CF-Access-Client-Secret": clientSecret,
        },
      },
      serviceName: "overseer-api-worker",
    });
  }).pipe(Effect.orDie),
);
