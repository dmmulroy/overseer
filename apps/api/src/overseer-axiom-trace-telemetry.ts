import {
  OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  OverseerSharedInfrastructureStack,
} from "@overseer/shared-infrastructure";
import { deriveTestRunIdFromStage, TestRunId, TestStage } from "./overseer-e2e-trace-identity.ts";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import { Config, Effect, Layer, Option, Redacted } from "effect";

const overseerTestRunIdConfig = Config.option(Config.schema(TestRunId, "OVERSEER_TEST_RUN_ID"));
const overseerTestStageConfig = Config.schema(TestStage, "OVERSEER_TEST_STAGE");

/** Exports production and E2E runtime traces to their permanent Axiom datasets. */
export const overseerAxiomTraceTelemetryLayer: Layer.Layer<never> = Layer.unwrap(
  Effect.gen(function* () {
    const testRunId = yield* overseerTestRunIdConfig;
    const isDevelopment = yield* Alchemy.ALCHEMY_DEV;
    if (Option.isNone(testRunId) && isDevelopment) return Layer.empty;

    const sharedInfrastructureReference =
      OverseerSharedInfrastructureStack.stage[OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE];
    if (sharedInfrastructureReference === undefined) {
      return yield* Effect.die(
        new Error("Overseer Axiom telemetry shared infrastructure reference is unavailable."),
      );
    }
    const sharedInfrastructure = yield* sharedInfrastructureReference;

    const destination = Option.isSome(testRunId)
      ? yield* Effect.gen(function* () {
          const stage = yield* overseerTestStageConfig;
          const expectedTestRunId = deriveTestRunIdFromStage(stage);
          if (testRunId.value !== expectedTestRunId) {
            return yield* Effect.die(
              new Error(
                `Overseer Axiom telemetry run identity mismatch: stage ${stage} requires ${expectedTestRunId}.`,
              ),
            );
          }

          return {
            datasetName: sharedInfrastructure.axiomE2eTraceDatasetName,
            ingestToken: sharedInfrastructure.axiomE2eTraceIngestToken,
            otlpEndpoint: sharedInfrastructure.axiomE2eTraceOtlpEndpoint,
          };
        })
      : {
          datasetName: sharedInfrastructure.axiomProductionTraceDatasetName,
          ingestToken: sharedInfrastructure.axiomProductionTraceIngestToken,
          otlpEndpoint: sharedInfrastructure.axiomProductionTraceOtlpEndpoint,
        };

    return Alchemy.Telemetry.layerOtlp({
      traces: {
        url: destination.otlpEndpoint,
        headers: {
          Authorization: destination.ingestToken.pipe(
            Output.map((token) => Redacted.make(`Bearer ${Redacted.value(token)}`)),
          ),
          "X-Axiom-Dataset": destination.datasetName,
        },
      },
      serviceName: "overseer-api-worker",
    });
  }).pipe(Effect.orDie),
);
