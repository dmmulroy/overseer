import { describe } from "vite-plus/test";
import OverseerApiStack from "../alchemy.run.ts";
import { registerAccessTestSuite } from "./e2e/access.ts";
import { OverseerTestHarness } from "./e2e/overseer-test-harness.ts";
import { registerOverseerTracingAcceptance } from "./e2e/overseer-tracing-acceptance.ts";
import { registerWorkspaceTestSuite } from "./e2e/workspace.ts";

describe("Overseer API", () => {
  const harness = OverseerTestHarness.fromStack(OverseerApiStack);

  registerAccessTestSuite(harness);
  registerWorkspaceTestSuite(harness);
  registerOverseerTracingAcceptance(harness);
});
