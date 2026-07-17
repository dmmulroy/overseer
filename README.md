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
- **D — Solo split:** native-window chrome, a grouped rail, and a spacious working document.
- **E — Blueprint:** an electric project field holding one oversized decision sheet.
- **F — Index:** a restrained register that expands the selected row in place.
- **G — Dispatch:** an editorial brief with operational context pushed to the margins.
- **H — Ledger:** a terminal-like database view with an inline record inspector.
- **I — Orbit:** relationships shown as a constellation above a readable issue drawer.
- **J — Notebook:** an indexed paper folio with observations and a margin log.
- **K — Dock:** a compact utility shell with a floating command surface.
- **L — Signal:** a high-contrast progress poster paired with the active decision.
- **M — Quiet:** a sparse, reading-first page with relationships as footnotes.

D–M explore genuinely different information structures rather than remapping a feature checklist into visible labels. The family borrows Solo’s restraint—native framing, fog-gray navigation, hairline dividers, selective blue, small status signals, and generous workspace—without copying its product model.

The controls across the prototype exercise editing, actionable revision conflict, comments, attachment progress, claim/label/state changes, realtime/reconnect status, deletion, restoration, and cached issue navigation. State is intentionally in memory.

## Proof

`evidence/` contains browser-captured screenshots and a short MP4 walkthrough. With the dev server running, regenerate them using:

```sh
npm run evidence
```

This branch is a primary-source prototype, not production code.
