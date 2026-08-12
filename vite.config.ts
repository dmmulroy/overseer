import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop-plugin.ts" },
      { name: "overseer", specifier: "./tools/oxlint/overseer-option-plugin.ts" },
    ],
    rules: {
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-record-type": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-widen-then-assert": "error",
      "overseer/require-option-for-optional-values": "error",
      "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/no-unsafe-type-assertion": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
    tasks: {
      "generate:openapi": {
        command: ["node apps/api/scripts/generate-openapi.ts", "vp fmt apps/api/openapi.json"],
        output: ["apps/api/openapi.json"],
      },
      "sync:yaak": {
        command: "node apps/api/scripts/sync-yaak-openapi.ts",
        dependsOn: ["generate:openapi"],
        input: ["apps/api/openapi.json", "apps/api/scripts/sync-yaak-openapi.ts"],
        output: [],
      },
    },
  },
});
