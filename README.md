# Overseer issue discovery prototype

Throwaway Utility-theme prototype for **Prototype issue discovery and navigation** ([#31](https://github.com/dmmulroy/overseer/issues/31)).

This round compares the smallest structures that make workspace/project context, issue rows, structured filters, selection, and cached/prefetched transitions legible on desktop and mobile. It deliberately excludes boards, saved views, and query syntax.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4183/prototype/issue-discovery?variant=A>.

Use the floating switcher or left/right arrow keys to compare:

- **A — Navigator:** persistent workspace/project rail, issue queue, and detail.
- **B — Index + inspector:** dense project table with a compact selection inspector.
- **C — Focused route:** one list surface that navigates into one issue surface.

Try switching projects, cycling each structured filter, hovering or focusing an issue to prefetch it, and selecting it. On narrow screens, selection moves from the list to the issue and **← Issues** returns.

## Proof

`evidence/` contains desktop/mobile browser screenshots, prefetch/selection proofs, and a walkthrough video. With the dev server running, regenerate them using:

```sh
npm run evidence
```

This branch is a primary-source prototype, not production code.
