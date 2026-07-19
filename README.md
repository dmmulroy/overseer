# Overseer timeline and contribution prototype

Throwaway React prototype for [issue #43](https://github.com/dmmulroy/overseer/issues/43). It asks how the issue body, structured events, comments, actor attribution, Markdown contribution, and attachments should fit together without operational metadata dominating the conversation.

This is a review artifact, not production code and not a product decision. It uses the approved **Crisp** Tailwind CSS v4 theme and application-owned shadcn `base-nova` source over Base UI.

## Variants

- **A — Narrative thread:** the body is the opening contribution, one structured-changes digest precedes the discussion, and comments then form a literal chronology.
- **B — Brief + checkpoints:** the issue brief stays pinned beside an outcome-oriented notebook grouping contributions, evidence, and mechanics.
- **C — Conversation + ledger:** conversation stays central while complete structured changes and files occupy parallel views (mobile uses channel tabs).

## Run

```sh
npm install
npm run dev
```

Open:

- <http://127.0.0.1:5173/prototype/timeline-contribution?variant=A&mode=light>
- <http://127.0.0.1:5173/prototype/timeline-contribution?variant=B&mode=light>
- <http://127.0.0.1:5173/prototype/timeline-contribution?variant=C&mode=light>

Change `mode=light` to `mode=dark`, or use the theme button. Use the floating bar or left/right arrow keys to switch variants. The arrow keys do not intercept input while the composer is focused.

## Evidence and checks

With the development server running:

```sh
npm run check
npm run build
npm run evidence
```

`evidence/` contains all three variants at desktop/mobile widths in light/dark mode plus expanded-digest, Markdown-preview, and mobile-ledger interaction states. The capture script also checks browser errors, horizontal overflow, URL-backed state, keyboard switching, theme state, and application-owned component slots.
