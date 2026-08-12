import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noConditionalEmptyObjectSpreadRule } from "./no-conditional-empty-object-spread.ts";

/** Exercise conditional empty-object spread detection and guarded direct-property autofixes. */
test("bans conditional empty-object spreads and fixes only equivalent direct properties", () => {
  new RuleTester().run("no-conditional-empty-object-spread", noConditionalEmptyObjectSpreadRule, {
    valid: [
      {
        code: "const value = { cursor };",
      },
      {
        code: "const value = { ...(enabled ? { cursor } : fallback) };",
      },
    ],
    invalid: [
      {
        code: "const value = { ...(cursor === undefined ? {} : { cursor }) };",
        errors: [{ messageId: "avoid" }],
        output: "const value = { cursor };",
      },
      {
        code: "const value = { ...(cursor !== undefined ? { cursor } : {}) };",
        errors: [{ messageId: "avoid" }],
        output: "const value = { cursor };",
      },
      {
        code: "const value = { ...(submissionId === undefined ? {} : { submissionId: submissionId.value }) };",
        errors: [{ messageId: "avoid" }],
        output: null,
      },
      {
        code: 'const value = { ...(immutable ? { "cache-control": header } : {}) };',
        errors: [{ messageId: "avoid" }],
        output: null,
      },
      {
        code: "const value = { ...(start === undefined ? {} : { lineStart: start, lineEnd: end }) };",
        errors: [{ messageId: "avoid" }],
        output: null,
      },
    ],
  });
});
