import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/browser.test.ts"],
    testTimeout: 5_000,
  },
});
