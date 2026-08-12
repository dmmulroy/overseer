import { RuleTester } from "oxlint/plugins-dev";
import { test } from "vite-plus/test";
import { requireOptionForOptionalValuesRule } from "./overseer-option-plugin.ts";

const optionImport = 'import * as Option from "effect/Option";';

/** Exercise the Option rule through Oxlint's native JavaScript plugin harness. */
test("requires Option only on inner domain and application declaration surfaces", () => {
  new RuleTester().run("require-option-for-optional-values", requireOptionForOptionalValuesRule, {
    valid: [
      {
        filename: "src/domain/issue.ts",
        code: `${optionImport}\ntype Issue = { body: Option.Option<string> };`,
      },
      {
        filename: "src/application/find-issue.ts",
        code: `${optionImport}\ndeclare const findIssue: (id: string) => Option.Option<string>;`,
      },
      {
        filename: "src/domain/nullish-type-utility.ts",
        code: "type Nullish = string | null | undefined;",
      },
      {
        filename: "src/domain/generated/client.generated.ts",
        code: "type Generated = { value?: string | null };",
      },
      {
        filename: "src/domain/issue.test.ts",
        code: "type Fixture = { body?: string | null };",
      },
      {
        filename: "src/domain/fixtures/issue.ts",
        code: "type Fixture = { body?: string | null };",
      },
      {
        filename: "src/application/http/issue-response.ts",
        code: "type IssueResponse = { body: string | null };",
      },
      {
        filename: "src/application/generated-source.ts",
        code: "// @generated\ntype Generated = { body?: string | null };",
      },
      {
        filename: "src/shared/platform-value.ts",
        code: "type PlatformValue = { value?: string | null };",
      },
      {
        filename: "src/domain/ambient.d.ts",
        code: "interface AmbientContract { value?: string | undefined }",
      },
    ],
    invalid: [
      {
        filename: "src/domain/issue.ts",
        code: "type Issue = { body: string | null };",
        errors: [{ messageId: "nullishUnion" }],
        output: null,
      },
      {
        filename: "src/domain/issue-metadata.ts",
        code: "type IssueMetadata = { labels?: ReadonlyArray<string> };",
        errors: [{ messageId: "optionalMarker" }],
        output: null,
      },
      {
        filename: "src/application/find-issue.ts",
        code: "const findIssue = (owner?: string): Promise<string | undefined> => Promise.resolve(owner);",
        errors: [{ messageId: "optionalMarker" }, { messageId: "nullishUnion" }],
        output: null,
      },
      {
        filename: "src/application/issue-repository.ts",
        code: "interface IssueRepository { find(id: string | null): string | undefined; cached?: boolean }",
        errors: [
          { messageId: "nullishUnion" },
          { messageId: "nullishUnion" },
          { messageId: "optionalMarker" },
        ],
        output: null,
      },
      {
        filename: "src/domain/issue-class.ts",
        code: "class Issue { body?: string; parentId: string | null = null }",
        errors: [{ messageId: "optionalMarker" }, { messageId: "nullishUnion" }],
        output: null,
      },
      {
        filename: "src/domain/issue-loader.ts",
        code: "type IssueLoader = (id: string | undefined) => Promise<string | null>;",
        errors: [{ messageId: "nullishUnion" }, { messageId: "nullishUnion" }],
        output: null,
      },
    ],
  });
});
