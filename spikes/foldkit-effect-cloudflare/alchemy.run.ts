import {
  DurableObject,
  Worker,
} from "alchemy/Cloudflare";

/** Alchemy declaration for the SQLite-backed Project Durable Object class. */
export const ProjectObjects = DurableObject(
  "EffectSqliteDurableObject",
  { className: "EffectSqliteDurableObject" },
);

/** Alchemy declaration proving the pinned package can bind the workerd fixture. */
export const Gateway = Worker<{
  readonly EFFECT_SQLITE_DO: typeof ProjectObjects;
}>("overseer-foldkit-effect-spike", {
  main: "./src/worker.ts",
  compatibility: { date: "2026-07-16" },
  env: {
    EFFECT_SQLITE_DO: ProjectObjects,
  },
});
