import { defineConfig } from "vitest/config";

/** Run Overseer's HTTP, browser, and workerd integration suites. */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
