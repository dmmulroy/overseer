import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

test("rejects unknown inputs while allowing error causes", () => {
  new RuleTester().run("no-unknown-parameters", noUnknownParametersRule, {
    valid: [
      { filename: "src/input.ts", code: "const parse = (input: RequestInput) => input;" },
      { filename: "src/failure.ts", code: "const enrich = (cause: unknown) => ({ cause });" },
      {
        filename: "src/failure.ts",
        code: "class Failure { constructor(public readonly cause: unknown) {} }",
      },
      { filename: "src/failure.ts", code: "interface Failure { readonly cause: unknown }" },
    ],
    invalid: [
      {
        filename: "src/input.ts",
        code: "const parse = (input: unknown) => input;",
        errors: [{ messageId: "unknownParameter", data: { parameter: "input" } }],
        output: null,
      },
      {
        filename: "src/input.ts",
        code: "function parse(payload: unknown): void {}",
        errors: [{ messageId: "unknownParameter", data: { parameter: "payload" } }],
        output: null,
      },
      {
        filename: "src/service.ts",
        code: "interface Service { execute(input: unknown): void; }",
        errors: [{ messageId: "unknownParameter", data: { parameter: "input" } }],
        output: null,
      },
    ],
  });
});
