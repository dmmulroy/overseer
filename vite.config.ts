import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "overseer", specifier: "./tools/oxlint/overseer-option-plugin.ts" },
    ],
    rules: {
      "overseer/no-conditional-empty-object-spread": "error",
      "overseer/no-shape-in-symbol-names": "error",
      "overseer/require-option-for-optional-values": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
