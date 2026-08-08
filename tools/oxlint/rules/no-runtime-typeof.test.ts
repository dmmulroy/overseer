import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noRuntimeTypeofRule } from "./no-runtime-typeof.ts";

/** Exercise runtime typeof rejection without rejecting TypeScript type queries. */
test("requires schema parsing instead of runtime typeof narrowing", () => {
  new RuleTester().run("no-runtime-typeof", noRuntimeTypeofRule, {
    valid: [
      {
        filename: "src/domain/workspace.ts",
        code: "const Workspace = Schema.Struct({ id: Schema.String }); type Workspace = typeof Workspace.Type;",
      },
      {
        filename: "src/io/parse-workspace.ts",
        code: "const parseWorkspace = Schema.decodeUnknownEffect(Workspace);",
      },
      {
        filename: "src/domain/error.ts",
        code: "const unavailable = error instanceof Error;",
      },
    ],
    invalid: [
      {
        filename: "src/io/workspace.ts",
        code: 'const isString = typeof input === "string";',
        errors: [{ messageId: "runtimeTypeof" }],
        output: null,
      },
      {
        filename: "src/io/workspace.ts",
        code: 'if (typeof payload === "object") consume(payload);',
        errors: [{ messageId: "runtimeTypeof" }],
        output: null,
      },
    ],
  });
});
