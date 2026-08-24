import { describe } from "vite-plus/test";
import OverseerApiStack from "../alchemy.run.ts";
import { registerAccessTestSuite } from "./e2e/suites/access-test-suite.ts";
import { OverseerTestHarness } from "./e2e/harness/overseer-test-harness.ts";
import { registerOverseerTracingAcceptance } from "./e2e/tracing/overseer-tracing-acceptance.ts";
import { registerWorkspaceTestSuite } from "./e2e/suites/workspace-test-suite.ts";

describe("Overseer API", () => {
  const harness = OverseerTestHarness.fromStack(OverseerApiStack);

  registerAccessTestSuite(harness);
  registerWorkspaceTestSuite(harness);
  registerOverseerTracingAcceptance(harness);
});
