import { defineConfig } from "vite-plus";

/** Defines the production API deployment after its shared Cloudflare infrastructure is ready. */
const overseerApiViteConfig = defineConfig({
  run: {
    tasks: {
      "plan:production": {
        cache: false,
        command: "alchemy plan --stage production",
        dependsOn: ["@overseer/shared-infrastructure#plan:production"],
      },
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
        dependsOn: ["@overseer/shared-infrastructure#deploy:production"],
      },
      "test:e2e:local": {
        cache: false,
        command: "node scripts/run-e2e.ts local",
        dependsOn: ["@overseer/shared-infrastructure#deploy:production"],
      },
    },
  },
});

export default overseerApiViteConfig;
