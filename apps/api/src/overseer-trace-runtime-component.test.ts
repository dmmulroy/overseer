import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { withOverseerTraceRuntimeComponent } from "./overseer-trace-runtime-component.ts";

it.effect("annotates every nested span with its hosted runtime component", () =>
  withOverseerTraceRuntimeComponent(
    Effect.gen(function* () {
      const directAnnotations = yield* Effect.spanAnnotations;
      const nestedAnnotations = yield* Effect.spanAnnotations.pipe(Effect.withSpan("nested"));

      assert.strictEqual(
        directAnnotations["overseer.runtime.component"],
        "workspace-durable-object",
      );
      assert.strictEqual(
        nestedAnnotations["overseer.runtime.component"],
        "workspace-durable-object",
      );
    }),
    "workspace-durable-object",
  ).pipe(Effect.withSpan("server")),
);
