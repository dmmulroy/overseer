import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noKnownValueWideningRule } from "./no-known-value-widening.ts";

function wideningError(subject: string, target: string, line?: number) {
  const diagnostic = { messageId: "widening", data: { subject, target } };
  return line === undefined ? diagnostic : { ...diagnostic, line };
}

/** Exercise known value widening detection through Oxlint's JavaScript plugin harness. */
test("reports only syntactically established values flowing to explicit broad types", () => {
  new RuleTester().run("no-known-value-widening", noKnownValueWideningRule, {
    valid: [
      {
        filename: "src/unknown-input.ts",
        code: "declare const input: unknown; const retained: unknown = input;",
      },
      {
        filename: "src/boundary.ts",
        code: "function retainBoundary(input: unknown): unknown { return input; }",
      },
      {
        filename: "src/external-boundary.ts",
        code: "declare function sendBoundary(input: unknown): void; const known = { id: 1 }; sendBoundary(known);",
      },
      {
        filename: "src/parser-call.ts",
        code: `function parseInput(input: unknown): string { return String(input); }
const parseRecord = (input: Record<string, unknown>): string => JSON.stringify(input);
parseInput("known");
parseRecord({ id: 1 });`,
      },
      {
        filename: "src/call-result.ts",
        code: "declare function loadValue(): { id: number }; const result: unknown = loadValue();",
      },
      {
        filename: "src/imported-value.ts",
        code: 'import { value } from "library"; const retained: object = value;',
      },
      {
        filename: "src/precise.ts",
        code: "const value: { id: number } = { id: 1 }; function retain(): { id: number } { return value; }",
      },
      {
        filename: "src/specific-record.ts",
        code: 'const value: Record<"id", unknown> = { id: 1 };',
      },
      {
        filename: "src/non-record-object.ts",
        code: "const values: Record<string, unknown> = [];",
      },
      {
        filename: "src/mutable-provenance.ts",
        code: "let source = { id: 1 }; source = { id: 2 }; const retained: unknown = source;",
      },
      {
        filename: "src/shadowed-record.ts",
        code: "type Record<Key, Value> = { key: Key; value: Value }; const retained: Record<string, unknown> = { key: 'id', value: 1 };",
      },
      {
        filename: "src/imported-alias.ts",
        code: 'import type { GenericRecord } from "library"; const retained: GenericRecord = { id: 1 };',
      },
      {
        filename: "src/imported-record.ts",
        code: 'import type { Record } from "library"; const retained: Record<string, unknown> = { id: 1 };',
      },
    ],
    invalid: [
      {
        filename: "src/unknown-initializers.ts",
        code: `const literal: unknown = 1;
const objectValue: unknown = { id: 1 };
const arrayValue: unknown = [1, 2];`,
        errors: [
          {
            message:
              "The known initializer supplying binding `literal` carries established type evidence, but the explicit broad unknown target type discards it. Remove the broad annotation and preserve the inferred or owner-provided type. If this value is genuinely external, parse it once at the boundary instead.",
            line: 1,
          },
          wideningError("binding `objectValue`", "unknown", 2),
          wideningError("binding `arrayValue`", "unknown", 3),
        ],
        output: null,
      },
      {
        filename: "src/object-initializers.ts",
        code: `const objectValue: object = { id: 1 };
const constructed: object = new Date();
const callable: object = () => 1;`,
        errors: [
          wideningError("binding `objectValue`", "object", 1),
          wideningError("binding `constructed`", "object", 2),
          wideningError("binding `callable`", "object", 3),
        ],
        output: null,
      },
      {
        filename: "src/record-initializers.ts",
        code: `const direct: Record<string, unknown> = { id: 1 };
const readonlyValue: Readonly<Record<string, unknown>> = { id: 1 };
const indexed: { [key: string]: unknown } = { id: 1 };
const mapped: { [key in string]: unknown } = { id: 1 };`,
        errors: [
          wideningError("binding `direct`", "generic record", 1),
          wideningError("binding `readonlyValue`", "generic record", 2),
          wideningError("binding `indexed`", "generic record", 3),
          wideningError("binding `mapped`", "generic record", 4),
        ],
        output: null,
      },
      {
        filename: "src/record-aliases.ts",
        code: `type GenericRecord<Value = unknown> = Record<string, Value>;
type Metadata = GenericRecord;
type Parenthesized = Readonly<(Metadata)>;
const first: GenericRecord<unknown> = { id: 1 };
const second: Metadata = { id: 2 };
const third: Parenthesized = { id: 3 };`,
        errors: [
          wideningError("binding `first`", "generic record", 4),
          wideningError("binding `second`", "generic record", 5),
          wideningError("binding `third`", "generic record", 6),
        ],
        output: null,
      },
      {
        filename: "src/known-identifier.ts",
        code: `const established = { id: 1 };
const alias = established;
const retained: unknown = alias;`,
        errors: [wideningError("binding `retained`", "unknown", 3)],
        output: null,
      },
      {
        filename: "src/assignment.ts",
        code: `let destination: unknown;
const established = { id: 1 };
destination = established;`,
        errors: [wideningError("binding `destination`", "unknown", 3)],
        output: null,
      },
      {
        filename: "src/property.ts",
        code: "class Container { value: object = { id: 1 }; accessor metadata: Record<string, unknown> = { id: 2 }; }",
        errors: [
          wideningError("property `value`", "object"),
          wideningError("property `metadata`", "generic record"),
        ],
        output: null,
      },
      {
        filename: "src/return.ts",
        code: `const established = { id: 1 };
function returnUnknown(): unknown { return established; }
const returnObject = (): object => ({ id: 2 });`,
        errors: [
          wideningError("return value of `returnUnknown`", "unknown", 2),
          wideningError("return value of `returnObject`", "object", 3),
        ],
        output: null,
      },
      {
        filename: "src/asserted-source.ts",
        code: "const retained: unknown = ({ id: 1 } as const);",
        errors: [wideningError("binding `retained`", "unknown")],
        output: null,
      },
    ],
  });
});
