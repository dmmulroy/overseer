import {
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import {
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  discoveryQuery,
  workspaceQuery,
} from "../../adapters/browser/effect-http-resources.ts";
import type { WorkspaceRepresentation } from "../../contract/http-api.ts";
import type { WorkspaceId } from "../../domain/entity-id.ts";
import { useTheme } from "../../ui/theme-provider.tsx";

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

function WorkspaceControls(props: {
  readonly selectedId: Option.Option<WorkspaceId>;
  readonly select: (workspaceId: WorkspaceId) => void;
  readonly workspaces: ReadonlyArray<WorkspaceRepresentation>;
}): React.JSX.Element {
  return (
    <>
      <div className="workspace-buttons">
        {props.workspaces.map((workspace) => (
          <button
            aria-label={`Select ${workspace.name} Workspace`}
            className={Option.contains(props.selectedId, workspace.id)
              ? "workspace-button selected"
              : "workspace-button"}
            key={workspace.id}
            onClick={() => props.select(workspace.id)}
            type="button"
          >
            {workspace.name}
          </button>
        ))}
      </div>
      <label className="mobile-workspace-selector">
        <span>Workspace</span>
        <select
          aria-label="Workspace"
          value={Option.getOrElse(props.selectedId, () => "")}
          onChange={(event) => {
            const workspace = props.workspaces.find(
              (candidate) => candidate.id === event.currentTarget.value,
            );
            if (workspace !== undefined) props.select(workspace.id);
          }}
        >
          {props.workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
      </label>
    </>
  );
}

const noWorkspaces: ReadonlyArray<WorkspaceRepresentation> = [];

function UpdatingStatus(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), 2_000);
    return () => window.clearTimeout(timeout);
  }, []);
  return visible ? <p className="updating-status" role="status">Updating…</p> : null;
}

/** Render the authenticated, responsive application shell. */
export function AppShell(): React.JSX.Element {
  const discovery = useAtomValue(discoveryQuery);
  const workspacesState = useAtomValue(workspaceQuery);
  const refreshDiscovery = useAtomRefresh(discoveryQuery);
  const refreshWorkspaces = useAtomRefresh(workspaceQuery);
  const navigate = useNavigate({ from: "/" });
  const search = useSearch({ from: "__root__" });
  const resource = AsyncResult.value(workspacesState);
  const workspaces = Option.match(resource, {
    onNone: () => noWorkspaces,
    onSome: (value) => value.collection.items,
  });
  const workspaceId = Option.fromNullishOr(search.workspace_id);
  const selectedWorkspace = Option.fromNullishOr(
    workspaces.find((workspace) => Option.contains(workspaceId, workspace.id)),
  );
  const selectWorkspace = useCallback((workspaceId: WorkspaceId) => {
    void navigate({
      search: (previous) => ({ ...previous, workspace_id: workspaceId }),
    });
  }, [navigate]);

  useEffect(() => {
    if (search.workspace_id === undefined) {
      const first = workspaces[0];
      if (first !== undefined) selectWorkspace(first.id);
    }
  }, [search.workspace_id, selectWorkspace, workspaces]);

  const mobileContext = Option.match(selectedWorkspace, {
    onNone: () => "No Project selected",
    onSome: (workspace) => workspace.name,
  });
  const discoveryUnavailable = AsyncResult.isFailure(discovery) &&
    Option.isNone(AsyncResult.value(discovery));
  const workspaceUnavailable = AsyncResult.isFailure(workspacesState) && Option.isNone(resource);
  const workspaceStale = AsyncResult.isFailure(workspacesState) && Option.isSome(resource);
  const lastValidated = Option.map(resource, (value) =>
    new Date(value.validatedAt).toLocaleString()
  );

  return (
    <div className="app-frame">
      <header className="mobile-header">
        <Link
          className="brand"
          to="/"
          search={(previous) => ({ workspace_id: previous.workspace_id })}
        >Overseer</Link>
        {workspaces.length > 0 ? (
          <WorkspaceControls
            selectedId={workspaceId}
            select={selectWorkspace}
            workspaces={workspaces}
          />
        ) : <span className="context-label">{mobileContext}</span>}
      </header>
      <nav className="context-rail" aria-label="Workspace and Project context">
        <Link
          className="brand"
          to="/"
          search={(previous) => ({ workspace_id: previous.workspace_id })}
        >Overseer</Link>
        <div className="rail-section">
          <p className="eyebrow">Workspace</p>
          {workspaces.length === 0
            ? <p className="muted">None yet</p>
            : (
              <WorkspaceControls
                selectedId={workspaceId}
                select={selectWorkspace}
                workspaces={workspaces}
              />
            )}
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
        ) : discoveryUnavailable ? (
          <section className="state-card" role="alert">
            <p className="eyebrow">Connection unavailable</p>
            <h1>Overseer is unavailable</h1>
            <p>Your work has not been changed. Retry the authenticated request.</p>
            <button type="button" onClick={refreshDiscovery}>Retry</button>
          </section>
        ) : workspacesState._tag === "Initial" ? (
          <section className="state-card" aria-label="Loading Workspace context" role="status">
            <div className="loading-mark" aria-hidden="true" />
            <h1>Loading Workspace context</h1>
            <p>The selected URL will remain in place while Overseer loads it.</p>
          </section>
        ) : workspaceUnavailable ? (
          <section className="state-card" role="alert">
            <p className="eyebrow">Connection unavailable</p>
            <h1>Workspace context unavailable</h1>
            <p>The selected Workspace URL is unchanged. Retry when the Catalog is available.</p>
            <button type="button" onClick={refreshWorkspaces}>Retry Workspaces</button>
          </section>
        ) : workspaces.length === 0 ? (
          <section className="state-card empty-state">
            <p className="eyebrow">Workspace context</p>
            <h1>No workspaces yet</h1>
            <p>Overseer is ready. Your first Workspace will appear here once it is created.</p>
          </section>
        ) : Option.isNone(selectedWorkspace) ? (
          <section className="state-card" role="alert">
            <p className="eyebrow">Workspace unavailable</p>
            <h1>Selected Workspace unavailable</h1>
            <p>Choose an available Workspace without rewriting the requested URL automatically.</p>
          </section>
        ) : (
          <section className="state-card workspace-context">
            <p className="eyebrow">Workspace context</p>
            <h1>{selectedWorkspace.value.name}</h1>
            <p>No Projects yet. This Workspace remains selected in the URL.</p>
            {workspacesState.waiting ? <UpdatingStatus /> : null}
            {workspaceStale ? (
              <div className="stale-notice" role="status">
                <strong>Workspace data may be stale</strong>
                <span>
                  {Option.match(lastValidated, {
                    onNone: () => "The last loaded context remains readable.",
                    onSome: (timestamp) =>
                      `Last validated ${timestamp}. The loaded context remains readable.`,
                  })}
                </span>
              </div>
            ) : null}
            <button type="button" onClick={refreshWorkspaces}>Refresh Workspaces</button>
          </section>
        )}
      </main>
    </div>
  );
}
