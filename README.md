# Overseer issue-interface theme prototype

Throwaway Foldkit and `@foldkit/ui` prototype for **Prototype the issue-centric human interface**.

This round deliberately evaluates visual language only. Every direction uses the same realistic attachment-upload fixture, component specimen, and states; layout and interaction decisions belong to later prototypes.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4183/prototype/issue-centric?variant=A&mode=light>.

Use the floating switcher or left/right arrow keys to compare:

- **A — Utility:** compact neutral controls, crisp boundaries, and operational density.
- **B — Editorial:** warm paper surfaces, expressive typography, and generous reading rhythm.
- **C — Desktop:** cool native-app materials, quiet chrome, and restrained hierarchy.

The Light/Dark control switches each direction between intentionally designed color modes without implying where a production preference control should live.

## Proof

`evidence/` contains browser-captured light/dark desktop and mobile screenshots plus a walkthrough video. With the dev server running, regenerate them using:

```sh
npm run evidence
```

This branch is a primary-source prototype, not production code.
