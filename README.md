# PROTOTYPE — issue detail steering (#42)

Throwaway HITL prototype for comparing three issue-detail structures on the focused `/prototype/issue-detail` route. No direction is selected here.

## Run

```sh
npm install
npm run dev -- --port 4183
```

Open:

- <http://127.0.0.1:4183/prototype/issue-detail?variant=A&mode=light>
- <http://127.0.0.1:4183/prototype/issue-detail?variant=B&mode=light>
- <http://127.0.0.1:4183/prototype/issue-detail?variant=C&mode=light>

`mode` accepts `light`, `dark`, or `system`. The floating switcher and left/right arrow keys update the URL-backed `variant`.

## Directions

- **A — Command header:** identity and immediately applicable actions lead, followed by a compact state strip and supporting detail.
- **B — Steering rail:** claim, state, Labels, review status, and primary actions stay in a right rail beside a work brief.
- **C — Readiness board:** resolved prerequisites, the current Issue, and downstream work become the main steering canvas.

All directions use realistic #42 state, show the HATEOAS-discovered action set, and update applicable links after in-memory claim/release and close/reopen actions.

## Boundary

This prototype consumes the approved Crisp Tailwind v4 theme and application-owned generic components in `src/ui/components/**`. Only that component directory imports Base UI or CVA. Issue-specific composition remains in `src/features/issues/**`.

The resolved Foldkit detail prototype at `e2eae75`, issue-discovery prototype at `bb8df01`, and Crisp foundation at `1252da2` were inspected as historical evidence. Their Foldkit implementation boundary was not retained.

## Checks and evidence

```sh
npm run check
npm run build
npm run evidence # while the dev server is running on port 4183
```

`npm run evidence` captures all three directions at 1440×1000 and 390×844 in light and dark modes, plus an interaction proof for URL switching, action applicability, and theme changes.
