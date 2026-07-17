import { Schema } from "effect";
import {
  IssueRead,
  type IssueRead as IssueReadValue,
} from "./project-data";

/** Browser connection hints that bound speculative reads. */
export type NetworkCondition = Readonly<{
  saveData: boolean;
  effectiveType: "slow-2g" | "2g" | "3g" | "4g";
}>;

/** One observable request lifecycle record used by the evidence runner. */
export type NetworkRecord = Readonly<{
  event: "started" | "completed" | "aborted" | "failed";
  issueNumber: number;
  priority: "active" | "background";
  at: number;
}>;

/** Parsed failure returned by the Issue HTTP adapter. */
export class IssueFetchFailure extends Error {
  readonly _tag = "IssueFetchFailure" as const;

  /** Classify one expected request failure. */
  constructor(
    readonly issueNumber: number,
    readonly reason: "aborted" | "http" | "decode" | "network",
    override readonly cause?: unknown,
  ) {
    super(`Issue ${issueNumber} fetch ${reason}`);
  }
}

/** Success-or-failure value returned by coordinated Issue reads. */
export type IssueFetchResult =
  | Readonly<{ _tag: "Fetched"; value: IssueReadValue }>
  | Readonly<{ _tag: "FetchFailed"; error: IssueFetchFailure }>;

/** Cancelable speculative request handle. */
export type PrefetchHandle = Readonly<{
  result: Promise<IssueFetchResult>;
  cancel: () => void;
}>;

/** Small interface hiding deduplication, cancellation, and priority policy. */
export type RequestCoordinator = Readonly<{
  prefetch: (issueNumber: number) => PrefetchHandle | undefined;
  requestActive: (issueNumber: number) => Promise<IssueFetchResult>;
  networkLog: () => ReadonlyArray<NetworkRecord>;
  clearNetworkLog: () => void;
  maxBackgroundConcurrency: () => number;
  dispose: () => void;
}>;

type Priority = "active" | "background";
type Entry = {
  readonly issueNumber: number;
  readonly controller: AbortController;
  readonly consumers: Set<symbol>;
  priority: Priority;
  started: boolean;
  settled: boolean;
  resolve: (result: IssueFetchResult) => void;
  readonly promise: Promise<IssueFetchResult>;
};

/** Whether viewport/idle speculation is allowed on a connection. */
export function allowsSpeculation(condition: NetworkCondition): boolean {
  return !condition.saveData && condition.effectiveType !== "2g" && condition.effectiveType !== "slow-2g";
}

/** Construct the priority-aware request coordinator around the browser fetch seam. */
export function makeRequestCoordinator(options: Readonly<{
  networkCondition: () => NetworkCondition;
  latencyMs: () => number;
}>): RequestCoordinator {
  const entries = new Map<number, Entry>();
  const backgroundQueue: Array<Entry> = [];
  const records: Array<NetworkRecord> = [];
  let runningBackground = 0;
  let disposed = false;

  const maxBackgroundConcurrency = (): number =>
    options.networkCondition().effectiveType === "3g" ? 1 : 2;

  const record = (entry: Entry, event: NetworkRecord["event"]): void => {
    records.push({
      event,
      issueNumber: entry.issueNumber,
      priority: entry.priority,
      at: performance.now(),
    });
  };

  const finish = (entry: Entry, result: IssueFetchResult): void => {
    if (entry.settled) {
      return;
    }
    entry.settled = true;
    entries.delete(entry.issueNumber);
    if (entry.started && entry.priority === "background") {
      runningBackground -= 1;
    }
    entry.resolve(result);
    drainBackground();
  };

  const start = (entry: Entry): void => {
    if (entry.started || entry.settled || disposed) {
      return;
    }
    entry.started = true;
    if (entry.priority === "background") {
      runningBackground += 1;
    }
    record(entry, "started");
    const url = `/api/issues/${entry.issueNumber}?delay=${options.latencyMs()}`;
    void fetch(url, {
      signal: entry.controller.signal,
      headers: { "x-overseer-request-priority": entry.priority },
    }).then(async (response) => {
      if (!response.ok) {
        record(entry, "failed");
        finish(entry, {
          _tag: "FetchFailed",
          error: new IssueFetchFailure(entry.issueNumber, "http", response.status),
        });
        return;
      }
      try {
        const value = await Schema.decodeUnknownPromise(IssueRead)(await response.json());
        record(entry, "completed");
        finish(entry, { _tag: "Fetched", value });
      } catch (cause) {
        record(entry, "failed");
        finish(entry, {
          _tag: "FetchFailed",
          error: new IssueFetchFailure(entry.issueNumber, "decode", cause),
        });
      }
    }).catch((cause: unknown) => {
      const aborted = entry.controller.signal.aborted;
      record(entry, aborted ? "aborted" : "failed");
      finish(entry, {
        _tag: "FetchFailed",
        error: new IssueFetchFailure(
          entry.issueNumber,
          aborted ? "aborted" : "network",
          cause,
        ),
      });
    });
  };

  function drainBackground(): void {
    while (runningBackground < maxBackgroundConcurrency()) {
      const entry = backgroundQueue.shift();
      if (entry === undefined) {
        return;
      }
      if (!entry.settled && entry.consumers.size > 0) {
        start(entry);
      }
    }
  }

  const makeEntry = (issueNumber: number, priority: Priority): Entry => {
    let resolveResult: ((result: IssueFetchResult) => void) | undefined;
    const promise = new Promise<IssueFetchResult>((resolve) => {
      resolveResult = resolve;
    });
    if (resolveResult === undefined) {
      throw new Error("Promise resolver was not initialized");
    }
    const entry: Entry = {
      issueNumber,
      priority,
      controller: new AbortController(),
      consumers: new Set(),
      started: false,
      settled: false,
      resolve: resolveResult,
      promise,
    };
    entries.set(issueNumber, entry);
    return entry;
  };

  const abortUnrelatedBackground = (activeIssueNumber: number): void => {
    for (const entry of entries.values()) {
      if (entry.issueNumber !== activeIssueNumber && entry.priority === "background") {
        entry.controller.abort();
        if (!entry.started) {
          finish(entry, {
            _tag: "FetchFailed",
            error: new IssueFetchFailure(entry.issueNumber, "aborted"),
          });
        }
      }
    }
  };

  return {
    prefetch: (issueNumber) => {
      if (!allowsSpeculation(options.networkCondition()) || disposed) {
        return undefined;
      }
      const consumer = Symbol(`prefetch:${issueNumber}`);
      const existing = entries.get(issueNumber);
      const entry = existing ?? makeEntry(issueNumber, "background");
      entry.consumers.add(consumer);
      if (existing === undefined) {
        backgroundQueue.push(entry);
        drainBackground();
      }
      return {
        result: entry.promise,
        cancel: () => {
          entry.consumers.delete(consumer);
          if (entry.consumers.size === 0 && entry.priority === "background" && !entry.settled) {
            entry.controller.abort();
            if (!entry.started) {
              finish(entry, {
                _tag: "FetchFailed",
                error: new IssueFetchFailure(entry.issueNumber, "aborted"),
              });
            }
          }
        },
      };
    },
    requestActive: (issueNumber) => {
      abortUnrelatedBackground(issueNumber);
      const existing = entries.get(issueNumber);
      if (existing !== undefined) {
        if (existing.priority === "background") {
          if (existing.started) {
            runningBackground -= 1;
          }
          existing.priority = "active";
          start(existing);
          drainBackground();
        }
        return existing.promise;
      }
      const entry = makeEntry(issueNumber, "active");
      entry.consumers.add(Symbol(`active:${issueNumber}`));
      start(entry);
      return entry.promise;
    },
    networkLog: () => [...records],
    clearNetworkLog: () => { records.length = 0; },
    maxBackgroundConcurrency,
    dispose: () => {
      disposed = true;
      for (const entry of entries.values()) {
        entry.controller.abort();
      }
    },
  };
}
