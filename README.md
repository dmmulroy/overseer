# Overseer issue-interface prototype

Throwaway Foldkit and `@foldkit/ui` prototype for **Prototype the issue-centric human interface**.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4183/prototype/issue-centric?variant=A>.

Use the floating switcher or the left/right arrow keys to compare:

- **A — Workbench:** issue list, focused detail, and steering metadata visible together.
- **B — Paper trail:** a calmer document-first issue page with metadata in the reading flow.
- **C — Ops console:** a dense keyboard-forward queue, focus pane, and live inspector.

The controls exercise editing, actionable revision conflict, comments, attachment progress, claim/label/state changes, realtime/reconnect status, deletion, restoration, and cached issue navigation. State is intentionally in memory.

## Proof

`evidence/` contains browser-captured screenshots and a short MP4 walkthrough. With the dev server running, regenerate them using:

```sh
npm run evidence
```

This branch is a primary-source prototype, not production code.
