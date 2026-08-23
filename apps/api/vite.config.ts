import { defineConfig } from "vite-plus";

/** Defines the production API deployment after its shared Cloudflare infrastructure is ready. */
const overseerApiViteConfig = defineConfig({
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
      "test:e2e:deployed": {
        cache: false,
        command: "node scripts/run-e2e.ts deployed",
        dependsOn: ["@overseer/test-trace-collector#deploy:production"],
      },
      "test:e2e:local": {
        cache: false,
        command: "node scripts/run-e2e.ts local",
        dependsOn: ["@overseer/test-trace-collector#deploy:production"],
      },
    },
  },
});

export default overseerApiViteConfig;
