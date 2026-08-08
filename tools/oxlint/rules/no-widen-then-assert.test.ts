import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noWidenThenAssertRule } from "./no-widen-then-assert.ts";

const error = { messageId: "widenThenAssert", data: { name: "widened" } } as const;

/** Exercise conservative local widening dataflow through Oxlint's native scope manager. */
test("bans widening a known local value before asserting the binding narrower", () => {
  new RuleTester().run("no-widen-then-assert", noWidenThenAssertRule, {
    valid: [
      {
        filename: "value.ts",
        code: "declare const input: unknown; const widened: unknown = input; widened as string;",
      },
      {
        filename: "value.ts",
        code: "declare function load(): unknown; const widened: unknown = load(); widened as string;",
      },
      {
        filename: "value.ts",
        code: "const value = 'known'; const preserved = value; preserved as string;",
      },
      {
        filename: "value.ts",
        code: "let widened: unknown = 'known'; widened as string;",
      },
      {
        filename: "value.ts",
        code: "const widened: unknown = 'known'; widened as unknown; widened as any;",
      },
      {
        filename: "value.ts",
        code: "const widened: object = {}; widened as string;",
      },
      {
        filename: "value.ts",
        code: "const widened: Record<string, unknown> = {}; widened as NamedRecord;",
      },
      {
        filename: "value.ts",
        code: `type User = { id: string };
const user: User = { id: "one" };
const widened: unknown = user;
const readLater = () => widened as User;`,
      },
      {
        filename: "value.ts",
        code: `type User = { id: string };
const user: User = { id: "one" };
const readLater = () => {
  const widened: unknown = user;
  return widened as User;
};`,
      },
      {
        filename: "value.ts",
        code: `const widened: unknown = "known";
// Invalid TypeScript can reassign a const, so the syntactic rule conservatively stops tracking it.
widened = external;
widened as string;`,
      },
      {
        filename: "value.ts",
        code: `const value: unknown = "known";
const widened: unknown = value;
widened as string;`,
      },
      {
        filename: "value.ts",
        code: `const widened: unknown = external;
widened as string;`,
      },
      {
        filename: "value.ts",
        code: `const widened: unknown = "known";
{
  const widened = "preserved";
  widened as string;
}`,
      },
      {
        filename: "value.ts",
        code: `type BroadMap = Record<string, unknown>;
const widened: BroadMap = { id: "one" };
widened as { id: string };`,
      },
    ],
    invalid: [
      {
        filename: "value.ts",
        code: "const widened: unknown = 'known'; widened as string;",
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: "const payload: unknown = 'known'; payload as string;",
        errors: [
          {
            message:
              'Binding "payload" erases established type evidence by widening the value, then reconstructs that evidence with a type assertion. Preserve the precise type end-to-end; if the input is genuinely unknown, parse it once at the boundary instead.',
          },
        ],
        output: null,
      },
      {
        filename: "value.ts",
        code: "const widened: any = 42; widened as number;",
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: "const widened = ('known' as unknown); (widened) as string;",
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: "const widened = <unknown>({ id: 'one' }); <{ id: string }>(widened);",
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: "const widened: (unknown) = (((true))); (((widened))) as boolean;",
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: `type User = { id: string };
function read(user: User) {
  const widened: unknown = user;
  return widened as User;
}`,
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: `type User = { id: string };
const original: User = { id: "one" };
const alias = original;
const widened: object = alias;
const restored = widened as User;`,
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: "const widened: object = { id: 'one' }; widened as { id: string };",
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: `const widened: Record<string, unknown> = { id: "one" };
widened as { id: string };`,
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: `const widened: { [key: string]: unknown } = { id: "one" };
widened as { id: string };`,
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: `const widened: Readonly<Record<string, unknown>> = { id: "one" };
widened as Readonly<Record<string, string>>;`,
        errors: [error],
        output: null,
      },
      {
        filename: "value.ts",
        code: `function read() {
  const widened = [1, 2] as unknown;
  if (widened !== null) {
    return widened as readonly number[];
  }
}`,
        errors: [error],
        output: null,
      },
    ],
  });
});
