# ui/ - Overseer Task Viewer

Local webapp for inspecting Overseer task store. Hono API + Vite SPA + React + TanStack Query + Tailwind v4.

## STRUCTURE

```
ui/
├── src/
│   ├── api/              # Hono API server
│   │   ├── app.ts        # Routes, AppType export
│   │   ├── index.ts      # serve() entry
│   │   ├── cli.ts        # CLI bridge (spawns `os --json`)
│   │   └── routes/       # API route handlers
│   │
│   ├── client/           # React SPA
│   │   ├── main.tsx      # React root, QueryClientProvider
│   │   ├── App.tsx       # 3-panel layout
│   │   ├── components/   # UI components
│   │   ├── lib/
│   │   │   ├── api.ts    # hc<AppType> client
│   │   │   └── queries.ts # TanStack Query hooks
│   │   └── styles/
│   │       └── global.css # Tailwind v4 + theme
│   │
│   └── types.ts          # Shared types (mirrors mcp/src/types.ts)
│
├── scripts/
│   └── test-ui.sh        # agent-browser test script
│
├── docs/
│   └── UI-TESTING.md     # Testing documentation
│
├── vite.config.ts        # Vite config with /api/* proxy
├── index.html            # SPA entry
└── package.json
```

## COMMANDS

```bash
npm run dev              # Start Hono API + Vite HMR
npm run dev:api          # Start Hono API only
npm run dev:vite         # Start Vite only
npm run build            # Build for production
npm run typecheck        # Type check

# Testing (see docs/UI-TESTING.md)
npm run test:ui          # Full test suite
npm run test:ui:snapshot # Show UI structure
npm run test:ui:watch    # Continuous testing
```

## KEY FILES

| Task | File |
|------|------|
| Add API route | `src/api/routes/tasks.ts` |
| Add React component | `src/client/components/` |
| Add query hook | `src/client/lib/queries.ts` |
| Modify theme | `src/client/styles/global.css` |
| CLI bridge | `src/api/cli.ts` |

## LARGE COMPONENTS

| Component | Lines | Purpose |
|-----------|-------|---------|
| `TaskGraph.tsx` | 1021 | React Flow graph with hierarchy visualization |
| `TaskDetail.tsx` | 611 | Detail panel with context/learnings display |
| `KanbanView.tsx` | 549 | Kanban board view |
| `TaskList.tsx` | 545 | Filterable task list |

## THEME

Tailwind v4 CSS-first config in `global.css`. **Neo-Industrial / Technical Brutalism** aesthetic. Dark mode only, OKLCH colors.

### Design Language
- **Aesthetic**: Mission control meets modern dashboard. Government/military classification. Technical brutalism.
- **Signature Elements**: Vibrant orange accents, condensed display typography, hard edges (no rounded corners), highlight bars, chevrons
- **Visual Treatment**: Thick borders (2-3px), uppercase labels with wide tracking, registration marks

### Core Palette (OKLCH)
| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-primary` | `oklch(0.11 0 0)` | Main background (#1a1a1a) |
| `--color-bg-secondary` | `oklch(0.14 0 0)` | Panel backgrounds (#242424) |
| `--color-surface-primary` | `oklch(0.17 0 0)` | Cards, inputs (#2d2d2d) |
| `--color-surface-secondary` | `oklch(0.21 0 0)` | Elevated surfaces |
| `--color-text-primary` | `oklch(0.96 0.005 80)` | Warm off-white (#f5f3ef) |
| `--color-text-muted` | `oklch(0.65 0 0)` | Secondary text (#a0a0a0) |
| `--color-text-dim` | `oklch(0.45 0 0)` | Tertiary text (#666666) |
| `--color-text-inverse` | `oklch(0.08 0 0)` | Text on light bg |
| `--color-accent` | `oklch(0.68 0.21 38)` | Vibrant orange (#f26522) |
| `--color-accent-muted` | `oklch(0.55 0.16 38)` | Muted accent |
| `--color-accent-subtle` | `oklch(0.25 0.08 38)` | Subtle accent bg |
| `--color-highlight-bar` | `oklch(0.68 0.21 38)` | Orange highlight bars |
| `--color-border` | `oklch(0.30 0.005 80)` | Borders (warm) |
| `--color-border-focus` | `oklch(0.68 0.21 38)` | Focus ring (accent) |

### Status Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--color-status-pending` | `oklch(0.55 0 0)` | Neutral gray |
| `--color-status-active` | `oklch(0.68 0.21 38)` | Orange (pulsing) |
| `--color-status-blocked` | `oklch(0.65 0.2 25)` | Red-orange |
| `--color-status-done` | `oklch(0.65 0.12 145)` | Teal-green |

### Typography
| Token | Value | Usage |
|-------|-------|-------|
| `--font-display` | Big Shoulders Display, Impact | Headlines, logo |
| `--font-body` | JetBrains Mono, SF Mono | Body text, labels |
| `--font-mono` | JetBrains Mono, SF Mono | Code, data |

### Decorative Utilities
| Class | Usage |
|-------|-------|
| `.text-display` | Bold condensed headlines (900 weight) |
| `.text-display-sm` | Smaller display text (700 weight) |
| `.chevron-prefix` | Adds `>>>> ` before text in orange |
| `.chevron-lg` | Large decorative chevrons |
| `.registration-mark` | Corner `+` marks on containers |
| `.highlight-bar-active` | 4px orange left edge indicator |
| `.accent-bar-bottom` | 3px orange bottom bar |
| `.status-chip` | Inverted label (white on black) |
| `.btn-brutalist` | Industrial button style |
| `.border-industrial` | Thick, square borders |

### Component Variants
- **Card**: `brutalist` (no radius, thick border), `highlighted` (orange left bar)
- **Badge**: `appearance="brutalist"` (square, wide tracking)

## ENVIRONMENT

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `6969` | Hono API port |
| `OVERSEER_CLI_PATH` | `os` | CLI binary path |
| `OVERSEER_CLI_CWD` | `process.cwd()` | CLI working directory |

## DOCS

| Document | Purpose |
|----------|---------|
| `docs/UI-TESTING.md` | agent-browser testing guide |
| `../docs/specs/task-viewer.md` | Feature spec |

## PATTERNS (from learnings)

### Keyboard Shortcuts
- `useKeyboardShortcuts` uses ref pattern: store `make` function in `useRef`, update `ref.current` each render
- Guard with `e.isComposing` to prevent shortcuts during IME composition (CJK input)
- `e.target` can be null at runtime - use `instanceof HTMLElement` check
- SELECT elements are editable targets (exclude alongside INPUT/TEXTAREA)

### Zustand
- Selectors should be granular (one per state slice) to prevent re-renders
- Store exports `useViewMode`/`useSelectedTaskId`/etc - use these, not raw `useStore`

### ARIA/Accessibility
- Roving tabindex: focused item gets `tabIndex=0`, others `-1`. On j/k, call `element.focus({ preventScroll: true })`
- ARIA listbox requires arrow-key nav OR roving tabindex - don't mix button `role=option`
- `role=listitem` must not override interactive semantics - wrap button in `div[role=listitem]`
- Decorative SVG icons need `aria-hidden="true"`
- `motion-reduce:transition-none` on all transitions for prefers-reduced-motion

### Tailwind
- Dynamic classes like `text-status-${var}` work by accident - use static lookup maps
- `transition-all` is overly broad - use `transition-[property]` for specific animations
- `tailwind-variants` slot values shouldn't concatenate conflicting classes

### React
- `useEffect` deps with state used only in guards defeat the guard's purpose - remove from deps
- O(n) `findIndex` in recursive tree = O(n^2) total - precompute `Map<id, index>` via `useMemo`
- ReactFlow `fitView()` works for offscreen nodes - don't guard with DOM existence check
- `useSyncExternalStore` for URL state in React 18 - handles concurrent rendering correctly
- Separate `isLoading` (no cached data) from `isRefetching` (background refresh) for different UX states
- React Query's `dataUpdatedAt` updates on every refetch - derive "last updated" from `max(data.updatedAt)` for actual changes

### Domain Model
- **Use `effectivelyBlocked`, not `blockedBy.length`** - direct blocker edges persist after completion; `effectivelyBlocked` is computed from blocker's completed state
- Shared status helpers (`getStatusVariant`, `getStatusLabel`) in `lib/utils.ts` - import everywhere for consistent status logic
- `StatusVariant` type: `pending | active | blocked | done` - reuse instead of local definitions

### Drag & Resize
- Direct DOM manipulation during drag (`ref.current.style.height`), commit to store on release for 60fps
- CSS transitions fight drag handlers - disable on pointerdown, re-enable on pointerup
- Pointer capture (`setPointerCapture`) for smooth cross-element dragging; guard `releasePointerCapture` with `hasPointerCapture()`
- `onLostPointerCapture` catches edge cases where capture lost without pointercancel/pointerup
- Cleanup effect when conditionally rendered drag handles unmount mid-drag
- 8px (h-2) minimum drag target size per Fitts's Law; add `touch-none select-none` for mobile
- ARIA separator pattern: `role=separator`, `aria-valuenow/min/max`, keyboard (Arrow ±10px, Shift+Arrow ±50px, Home/End)

### CSS Animations
- Animation end state must match element's base background - use `transparent` for no-bg elements, `surface-primary` for Cards
- Extract hardcoded colors in `@keyframes` to CSS custom properties for theme consistency
- Box-shadow glow on small elements (6x6 dots) bleeds into text - create size-specific variants (`animate-pulse-active-sm`)
- WebKit scrollbar pseudo-elements don't support CSS transitions - remove misleading `transition` properties

### Scroll Containers
- Flex scroll wrapper pattern: outer (`flex-1 relative min-h-0`), inner (`absolute inset-0 overflow-y-auto`), innermost (padding)
- `overscroll-behavior: contain` prevents scroll chaining at boundaries
- Scrollbar clearance: `pr-4` (16px) for 6px scrollbar + buffer

### localStorage
- Wrap in try/catch for private browsing/quota exceeded
- Use versioned keys (`ui.layout.v1.xxx`) for future schema migration

### URL State
- Use custom events (`os:urlchange`) for programmatic URL changes, not synthetic `PopStateEvent`
- Preserve `history.state` in `replaceState` to avoid clobbering other state
- Type guards (`isTaskId`) at parse boundary, return null for invalid - never `as Type` casts

## NOTES

- Types in `src/types.ts` must mirror `mcp/src/types.ts`
- CLI bridge spawns `os --json <command>` 
- Vite proxies `/api/*` to Hono in dev mode
- Production: Hono serves `dist/` static files
- **Code review pattern**: 3 parallel review agents + Oracle deep review catches bugs single reviewers miss (repeatedly proven during UI Feedback Fixes milestone)
