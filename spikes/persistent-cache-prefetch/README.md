# Persistent cache and speculative prefetch spike

Throwaway Foldkit client for **Validate persistent cache and speculative prefetch performance**. This is executable planning evidence, not production UI.

## Result

**Pass in local Chromium.** All correctness and performance gates pass against a deterministic 400-Issue Project.

| Gate | Result | Latest evidence |
| --- | --- | --- |
| Restore canonical snapshots | Pass | 40 persisted snapshots restored through the application-owned sync module. |
| Canonical rebuild vs draft migration | Pass | The incompatible v1 canonical store is discarded; the separately stored v1 draft migrates. A malformed canonical row later triggers a rebuild while both drafts survive. |
| Persisted event cursor | Pass | Reconnect replays contiguous events 11–13, commits each snapshot and cursor atomically, restores cursor 13, and does not resnapshot. |
| Cached route paint | Pass | 16.8 ms at p95 over 30 Foldkit route paints; budget is 100 ms. |
| Prefetch hit | Pass | 17.2 ms route paint and zero navigation-time network starts. |
| Active request priority | Pass | 504.4 ms with four speculative reads versus a 506.6 ms baseline; unrelated background requests are canceled. |
| Cancellation and deduplication | Pass | Viewport exit aborts the active speculative read; three same-Issue consumers produce one request. |
| Constrained networks | Pass | `saveData` and 2g disable speculation; 3g caps background concurrency at one. Intent reads remain available. |
| Quota-aware eviction | Pass | Least-recently-used query memberships and timeline pages are evicted; snapshots and separately stored drafts remain. |
| Core Web Vitals | Pass | Lab LCP 244 ms, CLS 0, and INP candidate 24 ms. |

Machine-readable measurements and lifecycle records are in [`evidence/latest.json`](evidence/latest.json).

## Shape exercised

- One application-owned sync module owns normalized in-memory snapshots, REST reads, IndexedDB persistence, cursor repair, request deduplication, and speculative policy.
- Effect's schema-backed IndexedDB modules parse every record. Canonical cache and drafts use separate databases so canonical rebuilds cannot erase drafts.
- Snapshot and cursor writes share one strict IndexedDB transaction. The in-memory cursor advances only after commit.
- A real `IntersectionObserver` starts viewport prefetch after a 300 ms dwell and cancels on exit.
- Foldkit focus/pointer-down Messages promote intent immediately, while selection still changes only on semantic click.
- The request coordinator limits background concurrency and aborts unrelated speculation before active reads. Attachments and deep timeline history have no speculative path.
- Chromium `PerformanceObserver` captures LCP, layout shift, and Event Timing; the runner measures Foldkit DOM paint from click through the next animation frame.

## Constraints

- Results are local lab evidence from headless Chrome 150 at 1280×820, not field data or a remote Cloudflare deployment.
- Network delay and connection hints are deterministic fixture inputs. They prove client scheduling policy, not every browser/network stack.
- The fixture exercises the first timeline page only, deliberately never attachment bytes or deep history.
- There is no service worker, offline mutation queue, production styling, or production route implementation.
- The runner uses the system Chrome executable. Set `CHROME_PATH` when Chrome is installed elsewhere.

## Run

```sh
npm install
npm test
npm audit --omit=dev
```

`npm test` performs strict source typechecking, launches the Vite/Foldkit fixture in Chromium, rewrites `evidence/latest.json`, and fails if any gate misses its budget.
