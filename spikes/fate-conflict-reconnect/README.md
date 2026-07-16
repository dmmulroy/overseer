# Fate conflict/reconnect spike (throwaway)

## Question

Can Fate 1.3.2 sit behind a removable, application-owned sync interface for a minimal Issue list/detail flow while ordinary REST remains authoritative for agents, stale optimistic edits return actionable conflict data, and reconnect repairs missed detail and filtered-list changes without silent state loss?

This is a logic/compatibility fixture, not production UI or a proposed REST/realtime specification.

## Run

```sh
cd spikes/fate-conflict-reconnect
npm install
npm run check
npm run spike
```

## Shape

```text
feature scenario
  -> FateIssueSync (the application-owned interface)
    -> Fate normalized cache + optimistic mutation
      -> custom Transport
        -> ordinary agent-facing REST
          -> one IssueAuthority

application reconnect signal
  -> refetch active detail + invalidate/refetch active filtered list
```

The REST representation never contains Fate's `__typename`, selections, or native protocol envelope. The adapter projects REST records into Fate entities. A second actor edits through the same REST adapter.

The scenario proves:

1. An open-Issue list and Issue detail normalize into Fate from REST.
2. A stale title edit appears optimistically in the cache.
3. REST returns `409` with expected/actual versions, attempted input, and the current Issue.
4. Fate rolls back; `FateIssueSync` returns a discriminated actionable conflict and authoritatively refreshes the cache.
5. While disconnected, another actor closes the Issue. Before reconnect, detail and open-list membership are observably stale.
6. Reconnect refetches active detail and invalidates/refetches the filtered list; both converge to the authority.

## Gate result

| Promotion gate | Result | Evidence |
|---|---|---|
| Reuse application authority without compromising REST | **Pass** | Fate uses a custom `Transport`; the other actor uses unchanged REST JSON. |
| Actionable optimistic conflict | **Conditional pass** | The application interface returns all recovery data, but Fate only types mutation failures as `Error`; the adapter adds a tRPC-shaped `CONFLICT` classification shim and reparses the REST payload. |
| Deterministic reconnect repair | **Conditional pass** | Full active-query refetch repairs detail and list membership, but the application must own reconnect detection, active-query repair, and settling. |
| Fit the chosen Cloudflare topology | **Fail for `cf-fate`** | `cf-fate` adds a separate live Durable Object, requires `nodejs_compat`, and is at-most-once without replay. Overseer's chosen Project Durable Object already owns realtime and the authoritative event sequence. |
| Remove more code/operations than Fate adds | **Fail** | Fate does not replace the REST client, conflict policy, realtime lifecycle, catch-up policy, or query-repair registry. It adds normalization beneath the same required sync module. |

## Verdict

**No-go for Fate in the MVP.** Keep the application-owned REST/realtime sync module and omit Fate. Fate can be reconsidered if it gains both:

- a typed conflict envelope capable of carrying current and attempted values; and
- a documented connection lifecycle/repair hook or replay model that composes with Overseer's Project Durable Object sequence.

The branch is the primary-source artifact. Nothing here should be merged into production code.
