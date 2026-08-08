import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { noRecordTypeRule } from "./no-record-type.ts";

/** Exercise Record rejection across broad and apparently specific key types. */
test("requires schema-derived or owner-provided data shapes instead of Record", () => {
  new RuleTester().run("no-record-type", noRecordTypeRule, {
    valid: [
      {
        filename: "src/domain/workspace.ts",
        code: "interface WorkspaceNames { readonly primary: WorkspaceName; readonly archive: WorkspaceName }",
      },
      {
        filename: "src/io/stored-workspace.ts",
        code: "type StoredWorkspace = typeof StoredWorkspaceSchema.Encoded;",
      },
      {
        filename: "src/vendor/library.ts",
        code: "type VendorRecord = Vendor.Record<string>;",
      },
    ],
    invalid: [
      {
        filename: "src/io/unparsed.ts",
        code: "type Unparsed = Record<string, unknown>;",
        errors: [{ messageId: "recordType" }],
        output: null,
      },
      {
        filename: "src/domain/messages.ts",
        code: "type Messages = Readonly<Record<FailureReason, string>>;",
        errors: [{ messageId: "recordType" }],
        output: null,
      },
      {
        filename: "src/domain/names.ts",
        code: 'const names: Record<"first" | "last", string> = values;',
        errors: [{ messageId: "recordType" }],
        output: null,
      },
    ],
  });
});
