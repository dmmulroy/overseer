import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Clock, Crypto, Effect, Exit, Runtime, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

class TestTraceCollectorEndToEndCommandFailed extends Schema.TaggedError<TestTraceCollectorEndToEndCommandFailed>()(
  "TestTraceCollectorEndToEndCommandFailed",
  {
    command: Schema.Literals(["alchemy destroy", "vp test"]),
    exitCode: Schema.Number,
  },
) {
  override readonly [Runtime.errorReported] = false;

  override get [Runtime.errorExitCode](): number {
    return this.exitCode;
  }

  override get message(): string {
    return `Test trace collector E2E ${this.command} command failed with exit code ${this.exitCode}.`;
  }
}

const TestTraceCollectorEndToEndTarget = Schema.Literals(["local", "preview"]);
type TestTraceCollectorEndToEndTarget = typeof TestTraceCollectorEndToEndTarget.Type;

const makeTestTraceCollectorStage = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const entropy = (yield* crypto.randomUUIDv4).replaceAll("-", "").slice(0, 12);
  const timestamp = (yield* Clock.currentTimeMillis).toString(36);
  return `test-trace-${timestamp}-${entropy}`;
});

const runTestTraceCollectorCommand = Effect.fn("runTestTraceCollectorCommand")(function* (
  name: "alchemy destroy" | "vp test",
  command: ChildProcess.Command,
) {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* childProcessSpawner.exitCode(command);
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* Effect.fail(
      new TestTraceCollectorEndToEndCommandFailed({ command: name, exitCode }),
    );
  }
});

const runTestTraceCollectorEndToEndTests = Effect.fn("runTestTraceCollectorEndToEndTests")(
  function* (target: TestTraceCollectorEndToEndTarget) {
    const stage = yield* makeTestTraceCollectorStage;
    const environment = {
      ALCHEMY_DEV: target === "local" ? "true" : "false",
      ALCHEMY_TEST_STAGE: stage,
      TEST_TRACE_COLLECTOR_TARGET: target,
    } as const;

    const runTests = runTestTraceCollectorCommand(
      "vp test",
      ChildProcess.make("vp", ["test", "run", "test/access.e2e.test.ts"], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        extendEnv: true,
        env: environment,
      }),
    );
    const destroyTestStack = runTestTraceCollectorCommand(
      "alchemy destroy",
      ChildProcess.make("alchemy", ["destroy", "--yes", "--stage", stage, "alchemy.run.ts"], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        extendEnv: true,
        env: environment,
      }),
    );

    return yield* runTests.pipe(
      Effect.onExit((testExit) =>
        target === "local" || Exit.isFailure(testExit)
          ? Effect.ignore(destroyTestStack)
          : Effect.void,
      ),
    );
  },
);

if (import.meta.main) {
  const main = Effect.gen(function* () {
    const target = yield* Schema.decodeUnknownEffect(TestTraceCollectorEndToEndTarget)(
      process.argv[2],
    );
    yield* runTestTraceCollectorEndToEndTests(target);
  }).pipe(Effect.provide(NodeServices.layer));

  NodeRuntime.runMain(main);
}
