import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noUnknownTypeAliasesRule } from "./no-unknown-type-aliases.ts";

test("rejects aliases that conceal unknown", () => {
  new RuleTester().run("no-unknown-type-aliases", noUnknownTypeAliasesRule, {
    valid: [
      { filename: "src/failure.ts", code: "interface Failure { readonly cause: unknown }" },
      { filename: "src/failure.ts", code: "type FailureCause = Error | string;" },
      { filename: "src/types.ts", code: "type Identity<T> = T;" },
    ],
    invalid: [
      {
        filename: "src/input.ts",
        code: "type Input = unknown;",
        errors: [{ messageId: "unknownAlias", data: { alias: "Input" } }],
        output: null,
      },
      {
        filename: "src/input.ts",
        code: "type Input = unknown; type RenamedInput = Input;",
        errors: [
          { messageId: "unknownAlias", data: { alias: "Input" } },
          { messageId: "unknownAlias", data: { alias: "RenamedInput" } },
        ],
        output: null,
      },
      {
        filename: "src/input.ts",
        code: "export type Input = (unknown);",
        errors: [{ messageId: "unknownAlias", data: { alias: "Input" } }],
        output: null,
      },
    ],
  });
});
