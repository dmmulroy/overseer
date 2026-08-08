import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "overseer", specifier: "./tools/oxlint/overseer-option-plugin.ts" },
      { name: "type-provenance", specifier: "./tools/oxlint/type-provenance-plugin.ts" },
    ],
    rules: {
      "overseer/no-conditional-empty-object-spread": "error",
      "overseer/no-shape-in-symbol-names": "error",
      "overseer/require-option-for-optional-values": "error",
      "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/no-unsafe-type-assertion": "error",
      "type-provenance/no-chained-type-assertions": "error",
      "type-provenance/no-known-value-widening": "error",
      "type-provenance/no-record-type": "error",
      "type-provenance/no-runtime-typeof": "error",
      "type-provenance/no-unknown-parameters": "error",
      "type-provenance/no-widen-then-assert": "error",
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
