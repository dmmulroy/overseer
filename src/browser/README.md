# Browser application

This directory is the browser composition root and navigation layer. It wires React, Effect Atom, TanStack Router, the shared UI providers, and the application shell.

## Main modules

- `main.tsx` mounts React, creates the shared Atom registry, installs `ThemeProvider`, and starts the router. Top-level side effects belong here because this is the browser entrypoint.
- `route-tree.tsx` owns URL parsing. It parses `workspace_id` through the branded `WorkspaceId` schema before the value reaches components.
- [`shell/`](shell/README.md) renders navigation and the current Workspace context.

## State ownership

The URL owns the selected Workspace ID. Server resources come from the browser adapter's Effect atoms. Components do not rewrite a valid requested URL merely because data is loading, stale, or temporarily unavailable.

The browser is not authoritative for domain data. Its resources are disposable observations, and UI state should explicitly distinguish loading, stale data, unavailable data, and confirmed empty collections.
