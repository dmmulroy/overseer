# Application shell

The shell renders Overseer's persistent navigation frame and the current Workspace context. It is presentation code over parsed URL state and reactive browser resources; it does not call HTTP directly.

## `AppShell`

[`app-shell.tsx`](app-shell.tsx) combines:

- the URL-backed `workspace_id` from TanStack Router;
- `discoveryQuery` and `workspaceQuery` from the browser adapter;
- keyboard, pointer, and mobile Workspace selectors;
- explicit loading, unavailable, stale, empty, and missing-selection views;
- responsive navigation and theme controls.

Selection updates only the URL. A valid URL remains in place while the collection loads or refresh fails. When stale cached data exists, the shell keeps it readable and labels it as stale. A failed refresh of an empty cached collection is not presented as a confirmed empty Workspace Registry.

## Boundaries

Keep network decoding and cache mechanics in `adapters/web-client`. Keep reusable visual concerns in `ui`. The shell may decide how browser states are presented, but it must not duplicate server-side domain or authorization policy.
