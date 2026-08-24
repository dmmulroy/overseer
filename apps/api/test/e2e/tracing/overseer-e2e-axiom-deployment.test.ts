import { assert, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { resolveOverseerE2eAxiomDeployment } from "./overseer-e2e-axiom-deployment.ts";

it.effect("resolves permanent Axiom export and query resources for Overseer E2E traces", () =>
  Effect.gen(function* () {
    const ingestToken = Redacted.make("axiom-ingest-token");
    const queryToken = Redacted.make("axiom-query-token");
    const deployment = yield* resolveOverseerE2eAxiomDeployment({
      apiBaseUrl: "https://api.axiom.co",
      datasetName: "overseer-e2e-traces",
      ingestToken,
      otlpEndpoint: "https://api.axiom.co/v1/traces",
      queryToken,
    });

    assert.strictEqual(deployment.datasetName, "overseer-e2e-traces");
    assert.strictEqual(deployment.export.otlpEndpoint.href, "https://api.axiom.co/v1/traces");
    assert.strictEqual(deployment.export.ingestToken, ingestToken);
    assert.strictEqual(deployment.query.apiBaseUrl.href, "https://api.axiom.co/");
    assert.strictEqual(deployment.query.queryToken, queryToken);
  }),
);
