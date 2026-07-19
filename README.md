# Mutation and recovery under simple REST — prototype

> **PROTOTYPE / THROWAWAY — Issue #44.** This branch is evidence for human review, not production implementation.

Question: under route-scoped REST polling and conditional reads, how should editing, a draft-base Revision conflict, stale cached data, close/reopen, and delete/restore remain understandable and reversible without a change stream?

## Run

```sh
npm install && npm run dev
```

Open <http://127.0.0.1:4184/prototype/mutation-recovery?variant=A&mode=light&state=steady>.

The URL preserves:

- `variant=A|B|C`
- `mode=light|dark`
- `state=steady|editing|conflict|stale|closed|confirm-delete|deleted`

The bottom switcher and keyboard `←` / `→` cycle variants. The top strip changes interaction states.

## Structural variants

- **A — Inline recovery:** field and lifecycle recovery stays beside the affected Issue content.
- **B — Revision workbench:** canonical server read and device-local working copy use separate panes.
- **C — Action checkpoint:** one session-only recovery decision leads before the normal Issue content; it is explicitly not Timeline activity.

No winner is selected on this branch. All mutations are in-memory stubs. The stale state follows the resolved freshness policy: cached reads remain visible, drafts remain editable, server writes are disabled, and **Retry now** conditionally validates. The conflict represents a newer title Revision found by the pre-write freshness check—not an ETag mutation precondition or a server-side entity version. No stream, reconnect, sequence, or offline mutation queue is modeled.

## Evidence

Each structural variant has desktop and mobile captures in both Crisp light and dark modes under [`evidence/`](evidence/):

| Variant | Light desktop | Dark desktop | Light mobile | Dark mobile |
|---|---|---|---|---|
| A | [`a-light-desktop.png`](evidence/a-light-desktop.png) | [`a-dark-desktop.png`](evidence/a-dark-desktop.png) | [`a-light-mobile.png`](evidence/a-light-mobile.png) | [`a-dark-mobile.png`](evidence/a-dark-mobile.png) |
| B | [`b-light-desktop.png`](evidence/b-light-desktop.png) | [`b-dark-desktop.png`](evidence/b-dark-desktop.png) | [`b-light-mobile.png`](evidence/b-light-mobile.png) | [`b-dark-mobile.png`](evidence/b-dark-mobile.png) |
| C | [`c-light-desktop.png`](evidence/c-light-desktop.png) | [`c-dark-desktop.png`](evidence/c-dark-desktop.png) | [`c-light-mobile.png`](evidence/c-light-mobile.png) | [`c-dark-mobile.png`](evidence/c-dark-mobile.png) |

Focused states:

- [Inline editing](evidence/editing-inline-light-desktop.png)
- [Inline conflict in dark mode](evidence/conflict-inline-dark-desktop.png)
- [Stale workbench](evidence/stale-workbench-light-desktop.png)
- [Close/reopen checkpoint on mobile](evidence/close-checkpoint-dark-mobile.png)
- [Delete confirmation](evidence/delete-confirmation-light-desktop.png)
- [Deleted/restore tombstone on mobile](evidence/deleted-restore-dark-mobile.png)

`npm run evidence` captures the screenshots and checks all 84 variant/mode/state/viewport combinations for URL/root state, runtime errors, failed responses, and horizontal page overflow. It also exercises save, conflict choice, stale retry/write disabling, reopen, Alert Dialog focus/dismissal, delete/restore, keyboard switching, and theme switching.
