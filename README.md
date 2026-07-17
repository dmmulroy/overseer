# Overseer issue-detail steering prototype

Throwaway Foldkit prototype for [#32 — Prototype issue detail steering](https://github.com/dmmulroy/overseer/issues/32).

This round keeps the selected **Utility** visual language fixed and compares three materially different ways to compose issue identity, state, labels, claim, hierarchy, blocking relations, and primary actions. The fixture is intentionally blocked, has a parent and three sub-issues, and unlocks downstream work.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4183/prototype/issue-detail?variant=A&mode=light>.

Use the floating switcher or left/right arrow keys to compare:

- **A — Control strip:** a dense horizontal control plane directly under the title.
- **B — Steering rail:** ownership and actions in a persistent rail beside the reading surface.
- **C — Work map:** relationships as the primary canvas with a next-move inspector.

Claim/Release, Close/Reopen, and Light/Dark are interactive in every direction. Prototype state is in memory; variant and color mode are shareable URL parameters.

## Proof

`evidence/` contains browser-captured light/dark desktop and mobile screenshots for all three directions plus an interaction walkthrough. With the dev server running, regenerate them using:

```sh
npm run evidence
```

This branch is a primary-source prototype, not production code.
