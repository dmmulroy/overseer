import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
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
    return { url: collector.url };
  }).pipe(Effect.provide(testTraceCollectorWorkerLayer)),
);
