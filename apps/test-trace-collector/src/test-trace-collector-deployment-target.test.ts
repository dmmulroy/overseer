import { assert, it } from "@effect/vitest";
import {
  selectTestTraceCollectorDeploymentTarget,
  TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN,
  TEST_TRACE_COLLECTOR_PRODUCTION_WORKER_NAME,
} from "./test-trace-collector-deployment-target.ts";

it("reserves the production custom domain for the production stage", () => {
  assert.deepStrictEqual(
    selectTestTraceCollectorDeploymentTarget({
      isDevelopmentMode: false,
      stage: "production",
    }),
    {
      _tag: "Production",
      domain: "ttc.mulroy.cloud",
      workerName: "test-trace-collector-production",
      workersDev: false,
    },
  );
  assert.strictEqual(TEST_TRACE_COLLECTOR_PRODUCTION_DOMAIN, "ttc.mulroy.cloud");
  assert.strictEqual(
    TEST_TRACE_COLLECTOR_PRODUCTION_WORKER_NAME,
    "test-trace-collector-production",
  );
});

it("selects local development without a cloud Access surface", () => {
  assert.deepStrictEqual(
    selectTestTraceCollectorDeploymentTarget({
      isDevelopmentMode: true,
      stage: "local",
    }),
    { _tag: "Local", workersDev: true },
  );
});

it("selects a workers.dev surface for preview stages", () => {
  assert.deepStrictEqual(
    selectTestTraceCollectorDeploymentTarget({
      isDevelopmentMode: false,
      stage: "preview",
    }),
    { _tag: "Preview", workersDev: true },
  );
});

it("refuses local Alchemy development against the production stage", () => {
  assert.throws(
    () =>
      selectTestTraceCollectorDeploymentTarget({
        isDevelopmentMode: true,
        stage: "production",
      }),
    /Refusing to run test trace collector Alchemy development against production/,
  );
});
