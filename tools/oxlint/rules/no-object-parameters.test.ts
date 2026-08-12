import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noObjectParametersRule } from "./no-object-parameters.ts";

test("rejects object parameters and local aliases", () => {
  new RuleTester().run("no-object-parameters", noObjectParametersRule, {
    valid: [
      { filename: "src/input.ts", code: "const parse = (input: RequestInput) => input;" },
      { filename: "src/failure.ts", code: "interface Failure { readonly cause: unknown }" },
      { filename: "src/failure.ts", code: "const enrich = (cause: unknown) => ({ cause });" },
    ],
    invalid: [
      {
        filename: "src/input.ts",
        code: "const parse = (input: object) => input;",
        errors: [{ messageId: "objectParameter", data: { parameter: "input" } }],
        output: null,
      },
      {
        filename: "src/input.ts",
        code: "function parse(input: object): void {}",
        errors: [{ messageId: "objectParameter", data: { parameter: "input" } }],
        output: null,
      },
      {
        filename: "src/input.ts",
        code: "type BroadInput = object; type Handler = (input: BroadInput) => void;",
        errors: [{ messageId: "objectParameter", data: { parameter: "input" } }],
        output: null,
      },
      {
        filename: "src/input.ts",
        code: "type BroadInput = string | object; const parse = (input: BroadInput) => input;",
        errors: [{ messageId: "objectParameter", data: { parameter: "input" } }],
        output: null,
      },
    ],
  });
});
