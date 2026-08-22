import { defineConfig } from "vite-plus";

/** Defines uncached Vite Tasks for the Overseer shared infrastructure lifecycle. */
const sharedInfrastructureViteConfig = defineConfig({
  run: {
    tasks: {
      "deploy:production": {
        cache: false,
        command: "alchemy deploy --stage production --yes",
      },
      "destroy:production": {
        cache: false,
        command: "alchemy destroy --stage production",
      },
      "plan:production": {
        cache: false,
        command: "alchemy plan --stage production",
      },
    },
  },
});

export default sharedInfrastructureViteConfig;
