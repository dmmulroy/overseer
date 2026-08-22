import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Option } from "effect";
import { TestTraceCollectorAccessDeployment } from "./src/test-trace-collector-access.ts";
import testTraceCollectorWorkerLayer, {
  TestTraceCollectorWorker,
} from "./src/test-trace-collector-worker.ts";

/** Deploys the persistent standalone test trace collector infrastructure. */
export default Alchemy.Stack(
  "OverseerTestTraceCollector",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const collector = yield* TestTraceCollectorWorker;
    const access = yield* TestTraceCollectorAccessDeployment;

    return Option.match(access, {
      onNone: () => ({ url: collector.url }),
      onSome: (application) => ({
        url: collector.url,
        accessAudience: application.aud,
      }),
    });
  }).pipe(Effect.provide(testTraceCollectorWorkerLayer)),
);
