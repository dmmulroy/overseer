import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noBypassedE2eEvidenceRule } from "./no-bypassed-e2e-evidence.ts";

/** Exercise E2E evidence enforcement across feature and harness support modules. */
test("prevents E2E feature modules from bypassing recorded evidence", () => {
  new RuleTester().run("no-bypassed-e2e-evidence", noBypassedE2eEvidenceRule, {
    valid: [
      {
        filename: "apps/api/test/e2e/workspace.ts",
        code: 'import type { ITestAssert } from "./evidence/test-assert.ts";',
      },
      {
        filename: "apps/api/test/e2e/overseer-test-harness.ts",
        code: 'import { TestRunStorage } from "./evidence/test-run-storage.ts";',
      },
      {
        filename: "apps/api/test/e2e/workspace.test.ts",
        code: 'import { assert } from "@effect/vitest";',
      },
    ],
    invalid: [
      {
        filename: "apps/api/test/e2e/workspace.ts",
        code: 'import { assert } from "@effect/vitest";',
        errors: [{ messageId: "testRunnerAssertion" }],
        output: null,
      },
      {
        filename: "apps/api/test/e2e/access.ts",
        code: 'import * as Vitest from "vitest";',
        errors: [{ messageId: "testRunnerAssertion" }],
        output: null,
      },
      {
        filename: "apps/api/test/e2e/workspace.ts",
        code: 'import { TestRunStorage } from "./evidence/test-run-storage.ts";',
        errors: [{ messageId: "testRunStorage" }],
        output: null,
      },
    ],
  });
});
