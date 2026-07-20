import { useCallback, useSyncExternalStore } from "react";
import type { BrowserResources } from "../../adapters/browser/effect-http-resources.ts";
import { useTheme } from "../../ui/theme-provider.tsx";

type AppShellProps = {
  readonly resources: BrowserResources;
};

function useDiscovery(resources: BrowserResources) {
  const subscribe = useCallback(
    (notify: () => void) => resources.subscribeDiscovery(notify),
    [resources],
  );
  const getSnapshot = useCallback(
    () => resources.getDiscovery(),
    [resources],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

function ThemeControl(): React.JSX.Element {
  const { preference, setPreference } = useTheme();
  return (
    <label className="theme-control">
      <span>Theme</span>
      <select
        aria-label="Theme"
        value={preference}
        onChange={(event) => {
          const selected = event.currentTarget.value;
          if (selected === "light" || selected === "dark" || selected === "system") {
            setPreference(selected);
          }
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

/** Render the authenticated, responsive application shell. */
export function AppShell({ resources }: AppShellProps): React.JSX.Element {
  const discovery = useDiscovery(resources);
  const refresh = useCallback(() => {
    resources.refreshDiscovery();
  }, [resources]);

  return (
    <div className="app-frame">
      <header className="mobile-header">
        <a className="brand" href="/">Overseer</a>
        <span className="context-label">No Project selected</span>
      </header>
      <nav className="context-rail" aria-label="Workspace and Project context">
        <a className="brand" href="/">Overseer</a>
        <div className="rail-section">
          <p className="eyebrow">Workspace</p>
          <p className="muted">None yet</p>
        </div>
        <div className="rail-section">
          <p className="eyebrow">Project</p>
          <p className="muted">None yet</p>
        </div>
        <div className="rail-footer"><ThemeControl /></div>
      </nav>
      <main className="content" aria-live="polite">
        <div className="mobile-theme"><ThemeControl /></div>
        {discovery._tag === "Initial" ? (
          <section className="state-card" aria-label="Loading Overseer" role="status">
            <div className="loading-mark" aria-hidden="true" />
            <h1>Loading Overseer</h1>
            <p>Checking your authenticated workspace context…</p>
          </section>
        ) : discovery._tag === "Failure" ? (
          <section className="state-card" role="alert">
            <p className="eyebrow">Connection unavailable</p>
            <h1>Overseer is unavailable</h1>
            <p>Your work has not been changed. Retry the authenticated request.</p>
            <button type="button" onClick={refresh}>Retry</button>
          </section>
        ) : (
          <section className="state-card empty-state">
            <p className="eyebrow">Workspace context</p>
            <h1>No workspaces yet</h1>
            <p>Overseer is ready. Your first Workspace will appear here once it is created.</p>
          </section>
        )}
      </main>
    </div>
  );
}
