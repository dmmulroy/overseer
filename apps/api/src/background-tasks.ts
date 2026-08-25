import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Context, Effect, Layer } from "effect";

/** Application-owned capability for registering bounded work after an invocation returns. */
export interface IBackgroundTasks {
  /** Register a preconstructed, non-failing Effect for background execution. */
  readonly registerBackgroundTask: <R>(
    task: Effect.Effect<void, never, R>,
  ) => Effect.Effect<void, never, R>;

  /** Construct and register a non-failing Effect when background execution begins. */
  readonly runInBackground: <R>(
    task: () => Effect.Effect<void, never, R>,
  ) => Effect.Effect<void, never, R>;
}

/** Provides background task registration without exposing a Cloudflare execution context. */
export class BackgroundTasks extends Context.Service<BackgroundTasks, IBackgroundTasks>()(
  "@overseer/BackgroundTasks",
) {}

/**
 * Constructs background task registration from the runtime operation that owns detached work.
 *
 * The supplied Effects must have already handled their expected failures because completion happens
 * after the invoking handler can observe the result.
 */
export const makeBackgroundTasks = (
  registerBackgroundTask: IBackgroundTasks["registerBackgroundTask"],
): BackgroundTasks["Service"] =>
  BackgroundTasks.of({
    registerBackgroundTask,
    runInBackground: (task) => registerBackgroundTask(Effect.suspend(task)),
  });

/** Provides background tasks through the current Cloudflare Worker invocation. */
export const workerBackgroundTasksLayer: Layer.Layer<
  BackgroundTasks,
  never,
  Cloudflare.WorkerExecutionContext | RuntimeContext
> = Layer.effect(
  BackgroundTasks,
  Effect.gen(function* () {
    const executionContext = yield* Cloudflare.WorkerExecutionContext;
    const runtimeContext = yield* RuntimeContext;

    return makeBackgroundTasks((task) =>
      executionContext.waitUntil(task).pipe(Effect.provideService(RuntimeContext, runtimeContext)),
    );
  }),
);

/** Provides background tasks through the current Cloudflare Durable Object invocation. */
export const durableObjectBackgroundTasksLayer: Layer.Layer<
  BackgroundTasks,
  never,
  Cloudflare.DurableObjectState | RuntimeContext
> = Layer.effect(
  BackgroundTasks,
  Effect.gen(function* () {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    const runtimeContext = yield* RuntimeContext;

    return makeBackgroundTasks((task) =>
      durableObjectState
        .waitUntil(task)
        .pipe(Effect.provideService(RuntimeContext, runtimeContext)),
    );
  }),
);
