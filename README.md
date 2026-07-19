# PROTOTYPE — issue discovery and navigation in shadcn/Base UI

Throwaway Wayfinder HITL prototype for [issue #41](https://github.com/dmmulroy/overseer/issues/41). It compares four materially different structures using the approved **Crisp** Tailwind CSS v4 theme and application-owned shadcn `base-nova` source on Base UI.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4191/prototype/issue-discovery?variant=A&mode=light>.

- **A — Triage rail:** persistent Workspace/Project rail, issue queue, and selected issue.
- **B — Issue ledger:** full-width comparison table with a horizontal selection dock.
- **C — Route stack:** one compact list route that navigates to one focused Issue route.
- **D — Rail + route:** C’s focused route with A’s persistent context rail and B’s explicit filter strip.

Use the floating arrows or keyboard `←` / `→` to compare variants. The review bar also switches light/dark mode and cycles fresh, refreshing, and stale evidence. Context, structured filters, selection, route state, mode, and freshness remain in the URL.

Run `npm run evidence` with the dev server running to regenerate desktop/mobile light/dark screenshots and interaction proofs.

This is primary-source prototype evidence, not production code. Human review is required before #41 can be resolved; this branch intentionally records no winning variant.
