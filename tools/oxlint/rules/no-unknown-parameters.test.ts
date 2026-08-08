import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

/** Exercise unknown parameter rejection while allowing direct Effect Schema decoders. */
test("requires unknown input to enter through an Effect Schema decoder", () => {
  new RuleTester().run("no-unknown-parameters", noUnknownParametersRule, {
    valid: [
      {
        filename: "src/io/create-workspace-request.ts",
        code: "const parseCreateWorkspaceRequest = Schema.decodeUnknownEffect(CreateWorkspaceRequest);",
      },
      {
        filename: "src/domain/workspace.ts",
        code: "const renameWorkspace = (name: WorkspaceName): Workspace => workspace;",
      },
      {
        filename: "src/io/vendor.ts",
        code: "declare const vendorCallback: VendorUnknownCallback;",
      },
    ],
    invalid: [
      {
        filename: "src/io/create-workspace-request.ts",
        code: "const parseRequest = (input: unknown) => Schema.decodeUnknownEffect(CreateWorkspaceRequest)(input);",
        errors: [{ messageId: "unknownParameter", data: { parameter: "input" } }],
        output: null,
      },
      {
        filename: "src/application/workspace.ts",
        code: "function createWorkspace(input: unknown): void {}",
        errors: [{ messageId: "unknownParameter", data: { parameter: "input" } }],
        output: null,
      },
      {
        filename: "src/application/service.ts",
        code: "interface Service { execute(input: unknown): void; }",
        errors: [{ messageId: "unknownParameter", data: { parameter: "input" } }],
        output: null,
      },
      {
        filename: "src/application/function.ts",
        code: "type Handler = (payload: unknown) => void;",
        errors: [{ messageId: "unknownParameter", data: { parameter: "payload" } }],
        output: null,
      },
    ],
  });
});
