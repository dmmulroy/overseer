# Overseer mutation and sync recovery prototype

Throwaway Foldkit and `@foldkit/ui` prototype for **Prototype mutation and sync recovery**.

The prototype uses Overseer's chosen **Utility** theme and the same realistic issue fixture across three materially different interaction systems:

- **A — Inline continuity:** recovery appears beside the field, action, or stale content that needs attention.
- **B — Change workspace:** canonical issue content stays stable while local and incoming changes are resolved in a persistent side workspace.
- **C — Timeline recovery:** mutation attempts, incoming revisions, lifecycle changes, and recovery become a chronological event stream.

Every direction exercises editing, optimistic conflict, incoming realtime changes, reconnecting, close/reopen, and reversible delete/restore. State is intentionally in memory.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4183/prototype/mutation-sync?variant=A&mode=light&state=steady>.

Use the state strip to inspect each recovery case. The floating switcher or left/right arrow keys changes directions; the mode control switches Utility between light and dark.

## Proof

`evidence/` contains desktop/mobile direction screenshots, focused recovery-state screenshots, and an interaction walkthrough. With the dev server running, regenerate them using:

```sh
npm run evidence
```

This branch is a primary-source prototype, not production code.
