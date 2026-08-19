import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const E2E_FEATURE_FILE = /(?:^|\/)apps\/api\/test\/e2e\/[^/]+\.ts$/u;
const E2E_SUPPORT_FILE = /\/(?:fixture-registry|overseer-[^/]+)\.ts$/u;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const TEST_RUNNER_SOURCE = /^(?:@effect\/vitest|vite-plus\/test|vitest)$/u;

const importedName = (specifier: ESTree.ImportSpecifier): string =>
  specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;

/** Prevent end-to-end feature modules from bypassing harness-provided evidence capabilities. */
export const noBypassedE2eEvidenceRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require E2E feature modules to use context-provided assertions and evidence storage orchestration.",
    },
    messages: {
      testRunnerAssertion:
        "Do not import test-runner assertions in an E2E feature module. Receive assert from OverseerTestContext so every executed assertion is recorded.",
      testRunStorage:
        "Do not import TestRunStorage in an E2E feature module. Test authors attach evidence through OverseerTestContext; the harness owns persistence.",
    },
  },
  createOnce(context) {
    let enabled = false;
    return {
      Program() {
        const filename = context.filename.replaceAll("\\", "/");
        enabled =
          E2E_FEATURE_FILE.test(filename) &&
          !E2E_SUPPORT_FILE.test(filename) &&
          !TEST_FILE.test(filename);
      },
      ImportDeclaration(node) {
        if (!enabled) return;
        if (TEST_RUNNER_SOURCE.test(node.source.value)) {
          for (const specifier of node.specifiers) {
            if (
              specifier.type !== "ImportSpecifier" ||
              importedName(specifier) === "assert" ||
              importedName(specifier) === "expect"
            ) {
              context.report({ node: specifier, messageId: "testRunnerAssertion" });
            }
          }
        }
        if (!node.source.value.includes("test-run-storage")) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            importedName(specifier) === "TestRunStorage"
          ) {
            context.report({ node: specifier, messageId: "testRunStorage" });
          }
        }
      },
    };
  },
});
