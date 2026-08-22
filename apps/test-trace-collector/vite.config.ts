import { defineConfig } from "vite-plus";

/** Defines the production trace collector deployment after shared Access infrastructure is ready. */
const testTraceCollectorViteConfig = defineConfig({
  run: {
    tasks: {
      "deploy:production": {
        cache: false,
        command: "alchemy deploy --stage production --yes",
        dependsOn: ["@overseer/shared-infrastructure#deploy:production"],
      },
      "destroy:production": {
        cache: false,
        command: "alchemy destroy --stage production",
      },
      "plan:production": {
        cache: false,
        command: "alchemy plan --stage production",
      },
      "test:e2e:local": {
        cache: false,
        command: "node scripts/run-e2e.ts local",
      },
      "test:e2e:preview": {
        cache: false,
        command: "node scripts/run-e2e.ts preview",
        dependsOn: ["@overseer/shared-infrastructure#deploy:production"],
      },
    },
  },
});

export default testTraceCollectorViteConfig;
