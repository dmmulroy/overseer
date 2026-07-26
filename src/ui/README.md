# Shared UI

This directory contains presentation concerns shared by browser components but independent of application operations and server protocols.

## Current modules

- `theme-provider.tsx` owns the light, dark, and system theme preference, persistence, and React context.
- `theme.css` defines semantic tokens, Tailwind v4 theme mappings, base styles, and theme-specific values.
- `primitives/` contains reviewed shadcn-generated wrappers over Base UI.

## Rules

Keep reusable visual state and styling here. URL parsing belongs in `browser/`, network resources belong in `adapters/web-client/`, and domain/application policy belongs outside the UI entirely.

Follow Tailwind CSS v4 and shadcn's Base UI conventions. Prefer semantic variables mapped through `@theme inline` and Tailwind utilities over bespoke component CSS. Add primitives through the shadcn CLI, review the generated wrappers, and keep them under `primitives/`.

UI code may format values for display, but it should consume already parsed types and safe messages. It must not infer authorization, recreate domain validation, or treat browser-cached resources as authoritative.
