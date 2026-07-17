# Issue #47 research: Tailwind CSS v4 + shadcn/ui on Base UI

**Researched:** 2026-07-17

**Question:** Can this stack replace Kumo as Overseer's React component foundation while preserving React 19 and Vite compatibility, static-SPA delivery, semantic light/dark theming, compact controls, accessible behavior, and manageable upgrades?

## Recommendation

**Yes. Adopt Tailwind CSS v4, shadcn/ui's `base-nova` source, and Base UI for the new client; do not adopt Kumo as Overseer's component boundary.**

The compatibility requirements are met. Base UI 1.6.0 explicitly supports React 17–19, and its package peers include React and React DOM 19. Tailwind has an official Vite plugin, shadcn has an official Vite setup, and Vite builds `index.html` into assets intended for static hosting. ([Base UI compatibility](https://base-ui.com/react/overview/about.md#react-versions), [Base UI package metadata](https://registry.npmjs.org/@base-ui/react/latest), [Tailwind Vite setup](https://tailwindcss.com/docs/installation/using-vite), [shadcn Vite setup](https://ui.shadcn.com/docs/installation/vite.md), [Vite production build](https://vite.dev/guide/build))

This is not a swap from one behavior engine to another: current Kumo itself is built on Base UI and Tailwind v4. The choice is primarily between a centrally maintained, Cloudflare-opinionated npm component package and application-owned generated wrappers around the same headless foundation. ([Kumo README](https://raw.githubusercontent.com/cloudflare/kumo/main/README.md), [Kumo package metadata](https://registry.npmjs.org/@cloudflare/kumo/latest)) As of 2026-07-02, Base UI is shadcn's default for new projects and shadcn recommends it for new work. ([shadcn announcement](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default.md))

The price of the recommendation is deliberate: **Overseer must own its visual tokens, generated wrapper source, accessibility integration, tests, and domain-level UI patterns.** Base UI should own low-level interaction machinery only.

## Compatibility assessment

| Requirement | Finding | Verdict |
|---|---|---|
| React 19 | React 19 is stable; the current registry release is 19.2.7. Base UI 1.6.0 declares `react`, `react-dom`, and optional React types compatible with `^17 \|\| ^18 \|\| ^19`. ([React 19 release](https://react.dev/blog/2024/12/05/react-19), [React metadata](https://registry.npmjs.org/react/latest), [Base UI metadata](https://registry.npmjs.org/@base-ui/react/latest)) | Compatible. |
| Vite | Tailwind documents `@tailwindcss/vite`; shadcn's Vite guide configures `react()` and `tailwindcss()` together. ([Tailwind](https://tailwindcss.com/docs/installation/using-vite), [shadcn](https://ui.shadcn.com/docs/installation/vite.md#existing-project)) | Compatible. |
| Static SPA | Vite's default build uses root `index.html`, emits a bundle suitable for static hosting, and places deployment output in `dist`. React's `createRoot` is the client-only browser entry API. ([Vite build](https://vite.dev/guide/build), [Vite static deployment](https://vite.dev/guide/static-deploy), [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)) | Compatible; no SSR or RSC is required. |
| Semantic light/dark theme | shadcn recommends CSS variables and supplies semantic pairs such as `background`/`foreground`, `primary`/`primary-foreground`, `muted`, `accent`, `destructive`, `border`, `input`, and `ring`; dark mode overrides the same variables under `.dark`. ([shadcn theming](https://ui.shadcn.com/docs/theming.md)) | Compatible and directly suited to an application-owned theme. |
| Compact controls | The current `base-nova` Button registry source has `xs`, `sm`, default, and icon sizes at 1.5, 1.75, and 2rem; Input is 2rem high, and Select has 1.75 and 2rem trigger sizes. ([Button source](https://ui.shadcn.com/r/styles/base-nova/button.json), [Input source](https://ui.shadcn.com/r/styles/base-nova/input.json), [Select source](https://ui.shadcn.com/r/styles/base-nova/select.json)) | Compatible; Overseer should standardize which sizes mean “compact” rather than scatter height utilities. |
| Accessible primitives | Base UI supplies ARIA/role attributes, keyboard navigation, pointer handling, and focus management, and follows WAI-ARIA authoring patterns. ([Base UI accessibility](https://base-ui.com/react/overview/accessibility.md)) | Good foundation, not an application-level accessibility guarantee. |

### Static delivery details

Use a normal `createRoot` client entry and set `components.json.rsc` to `false`; shadcn documents this flag as the switch for React Server Component directives. ([React `createRoot`](https://react.dev/reference/react-dom/client/createRoot), [`components.json` `rsc`](https://ui.shadcn.com/docs/components-json.md#rsc))

`vite build` is sufficient. Configure Vite's `base` only if Overseer is served below a path prefix; Vite rewrites imported, CSS, and HTML asset URLs for that base and also supports a relative base. ([Vite public base path](https://vite.dev/guide/build#public-base-path)) Client-side routing still requires the static host to fall back to `index.html`; Vite's static deployment guide demonstrates such a rewrite, and it remains deployment configuration rather than a UI-stack concern. ([Vite static deployment](https://vite.dev/guide/static-deploy#google-firebase))

## Exact baseline

This is a reproducible **2026-07-17 baseline**, not an instruction to float on `latest`. Commit the lockfile and review upgrades.

### Platform and build

- **Node.js 22.12 or newer.** Vite 8 requires Node `20.19+` or `22.12+`; the shadcn CLI requires Node `>=20.18.1`. Choosing 22.12 satisfies both without relying on the older line. ([Vite guide](https://vite.dev/guide/#scaffolding-your-first-vite-project), [shadcn metadata](https://registry.npmjs.org/shadcn/latest))
- **Vite 8.1.5** and **`@vitejs/plugin-react` 6.0.3**. The plugin's current peer range is Vite 8 and it supplies React Fast Refresh. ([Vite metadata](https://registry.npmjs.org/vite/latest), [React plugin metadata](https://registry.npmjs.org/@vitejs/plugin-react/latest), [Vite plugins](https://vite.dev/plugins/#official-plugins))
- **TypeScript `~6`** with React 19 types, matching shadcn's current first-party Vite template. ([template `package.json`](https://raw.githubusercontent.com/shadcn-ui/ui/main/templates/vite-app/package.json))
- **Tailwind CSS 4.3.3** and **`@tailwindcss/vite` 4.3.3**. The Vite adapter accepts Vite 5.2 through 8. ([Tailwind metadata](https://registry.npmjs.org/tailwindcss/latest), [adapter metadata](https://registry.npmjs.org/@tailwindcss/vite/latest))

### UI packages

Pin this initial set:

```json
{
  "dependencies": {
    "@base-ui/react": "1.6.0",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "lucide-react": "1.25.0",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "shadcn": "4.13.1",
    "tailwind-merge": "3.6.0",
    "tw-animate-css": "1.4.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@types/node": "24.13.3",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.3",
    "tailwindcss": "4.3.3",
    "typescript": "6.0.3",
    "vite": "8.1.5"
  }
}
```

The versions above are the current first-party registry values for [Base UI](https://registry.npmjs.org/@base-ui/react/latest), [shadcn](https://registry.npmjs.org/shadcn/latest), [Lucide React](https://registry.npmjs.org/lucide-react/latest), [CVA](https://registry.npmjs.org/class-variance-authority/latest), [clsx](https://registry.npmjs.org/clsx/latest), [tailwind-merge](https://registry.npmjs.org/tailwind-merge/latest), [tw-animate-css](https://registry.npmjs.org/tw-animate-css/latest), [TypeScript](https://registry.npmjs.org/typescript/latest), [React types](https://registry.npmjs.org/@types/react/latest), [React DOM types](https://registry.npmjs.org/@types/react-dom/latest), and [Node types](https://registry.npmjs.org/@types/node/latest). `shadcn` remains a dependency because current initialization imports `shadcn/tailwind.css`; `shadcn eject` can inline that CSS and remove the package, but upstream changes to it then stop applying. ([shadcn CLI `eject`](https://ui.shadcn.com/docs/cli.md#eject))

Use this configuration:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/ui/theme.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/ui",
    "ui": "@/ui/primitives",
    "lib": "@/lib",
    "hooks": "@/hooks",
    "utils": "@/lib/ui-classnames"
  }
}
```

The corresponding CSS entry starts with:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@custom-variant dark (&:is(.dark *));
```

The shared shadcn import and custom dark selector are part of the documented current Tailwind v4 model. ([shadcn CLI `eject`](https://ui.shadcn.com/docs/cli.md#eject), [shadcn default theme CSS](https://ui.shadcn.com/docs/theming.md#default-theme-css))

For Tailwind v4, shadcn says `tailwind.config` should be blank; it recommends CSS variables and generates semantic tokens when `cssVariables` is true. Style, base color, and the CSS-variable choice are initialization-time decisions, so record them exactly. ([`components.json` reference](https://ui.shadcn.com/docs/components-json.md)) The CLI supports Base UI explicitly with `--base base`. ([CLI `init`](https://ui.shadcn.com/docs/cli.md#init))

The Vite config needs only the React and Tailwind plugins plus Overseer's source alias, as shown in the official shadcn Vite setup. ([shadcn Vite config](https://ui.shadcn.com/docs/installation/vite.md#update-viteconfigts))

## Theme and density boundary

Own `src/ui/theme.css`. Start with shadcn's semantic token pairs, but name additional tokens by purpose rather than palette: for example `surface`, `surface-raised`, `issue-open`, `issue-closed`, `blocked`, `warning`, and their foregrounds. Tailwind v4's `@theme` variables generate utility APIs and ordinary CSS variables, while ordinary `:root` variables remain appropriate for values that should not create utilities. ([Tailwind theme variables](https://tailwindcss.com/docs/theme#what-are-theme-variables), [shadcn adding tokens](https://ui.shadcn.com/docs/theming.md#adding-new-tokens))

Keep one value for each semantic token in `:root` and another in `.dark`; components should consume the semantic utility, never select a mode-specific raw color. This follows shadcn's own token model. ([shadcn theming](https://ui.shadcn.com/docs/theming.md#token-convention))

The application should own a `ThemeProvider` with `light | dark | system`, persistent preference, and system-media handling. shadcn publishes a Vite provider example using `localStorage`, `matchMedia`, and a root `light`/`dark` class. ([shadcn Vite dark mode](https://ui.shadcn.com/docs/dark-mode/vite.md)) Add a tiny pre-render script in `index.html` to set the class before paint; Tailwind's own three-way example recommends placing this logic inline in `head` to avoid a flash. ([Tailwind dark mode](https://tailwindcss.com/docs/dark-mode#with-system-theme-support))

Define a small density contract in the primitive wrappers—at minimum `xs`, `sm`, and default—and use it consistently for buttons, icon buttons, inputs, selects, menu items, and issue-table rows. Keep compact visual controls from shrinking their touch affordance blindly; the application must decide where compact desktop density and coarse-pointer sizing differ.

## MVP component coverage

### Install now

| Need | shadcn/Base source | Overseer use |
|---|---|---|
| Actions and display | `button`, `badge`, `separator`, `skeleton` | Create/edit/close/archive actions, issue state and label display, loading placeholders. |
| Forms | `field`, `label`, `input`, `textarea`, `checkbox`, `select`, `combobox` | Workspace/project/issue fields, assignee, state, labels, and structured filters. Base UI recommends Combobox rather than Select when a list is large enough to require filtering. ([Base UI Select guidance](https://base-ui.com/react/components/select.md#usage-guidelines)) |
| Overlays | `dialog`, `alert-dialog`, `dropdown-menu`, `popover`, `tooltip` | Editors, destructive confirmations, row actions, filter/label pickers, and supplementary icon hints. The Base-backed Alert Dialog is specifically a modal response-required primitive. ([shadcn Alert Dialog](https://ui.shadcn.com/docs/components/base/alert-dialog.md)) |
| Disclosure and shell | `collapsible`, `sidebar` (which brings `sheet` and mobile support) | Workspace/project navigation and narrow-screen shell. shadcn's Sidebar owns collapsible state and includes a mobile sheet path. ([shadcn Sidebar](https://ui.shadcn.com/docs/components/base/sidebar.md#structure)) |
| Data display | `table`, `pagination` | Semantic issue listings and server-driven paging. The current Table registry is a styled native `<table>` family, not an ARIA data grid. ([Table source](https://ui.shadcn.com/r/styles/base-nova/table.json)) |

Use native scrolling for the MVP unless a styled scrollbar is truly needed. At this snapshot the `base-nova` Scroll Area registry source imports a React namespace it does not use, while shadcn's Vite template enables `noUnusedLocals`; that exact generated pair requires a small source correction to typecheck. ([Scroll Area registry source](https://ui.shadcn.com/r/styles/base-nova/scroll-area.json), [Vite template TypeScript config](https://raw.githubusercontent.com/shadcn-ui/ui/main/templates/vite-app/tsconfig.app.json)) This is minor, but it is concrete evidence that generated files must be reviewed rather than treated as pristine package artifacts.

Do not start with TanStack Table. shadcn describes Data Table as a guide, not a universal component, because sorting, filtering, pagination, and data-source behavior vary; add a headless table engine only when the issue list actually needs client-side table behavior. ([shadcn Data Table](https://ui.shadcn.com/docs/components/base/data-table.md#introduction))

Do not use shadcn's old Toast component; it is deprecated in favor of Sonner. ([shadcn Toast](https://ui.shadcn.com/docs/components/base/toast.md)) For the initial dependency boundary, prefer inline mutation status plus an application-owned live region. If transient notifications become necessary, wrap Base UI's Toast behind Overseer's own interface; Toast is exported by the current Base UI package. ([Base UI exports](https://registry.npmjs.org/@base-ui/react/latest))

### Application-owned composites

The registry does **not** define Overseer's product semantics. Build these above the primitive layer:

- `AppShell`, `WorkspaceSwitcher`, and `ProjectNavigation`;
- `IssueList`, `IssueRow`, paging, empty/error/loading states, and structured filter controls;
- `IssueEditor` and `CommentComposer` using the owned field primitives;
- `LabelPicker`, `AssigneePicker`, `ParentIssuePicker`, and `BlockerPicker` using Combobox/Popover as appropriate;
- `IssueStateBadge`, `BlockedIndicator`, `Timeline`, and relationship lists;
- `ConfirmArchive`, `ConfirmDelete`, and unsaved-change confirmation;
- Markdown rendering/editing and attachment upload/preview.

These are application modules, not additions to the generic primitive layer. In particular, “issue,” “workspace,” “project,” “blocked,” and “assignee” must not enter Base UI wrapper APIs.

## Generated-source ownership and upgrades

shadcn explicitly says it is not a traditional component library: it hands the application the component code for modification. It also says dependency upgrades such as `@base-ui/react` carry core headless fixes while the top visual layer remains open and application-owned. ([shadcn introduction](https://ui.shadcn.com/docs.md#open-code))

The practical ownership model is:

1. `shadcn add` copies wrapper source and required dependencies into Overseer. The committed files are Overseer code from that point onward.
2. Updating `@base-ui/react` updates the behavior implementation beneath wrappers through normal package management.
3. Updating `shadcn` does **not** silently rewrite committed wrappers. `add` does not overwrite by default and supplies `--dry-run`, `--diff`, `--view`, and an explicit `--overwrite` option. ([shadcn CLI `add`](https://ui.shadcn.com/docs/cli.md#add))
4. Therefore, wrapper updates are reviewed source merges, not routine package bumps.

Recommended upgrade procedure:

1. Pin the baseline and commit its lockfile plus `components.json`.
2. Upgrade React, Base UI, Tailwind, Vite, and shadcn in separate changes.
3. For Base UI, read its release notes, typecheck, build, and run behavior tests. Base UI 1.6.0's release notes include fixes across focus return, dialog positioning, menus, selects, validation, and keyboard behavior, illustrating why behavior upgrades deserve focused regression tests. ([Base UI 1.6.0 notes](https://base-ui.com/react/overview/releases/v1-6-0.md))
4. For a generated wrapper, inspect upstream with `shadcn add <name> --dry-run` and `--diff`; merge intentionally. Never run bulk `--overwrite` on customized source.
5. Keep application-specific changes outside primitive files where possible. Modify a primitive only to establish a stable cross-application rule such as density, semantics, or focus treatment.

This is more merge work than Kumo's npm-only wrapper updates, but it removes wrapper-vendor lock-in and makes the code auditable and adaptable.

## Accessibility and testing responsibilities

Base UI's responsibility is the difficult primitive behavior: ARIA and roles, keyboard interactions, pointer interactions, and focus management. It tests its own components across browsers, devices, platforms, screen readers, and other environments. ([Base UI accessibility](https://base-ui.com/react/overview/accessibility.md))

Overseer's responsibility remains:

- visible labels or correct accessible names for every control;
- visual focus indicators and sufficient light/dark contrast—Base UI explicitly assigns both to the developer; ([Base UI focus and contrast](https://base-ui.com/react/overview/accessibility.md#focus-management))
- correct semantic element choice and composition; a custom component supplied through Base UI's `render` prop must forward its ref and spread received props; ([Base UI composition](https://base-ui.com/react/handbook/composition.md#composing-custom-react-components))
- dialog titles/descriptions, initial focus, close affordance, return focus, and destructive-action wording;
- announcements for asynchronous create/update/delete outcomes;
- table headers, captions where needed, row-action names, and sortable-state announcements;
- keyboard reachability after responsive layout changes and portal behavior in the static SPA;
- icon-only accessible names. shadcn's Button docs show `aria-label` on icon buttons and warn that Base UI Button enforces button semantics, so links should be plain anchors styled with `buttonVariants`. ([shadcn Button](https://ui.shadcn.com/docs/components/base/button.md#as-link))

Tooltips may supplement an icon label but may not be the label or carry required information: Base UI says they are unavailable to touch and screen-reader users and requires an accessible name on the trigger. ([Base UI Tooltip guidance](https://base-ui.com/react/components/tooltip.md#usage-guidelines))

### Minimum test gate

- Component/integration tests for every owned composite using role/name queries and user-level keyboard/pointer interactions.
- Browser tests for Dialog/Alert Dialog focus trap and return, Menu/Select/Combobox keyboard navigation, Sidebar desktop/mobile transitions, and theme selection before/after reload.
- Automated accessibility checks on the shell, issue list, issue editor, and every modal state in both themes.
- Manual keyboard-only and representative screen-reader passes before the MVP ships; also inspect contrast, zoom/reflow, coarse pointer behavior, and reduced motion.
- A production `vite build` as a required CI check, because generated-source and Tailwind scanning failures are build-time concerns.

A reasonable exact test baseline is Vitest 4.1.10, `@vitest/browser-playwright` 4.1.10, Playwright 1.61.1, `vitest-browser-react` 2.2.0, React Testing Library 16.3.2, user-event 14.6.1, and axe-core 4.12.1. The browser provider declares Playwright as a peer; current Vitest supports Vite 8, and React Testing Library declares React 19 peers. ([Vitest metadata](https://registry.npmjs.org/vitest/latest), [browser provider metadata](https://registry.npmjs.org/@vitest/browser-playwright/latest), [Playwright metadata](https://registry.npmjs.org/playwright/latest), [Vitest browser React metadata](https://registry.npmjs.org/vitest-browser-react/latest), [React Testing Library metadata](https://registry.npmjs.org/@testing-library/react/latest), [user-event metadata](https://registry.npmjs.org/@testing-library/user-event/latest), [axe-core metadata](https://registry.npmjs.org/axe-core/latest)) Kumo's own package uses Vitest, Testing Library/user-event, and a Playwright browser project, so this level of testing is consistent with the component foundation being replaced. ([Kumo package metadata](https://registry.npmjs.org/@cloudflare/kumo/latest))

## Material tradeoffs versus Kumo

| Axis | Tailwind + shadcn/Base | Kumo |
|---|---|---|
| Primitive behavior | Base UI 1.6.0. | The current package declares `@base-ui/react: ^1.6.0`. ([Kumo metadata](https://registry.npmjs.org/@cloudflare/kumo/latest)) |
| Visual source | Copied into and owned by Overseer. Upstream wrapper changes require review/merge. ([shadcn open code](https://ui.shadcn.com/docs.md#open-code), [CLI diff controls](https://ui.shadcn.com/docs/cli.md#add)) | Imported from an npm package; Cloudflare owns wrapper fixes and releases. Kumo supports main and granular component imports. ([Kumo README](https://raw.githubusercontent.com/cloudflare/kumo/main/README.md)) |
| Theme | Neutral semantic scaffold that Overseer must complete and validate. ([shadcn theming](https://ui.shadcn.com/docs/theming.md)) | A mature semantic `kumo-*` token system with generated light/dark values and `data-mode`; stronger defaults but more Cloudflare vocabulary/opinion. ([Kumo theme source](https://raw.githubusercontent.com/cloudflare/kumo/main/packages/kumo/src/styles/theme-kumo.css), [Kumo conventions](https://raw.githubusercontent.com/cloudflare/kumo/main/AGENTS.md#styling-critical)) |
| Density | Current `base-nova` controls already cover compact 24–32px sizes and are directly editable. ([Button registry](https://ui.shadcn.com/r/styles/base-nova/button.json)) | Kumo Button provides `xs`, `sm`, base, and large sizes, including 20px and 26px compact buttons. ([Kumo Button source](https://raw.githubusercontent.com/cloudflare/kumo/main/packages/kumo/src/components/button/button.tsx)) |
| Coverage | Broad registry, but Overseer assembles product patterns. Full Base UI component documentation exists in shadcn. ([Base UI docs announcement](https://ui.shadcn.com/docs/changelog/2026-01-base-ui.md)) | More preassembled application components, including date pickers, charts, command palette, sidebar, toast, pagination, and code display. ([Kumo exports](https://raw.githubusercontent.com/cloudflare/kumo/main/packages/kumo/src/index.ts)) |
| Dependency surface | Pay for selected generated components and their declared packages. Base UI is tree-shakable by component. ([Base UI quick start](https://base-ui.com/react/overview/quick-start.md#install-the-library)) | The package declares Base UI plus Shiki, Motion, D3 Geo, react-day-picker, and related dependencies for its wider catalog; actual bundle impact still depends on imports and bundling. ([Kumo metadata](https://registry.npmjs.org/@cloudflare/kumo/latest)) |
| Tailwind integration | First-party Vite plugin; local source is scanned naturally. ([Tailwind Vite setup](https://tailwindcss.com/docs/installation/using-vite)) | Tailwind consumers must add an `@source` for Kumo's `node_modules` output and observe documented import order, or use the larger standalone CSS. ([Kumo package README](https://raw.githubusercontent.com/cloudflare/kumo/main/packages/kumo/README.md#for-tailwind-css-users)) |
| Upgrade effort | Easy behavior-package bumps; deliberate source merges for wrapper changes. | Easier wrapper upgrades, but customization depends on Kumo's API/classes or local wrappers and remains coupled to its release choices. |
| Fit for Overseer | Generic, application-owned primitives align with Overseer's small-composable-primitives direction. | Credible and accessible, but its broader Cloudflare design-system surface is more opinionated than the MVP needs. |

Kumo is not rejected for compatibility or accessibility: its current peers explicitly include React 19, and it describes accessible Base UI behavior. ([Kumo metadata](https://registry.npmjs.org/@cloudflare/kumo/latest), [Kumo README](https://raw.githubusercontent.com/cloudflare/kumo/main/README.md)) It is rejected because Overseer would be adopting another product's wrapper, token, icon, CSS-discovery, and release boundary when the required headless behavior is available directly.

## Required application-owned boundary

Use this dependency direction:

```text
src/features/**
    ↓
src/ui/patterns/**          # IssueList, IssueEditor, Timeline, pickers, confirmations
    ↓
src/ui/primitives/**        # reviewed shadcn-generated source
    ↓
@base-ui/react + native HTML

src/ui/theme.css            # semantic tokens, dark mode, density, focus
src/ui/theme-provider.tsx   # preference/system policy
src/lib/ui-classnames.ts    # clsx + tailwind-merge only
```

Rules:

1. Only `src/ui/primitives/**` may import `@base-ui/react`, CVA, or shadcn-generated peer wrappers.
2. Features import Overseer's primitives/patterns, never Base UI or Kumo directly.
3. Primitive props stay generic (`size`, `variant`, `invalid`); domain terms stay in patterns/features.
4. `src/ui/theme.css` is the sole source for semantic color, focus, radius, and density policy.
5. Keep generated files committed, reviewed, typechecked, and tested as first-party source.
6. Expose explicit modules rather than a second component-library abstraction that attempts to hide every upstream prop.

That boundary captures Base UI's valuable interaction machinery without allowing shadcn's registry layout—or any future replacement—to become Overseer's product model.
