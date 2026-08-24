import {
  OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE,
  OverseerSharedInfrastructureStack,
} from "@overseer/shared-infrastructure";
import * as Alchemy from "alchemy";
import type { Input } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Redacted, Schema } from "effect";

/** Permanent Axiom resources used to export and query Overseer E2E traces. */
export interface OverseerE2eAxiomDeployment {
  /** Stable dataset shared by every E2E test run. */
  readonly datasetName: string;
  /** Inputs available only to the test execution trace exporter. */
  readonly export: {
    /** Redacted bearer token restricted to E2E trace ingestion. */
    readonly ingestToken: Redacted.Redacted<string>;
    /** Signal-specific Axiom OTLP HTTP endpoint receiving E2E traces. */
    readonly otlpEndpoint: URL;
  };
  /** Inputs available only to retained E2E trace queries. */
  readonly query: {
    /** Axiom API root used for APL queries. */
    readonly apiBaseUrl: URL;
    /** Redacted bearer token restricted to E2E trace queries. */
    readonly queryToken: Redacted.Redacted<string>;
  };
}

/** Reads permanent E2E Axiom resources without assuming their lifecycle ownership. */
export const OverseerE2eAxiomReferenceStack = Alchemy.Stack(
  "OverseerE2eAxiomReference",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const sharedInfrastructureReference =
      OverseerSharedInfrastructureStack.stage[OVERSEER_SHARED_INFRASTRUCTURE_PRODUCTION_STAGE];
    if (sharedInfrastructureReference === undefined) {
      return yield* Effect.die(
        new Error("Overseer E2E Axiom shared infrastructure reference is unavailable."),
      );
    }
    const sharedInfrastructure = yield* sharedInfrastructureReference;

    return {
      apiBaseUrl: sharedInfrastructure.axiomE2eTraceApiBaseUrl,
      datasetName: sharedInfrastructure.axiomE2eTraceDatasetName,
      ingestToken: sharedInfrastructure.axiomE2eTraceIngestToken,
      otlpEndpoint: sharedInfrastructure.axiomE2eTraceOtlpEndpoint,
      queryToken: sharedInfrastructure.axiomE2eTraceQueryToken,
    };
  }),
);

type OverseerE2eAxiomReferenceOutput = Effect.Success<
  typeof OverseerE2eAxiomReferenceStack
>["output"];

/** Resolved output produced by the permanent E2E Axiom reference Stack. */
export type OverseerE2eAxiomReferenceDeployment = Input.Resolve<OverseerE2eAxiomReferenceOutput>;

const parseAxiomApiBaseUrl = Schema.decodeUnknownEffect(Schema.URLFromString);
const parseAxiomOtlpEndpoint = Schema.decodeUnknownEffect(Schema.URLFromString);

/** Resolves permanent E2E Axiom resources from shared infrastructure outputs. */
export const resolveOverseerE2eAxiomDeployment = Effect.fn("OverseerE2eAxiomDeployment.resolve")(
  function* (output: OverseerE2eAxiomReferenceDeployment) {
    const apiBaseUrl = yield* parseAxiomApiBaseUrl(output.apiBaseUrl);
    const otlpEndpoint = yield* parseAxiomOtlpEndpoint(output.otlpEndpoint);

    return {
      datasetName: output.datasetName,
      export: {
        ingestToken: output.ingestToken,
        otlpEndpoint,
      },
      query: {
        apiBaseUrl,
        queryToken: output.queryToken,
      },
    } satisfies OverseerE2eAxiomDeployment;
  },
);
