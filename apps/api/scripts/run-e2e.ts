import { resolve } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { makeTestRunIdFromStage } from "@overseer/test-trace-protocol";
import { Clock, Config, Crypto, Effect, Exit, Runtime, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  LocalTestRunStorageDirectory,
  localTestRunStorageDirectoryConfig,
} from "../test/e2e/evidence/test-run-storage-local.ts";
import {
  OverseerTestTarget,
  type OverseerTestTarget as OverseerTestTargetValue,
  TestRun,
} from "../test/e2e/overseer-test-run.ts";

class OverseerEndToEndCommandFailed extends Schema.TaggedError<OverseerEndToEndCommandFailed>()(
  "OverseerEndToEndCommandFailed",
  {
    command: Schema.Literals(["alchemy destroy", "vp test"]),
    exitCode: Schema.Number,
  },
) {
  readonly [Runtime.errorReported] = false;

  get [Runtime.errorExitCode](): number {
    return this.exitCode;
  }

  override get message(): string {
    return `Overseer E2E ${this.command} command failed with exit code ${this.exitCode}.`;
  }
}

/** Selects the absolute local evidence directory owned by the E2E runner. */
export const makeOverseerEvidenceDirectory = (
  workingDirectory: string,
): LocalTestRunStorageDirectory =>
  LocalTestRunStorageDirectory.make(resolve(workingDirectory, ".overseer", "evidence"));

/** Generates a unique, test-only Alchemy stage for the selected target. */
export const makeOverseerTestRun = Effect.fn("makeOverseerTestRun")(function* (
  target: OverseerTestTargetValue,
) {
  const crypto = yield* Crypto.Crypto;
  const entropy = (yield* crypto.randomUUIDv4).replaceAll("-", "").slice(0, 12);
  const timestamp = (yield* Clock.currentTimeMillis).toString(36);

  return yield* Schema.decodeEffect(TestRun)({
    target,
    stage: `test-${timestamp}-${entropy}`,
  });
});

const runOverseerCommand = Effect.fn("runOverseerCommand")(function* (
  name: "alchemy destroy" | "vp test",
  command: ChildProcess.Command,
) {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* childProcessSpawner.exitCode(command);
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* Effect.fail(new OverseerEndToEndCommandFailed({ command: name, exitCode }));
  }
});

const runOverseerEndToEndTests = Effect.fn("runOverseerEndToEndTests")(function* (
  target: OverseerTestTargetValue,
) {
  const testRun = yield* makeOverseerTestRun(target);
  const evidenceDirectory = yield* localTestRunStorageDirectoryConfig.pipe(
    Config.withDefault(makeOverseerEvidenceDirectory(process.cwd())),
  );
  const alchemyDev = target === "local" ? "true" : "false";

  const runTests = runOverseerCommand(
    "vp test",
    ChildProcess.make("vp", ["test", "run", "test/e2e.test.ts"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      extendEnv: true,
      env: {
        ALCHEMY_DEV: alchemyDev,
        ALCHEMY_TEST_STAGE: testRun.stage,
        OVERSEER_TEST_TARGET: testRun.target,
        OVERSEER_TEST_STAGE: testRun.stage,
        OVERSEER_TEST_RUN_ID: makeTestRunIdFromStage(testRun.stage),
        OVERSEER_EVIDENCE_DIRECTORY: evidenceDirectory,
      },
    }),
  );

  const destroyTestStack = runOverseerCommand(
    "alchemy destroy",
    ChildProcess.make("alchemy", ["destroy", "--yes", "--stage", testRun.stage, "alchemy.run.ts"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      extendEnv: true,
      env: { ALCHEMY_DEV: alchemyDev },
    }),
  );

  return yield* runTests.pipe(
    Effect.onExit((testExit) => {
      if (target !== "local" && Exit.isSuccess(testExit)) return Effect.void;
      return Exit.isFailure(testExit) ? Effect.ignore(destroyTestStack) : destroyTestStack;
    }),
  );
});

if (import.meta.main) {
  const terminationSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  let receivedTerminationSignal: (typeof terminationSignals)[number] | undefined;
  const interruptOnTerminationSignal = Effect.callback<never>((resume) => {
    const signalHandlers = new Map<(typeof terminationSignals)[number], () => void>();
    for (const signal of terminationSignals) {
      const handler = () => {
        if (receivedTerminationSignal !== undefined) return;
        receivedTerminationSignal = signal;
        resume(Effect.interrupt);
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    return Effect.sync(() => {
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
    });
  });

  const main = Effect.gen(function* () {
    const target = yield* Schema.decodeUnknownEffect(OverseerTestTarget)(process.argv[2]);
    yield* runOverseerEndToEndTests(target);
  }).pipe(Effect.provide(NodeServices.layer), Effect.raceFirst(interruptOnTerminationSignal));

  NodeRuntime.runMain(main, {
    teardown: (exit, onExit) => {
      switch (receivedTerminationSignal) {
        case "SIGHUP":
          return onExit(129);
        case "SIGINT":
          return onExit(130);
        case "SIGTERM":
          return onExit(143);
        case undefined:
          return Runtime.defaultTeardown(exit, onExit);
      }
    },
  });
}
