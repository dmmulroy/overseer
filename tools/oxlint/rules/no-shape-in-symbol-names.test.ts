import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noForbiddenTermInSymbolNamesRule } from "./no-shape-in-symbol-names.ts";

/** Exercise strict, case-insensitive substring matching across JavaScript and TypeScript symbol names. */
test("bans shape in declarations, references, members, and private names", () => {
  new RuleTester().run("no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
    valid: [
      {
        filename: "src/domain/issue.ts",
        code: `const formFactory = { shap: "near miss", profile: "allowed" };
formFactory.profile;
formFactory["shape"];`,
      },
    ],
    invalid: [
      {
        filename: "src/domain/issue.ts",
        code: `type UserShape = Shape;
const Shape = 1;
Shape;`,
        errors: [
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
        ],
        output: null,
      },
      {
        filename: "src/domain/member.ts",
        code: `const object = { shape: 1, shapeFactory() { return this.shape; } };
object.shapeFactory();
object.shape;`,
        errors: [
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
        ],
        output: null,
      },
      {
        filename: "src/domain/component.tsx",
        code: `const value = 1;
<Shape shapeFactory={value} />;`,
        errors: [{ messageId: "forbiddenSymbolName" }, { messageId: "forbiddenSymbolName" }],
        output: null,
      },
      {
        filename: "src/domain/private.ts",
        code: `class User {
  #shape = 1;
  #shapeFactory() { return this.#shape; }
}`,
        errors: [
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
          { messageId: "forbiddenSymbolName" },
        ],
        output: null,
      },
    ],
  });
});
