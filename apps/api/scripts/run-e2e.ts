import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { pathToFileURL } from "node:url";
import { Schema } from "effect";
import {
  OverseerTestTarget,
  type OverseerTestTarget as OverseerTestTargetValue,
  TestRun,
} from "../test/e2e/overseer-test-run.ts";

const forwardedSignals: ReadonlyArray<NodeJS.Signals> = ["SIGINT", "SIGTERM", "SIGHUP"];

interface ChildProcessOutcome {
  readonly code: number;
  readonly signal: NodeJS.Signals | undefined;
}

/** Generates a unique, test-only Alchemy stage for the selected target. */
export const makeOverseerTestRun = (target: OverseerTestTargetValue): TestRun => {
  const entropy = randomUUID().replaceAll("-", "").slice(0, 12);
  const timestamp = Date.now().toString(36);
  const username = userInfo()
    .username.toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 12);
  const stageOwner = username.length === 0 ? "user" : username;
  return Schema.decodeUnknownSync(TestRun)({
    target,
    stage: `test-${stageOwner}-${timestamp}-${entropy}`,
  });
};

const waitForChildProcess = (child: ChildProcess): Promise<ChildProcessOutcome> =>
  new Promise((complete) => {
    child.once("error", (error) => {
      console.error("Overseer E2E runner failed to start a child process:", error);
      complete({ code: 1, signal: undefined });
    });
    child.once("exit", (code, signal) => {
      complete({ code: code ?? 1, signal: signal ?? undefined });
    });
  });

const runOverseerEndToEndTests = async (target: OverseerTestTargetValue): Promise<number> => {
  const testRun = makeOverseerTestRun(target);

  const testProcess = spawn("vp", ["test", "run", "test/e2e.test.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ALCHEMY_DEV: target === "local" ? "true" : "false",
      ALCHEMY_TEST_STAGE: testRun.stage,
      OVERSEER_TEST_TARGET: testRun.target,
      OVERSEER_TEST_STAGE: testRun.stage,
    },
  });

  let forwardedSignal: NodeJS.Signals | undefined;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of forwardedSignals) {
    const handler = () => {
      forwardedSignal ??= signal;
      testProcess.kill(signal);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  const testOutcome = await waitForChildProcess(testProcess);
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }

  const needsOuterCleanup =
    target === "local" ||
    forwardedSignal !== undefined ||
    testOutcome.signal !== undefined ||
    testOutcome.code !== 0;
  const destroyOutcome = needsOuterCleanup
    ? await waitForChildProcess(
        spawn("alchemy", ["destroy", "--yes", "--stage", testRun.stage, "alchemy.run.ts"], {
          stdio: "inherit",
          env: {
            ...process.env,
            ALCHEMY_DEV: target === "local" ? "true" : "false",
          },
        }),
      )
    : { code: 0, signal: undefined };

  if (forwardedSignal !== undefined || testOutcome.signal !== undefined) {
    const signal = forwardedSignal ?? testOutcome.signal;
    return signal === "SIGINT" ? 130 : 143;
  }
  if (testOutcome.code !== 0) return testOutcome.code;
  return destroyOutcome.code;
};

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  const target = Schema.decodeUnknownSync(OverseerTestTarget)(process.argv[2]);
  process.exitCode = await runOverseerEndToEndTests(target);
}
