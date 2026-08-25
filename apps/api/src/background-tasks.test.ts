import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeBackgroundTasks } from "./background-tasks.ts";

it.effect("registers preconstructed and lazily constructed background Effects", () =>
  Effect.gen(function* () {
    let constructedTasks = 0;
    let completedTasks = 0;
    const backgroundTasks = makeBackgroundTasks(<R>(task: Effect.Effect<void, never, R>) => task);

    const preconstructedTask = Effect.sync(() => {
      completedTasks += 1;
    });
    const lazyTask = backgroundTasks.runInBackground(() => {
      constructedTasks += 1;
      return Effect.sync(() => {
        completedTasks += 1;
      });
    });

    assert.strictEqual(constructedTasks, 0);
    assert.strictEqual(completedTasks, 0);

    yield* backgroundTasks.registerBackgroundTask(preconstructedTask);
    assert.strictEqual(constructedTasks, 0);
    assert.strictEqual(completedTasks, 1);

    yield* lazyTask;
    assert.strictEqual(constructedTasks, 1);
    assert.strictEqual(completedTasks, 2);
  }),
);
