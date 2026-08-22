import { OverseerTraceCollectorAccessPolicyReference } from "@overseer/shared-infrastructure";
import * as Output from "alchemy/Output";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Option } from "effect";

import { resolveTestTraceCollectorDeploymentTarget } from "./test-trace-collector-deployment-target.ts";
import { TestTraceCollectorWorker } from "./test-trace-collector-worker.ts";

const requireTestTraceCollectorHostname = (collectorUrl: string | undefined): string => {
  if (collectorUrl === undefined) {
    throw new Error(
      "Test trace collector hostname unavailable: the deployed Worker did not expose a URL. Check its workers.dev or custom-domain configuration and deploy again.",
    );
  }

  return new URL(collectorUrl).hostname;
};

/** Optional Cloudflare Access application protecting every cloud-deployed trace collector. */
export const TestTraceCollectorAccessDeployment = Effect.gen(function* () {
  const deploymentTarget = yield* resolveTestTraceCollectorDeploymentTarget;
  if (deploymentTarget._tag === "Local") {
    return Option.none();
  }

  const collector = yield* TestTraceCollectorWorker;
  const domain =
    deploymentTarget._tag === "Production"
      ? deploymentTarget.domain
      : collector.url.pipe(Output.map(requireTestTraceCollectorHostname));
  const serviceTokenPolicy = yield* OverseerTraceCollectorAccessPolicyReference;
  const application = yield* Cloudflare.Access.Application("TestTraceCollectorAccess", {
    domain,
    name:
      deploymentTarget._tag === "Production"
        ? "Test Trace Collector - Production"
        : "Test Trace Collector - Preview",
    policies: [serviceTokenPolicy.policyId],
    sessionDuration: "24h",
    type: "self_hosted",
  });

  return Option.some(application);
});
