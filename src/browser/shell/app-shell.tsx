import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { useCallback, useEffect, useState } from "react";
import {
  loadDiscovery,
} from "../../adapters/browser/effect-http-resources.ts";
import type { DiscoveryDocument } from "../../contract/http-api.ts";
import { useTheme } from "../../ui/theme-provider.tsx";

type ShellState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Empty"; readonly discovery: DiscoveryDocument }
  | { readonly _tag: "Unavailable"; readonly error: unknown };

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
export function AppShell(): React.JSX.Element {
  const [state, setState] = useState<ShellState>({ _tag: "Loading" });
  const refresh = useCallback(() => {
    setState({ _tag: "Loading" });
    void Effect.runPromiseExit(loadDiscovery()).then((exit) => {
      setState(Exit.isSuccess(exit)
        ? { _tag: "Empty", discovery: exit.value }
        : { _tag: "Unavailable", error: Cause.squash(exit.cause) });
    });
  }, []);

  useEffect(refresh, [refresh]);

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
        {state._tag === "Loading" ? (
          <section className="state-card" aria-label="Loading Overseer" role="status">
            <div className="loading-mark" aria-hidden="true" />
            <h1>Loading Overseer</h1>
            <p>Checking your authenticated workspace context…</p>
          </section>
        ) : state._tag === "Unavailable" ? (
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
