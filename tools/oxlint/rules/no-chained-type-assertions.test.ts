import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noChainedTypeAssertionsRule } from "./no-chained-type-assertions.ts";

/** Exercise chained assertion detection through Oxlint's native TypeScript AST. */
test("reports only the outer non-const assertion chain", () => {
  new RuleTester().run("no-chained-type-assertions", noChainedTypeAssertionsRule, {
    valid: [
      {
        filename: "single-as.ts",
        code: "declare const value: unknown; const result = value as string;",
      },
      {
        filename: "single-angle.ts",
        code: "declare const value: unknown; const result = <string>value;",
      },
      {
        filename: "parenthesized-single.ts",
        code: "declare const value: unknown; const result = (((value as string)));",
      },
      {
        filename: "const-assertions.ts",
        code: `const tuple = [1, 2] as const;
const object = <const>{ value: 1 };
const nestedConst = ([1, 2] as const) as const;`,
      },
      {
        filename: "separate-assertions.ts",
        code: `declare const first: unknown;
declare const second: unknown;
const a = first as string;
const b = <number>second;`,
      },
      {
        filename: "interrupted-chains.ts",
        code: `declare const value: unknown;
declare function identity(input: unknown): unknown;
const member = (value as { field: unknown }).field as string;
const call = identity(value as string) as number;
const nonNull = (value as string)! as string;
const satisfies = (value as string) satisfies string;`,
      },
      {
        filename: "plain-javascript.js",
        code: "const result = value;",
      },
    ],
    invalid: [
      {
        filename: "as-chain.ts",
        code: "declare const value: unknown; const result = value as unknown as string;",
        errors: [
          {
            message:
              "Chained type assertions discard existing type evidence and fabricate the target type without parsing. Preserve the value's original precise type, or parse genuinely unknown input at its boundary before using it.",
          },
        ],
        output: null,
      },
      {
        filename: "parenthesized-as-chain.ts",
        code: `declare const value: unknown;
const result = (
  value as unknown
) as string;`,
        errors: [
          {
            messageId: "chained",
            line: 2,
            column: 15,
            endLine: 4,
            endColumn: 11,
          },
        ],
        output: null,
      },
      {
        filename: "angle-chain.ts",
        code: "declare const value: unknown; const result = <string><unknown>value;",
        errors: [{ messageId: "chained" }],
        output: null,
      },
      {
        filename: "mixed-angle-as-chain.ts",
        code: "declare const value: unknown; const result = <string>(value as unknown);",
        errors: [{ messageId: "chained" }],
        output: null,
      },
      {
        filename: "mixed-as-angle-chain.ts",
        code: "declare const value: unknown; const result = (<unknown>value) as string;",
        errors: [{ messageId: "chained" }],
        output: null,
      },
      {
        filename: "triple-chain.ts",
        code: "declare const value: unknown; const result = ((value as unknown) as object) as Record<string, unknown>;",
        errors: [{ messageId: "chained" }],
        output: null,
      },
      {
        filename: "inner-const-chain.ts",
        code: "const result = ({ value: 1 } as const) as { readonly value: number };",
        errors: [{ messageId: "chained" }],
        output: null,
      },
      {
        filename: "outer-const-chain.ts",
        code: "declare const value: unknown; const result = (value as readonly number[]) as const;",
        languageOptions: { parserOptions: { ignoreNonFatalErrors: true } },
        errors: [{ messageId: "chained" }],
        output: null,
      },
      {
        filename: "comments-and-parentheses.ts",
        code: `declare const value: unknown;
const result = (((/* inner */ value as unknown))) /* outer */ as string;`,
        errors: [{ messageId: "chained" }],
        output: null,
      },
    ],
  });
});
