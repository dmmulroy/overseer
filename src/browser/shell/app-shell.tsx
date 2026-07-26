import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useState } from "react";
import { discoveryQuery, workspaceQuery } from "../../adapters/web-client/api-resources.ts";
import type { WorkspaceRepresentation } from "../../contract/http-api.ts";
import type { WorkspaceId } from "../../domain/entity-id.ts";
import { cn } from "../../lib/ui-classnames.ts";
import { Button } from "../../ui/primitives/button.tsx";
import { useTheme } from "../../ui/theme-provider.tsx";

function ThemeControl(): React.JSX.Element {
  const { preference, setPreference, storageStatus } = useTheme();
  return (
    <div className="grid gap-1.5 text-xs text-muted-foreground">
      <label className="grid gap-1.5">
        <span>Theme</span>
        <select
          aria-label="Theme"
          className="h-8 w-full rounded-md border bg-surface-raised px-2 text-foreground"
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
      {storageStatus === "invalid" ? (
        <p role="status">The saved theme preference was invalid. System theme is active.</p>
      ) : storageStatus === "unavailable" ? (
        <p role="status">
          Theme storage is unavailable. Your theme remains active for this session.
        </p>
      ) : null}
    </div>
  );
}

type WorkspaceSwitcherProps = {
  readonly mode: "desktop" | "mobile";
  readonly selectedId: Option.Option<WorkspaceId>;
  readonly select: (workspaceId: WorkspaceId) => void;
  readonly workspaces: ReadonlyArray<WorkspaceRepresentation>;
};

function WorkspaceSwitcher(props: WorkspaceSwitcherProps): React.JSX.Element {
  if (props.mode === "desktop") {
    return (
      <div className="workspace-buttons grid gap-1.5">
        {props.workspaces.map((workspace) => {
          const selected = Option.contains(props.selectedId, workspace.id);
          return (
            <Button
              aria-label={`Select ${workspace.name} Workspace`}
              aria-pressed={selected}
              className={cn(
                "workspace-button w-full justify-start overflow-hidden text-ellipsis",
                selected && "selected",
              )}
              key={workspace.id}
              onClick={() => props.select(workspace.id)}
              size="sm"
              type="button"
              variant={selected ? "default" : "ghost"}
            >
              <span className="truncate">{workspace.name}</span>
            </Button>
          );
        })}
      </div>
    );
  }

  return (
    <label className="mobile-workspace-selector grid gap-0.5 text-[10px] text-muted-foreground">
      <span>Workspace</span>
      <select
        aria-label="Workspace"
        className="h-8 max-w-44 rounded-md border bg-surface-raised px-2 text-foreground"
        value={Option.match(props.selectedId, {
          onNone: () => "",
          onSome: (selectedId) =>
            props.workspaces.some((workspace) => workspace.id === selectedId) ? selectedId : "",
        })}
        onChange={(event) => {
          const workspace = props.workspaces.find(
            (candidate) => candidate.id === event.currentTarget.value,
          );
          if (workspace !== undefined) props.select(workspace.id);
        }}
      >
        <option disabled value="">
          Choose Workspace
        </option>
        {props.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const noWorkspaces: ReadonlyArray<WorkspaceRepresentation> = [];

function UpdatingStatus(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), 2_000);
    return () => window.clearTimeout(timeout);
  }, []);
  return visible ? (
    <p className="mt-4 text-sm text-muted-foreground" role="status">
      Updating…
    </p>
  ) : null;
}

function StateCard(props: {
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <section
      className={cn(
        "state-card w-full max-w-xl rounded-md border bg-card p-6 sm:p-12",
        props.className,
      )}
    >
      {props.children}
    </section>
  );
}

function Eyebrow(props: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
      {props.children}
    </p>
  );
}

function LoadingCard(props: {
  readonly label: string;
  readonly title: string;
  readonly message: string;
}): React.JSX.Element {
  return (
    <StateCard>
      <div
        className="loading-indicator mb-6 h-1 w-8 bg-foreground motion-safe:animate-pulse"
        aria-hidden="true"
      />
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{props.title}</h1>
      <p className="mt-4 max-w-[44ch] leading-6 text-muted-foreground">{props.message}</p>
      <span aria-label={props.label} className="sr-only" role="status">
        {props.label}
      </span>
    </StateCard>
  );
}

function ShellNavigation(props: {
  readonly mobileContext: string;
  readonly selectedId: Option.Option<WorkspaceId>;
  readonly selectWorkspace: (workspaceId: WorkspaceId) => void;
  readonly workspaces: ReadonlyArray<WorkspaceRepresentation>;
}): React.JSX.Element {
  return (
    <>
      <header className="mobile-header flex min-h-13 items-center justify-between gap-4 border-b bg-surface px-4 md:hidden">
        <Link
          className="brand text-lg font-bold tracking-tight"
          to="/"
          search={(previous) => ({ workspace_id: previous.workspace_id })}
        >
          Overseer
        </Link>
        {props.workspaces.length > 0 ? (
          <WorkspaceSwitcher
            mode="mobile"
            selectedId={props.selectedId}
            select={props.selectWorkspace}
            workspaces={props.workspaces}
          />
        ) : (
          <span className="truncate text-xs text-muted-foreground">{props.mobileContext}</span>
        )}
      </header>
      <nav
        className="context-rail fixed inset-y-0 left-0 hidden w-61 flex-col border-r bg-surface px-4.5 py-6 md:flex"
        aria-label="Workspace and Project context"
      >
        <Link
          className="brand text-lg font-bold tracking-tight"
          to="/"
          search={(previous) => ({ workspace_id: previous.workspace_id })}
        >
          Overseer
        </Link>
        <div className="mt-8">
          <Eyebrow>Workspace</Eyebrow>
          {props.workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet</p>
          ) : (
            <WorkspaceSwitcher
              mode="desktop"
              selectedId={props.selectedId}
              select={props.selectWorkspace}
              workspaces={props.workspaces}
            />
          )}
        </div>
        <div className="mt-8">
          <Eyebrow>Project</Eyebrow>
          <p className="text-sm text-muted-foreground">None yet</p>
        </div>
        <div className="mt-auto">
          <ThemeControl />
        </div>
      </nav>
    </>
  );
}

type WorkspaceContentProps = {
  readonly discoveryInitial: boolean;
  readonly discoveryUnavailable: boolean;
  readonly lastValidated: Option.Option<string>;
  readonly refreshDiscovery: () => void;
  readonly refreshWorkspaces: () => void;
  readonly selectedWorkspace: Option.Option<WorkspaceRepresentation>;
  readonly waiting: boolean;
  readonly workspaceInitial: boolean;
  readonly workspaceStale: boolean;
  readonly workspaceUnavailable: boolean;
  readonly workspaces: ReadonlyArray<WorkspaceRepresentation>;
};

function WorkspaceContent(props: WorkspaceContentProps): React.JSX.Element {
  if (props.discoveryInitial) {
    return (
      <LoadingCard
        label="Loading Overseer"
        title="Loading Overseer"
        message="Checking your authenticated workspace context…"
      />
    );
  }
  if (props.discoveryUnavailable) {
    return (
      <StateCard>
        <div role="alert">
          <Eyebrow>Connection unavailable</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Overseer is unavailable
          </h1>
          <p className="mt-4 leading-6 text-muted-foreground">
            Your work has not been changed. Retry the authenticated request.
          </p>
          <Button className="mt-6" onClick={props.refreshDiscovery}>
            Retry
          </Button>
        </div>
      </StateCard>
    );
  }
  if (props.workspaceInitial) {
    return (
      <LoadingCard
        label="Loading Workspace context"
        title="Loading Workspace context"
        message="The selected URL will remain in place while Overseer loads it."
      />
    );
  }
  if (props.workspaceUnavailable) {
    return (
      <StateCard>
        <div role="alert">
          <Eyebrow>Connection unavailable</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Workspace context unavailable
          </h1>
          <p className="mt-4 leading-6 text-muted-foreground">
            The selected Workspace URL is unchanged. Retry when the Workspace Registry is available.
          </p>
          <Button className="mt-6" onClick={props.refreshWorkspaces}>
            Retry Workspaces
          </Button>
        </div>
      </StateCard>
    );
  }
  if (props.workspaceStale && props.workspaces.length === 0) {
    return (
      <StateCard>
        <div role="status">
          <Eyebrow>Workspace context may be stale</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Workspace context could not be refreshed
          </h1>
          <p className="mt-4 leading-6 text-muted-foreground">
            The selected Workspace URL is unchanged. Retry before treating this as an empty
            Workspace Registry.
          </p>
          <Button className="mt-6" onClick={props.refreshWorkspaces}>
            Retry Workspaces
          </Button>
        </div>
      </StateCard>
    );
  }
  if (props.workspaces.length === 0) {
    return (
      <StateCard>
        <Eyebrow>Workspace context</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">No workspaces yet</h1>
        <p className="mt-4 leading-6 text-muted-foreground">
          Overseer is ready. Your first Workspace will appear here once it is created.
        </p>
        <Button className="mt-6" onClick={props.refreshWorkspaces}>
          Refresh Workspaces
        </Button>
      </StateCard>
    );
  }
  if (Option.isNone(props.selectedWorkspace)) {
    return (
      <StateCard>
        <div role="alert">
          <Eyebrow>Workspace unavailable</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Selected Workspace unavailable
          </h1>
          <p className="mt-4 leading-6 text-muted-foreground">
            Choose an available Workspace without rewriting the requested URL automatically.
          </p>
        </div>
      </StateCard>
    );
  }

  return (
    <StateCard className="workspace-context">
      <Eyebrow>Workspace context</Eyebrow>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {props.selectedWorkspace.value.name}
      </h1>
      <p className="mt-4 leading-6 text-muted-foreground">
        No Projects yet. This Workspace remains selected in the URL.
      </p>
      {props.waiting ? <UpdatingStatus /> : null}
      {props.workspaceStale ? (
        <div
          className="stale-notice mt-5 grid gap-1 border-l-3 border-ring pl-3 text-sm text-muted-foreground"
          role="status"
        >
          <strong className="text-foreground">Workspace data may be stale</strong>
          <span>
            {Option.match(props.lastValidated, {
              onNone: () => "The last loaded context remains readable.",
              onSome: (timestamp) =>
                `Last validated ${timestamp}. The loaded context remains readable.`,
            })}
          </span>
        </div>
      ) : null}
      <Button className="mt-6" onClick={props.refreshWorkspaces}>
        Refresh Workspaces
      </Button>
    </StateCard>
  );
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
  const selectWorkspace = useCallback(
    (workspaceId: WorkspaceId) => {
      void navigate({
        search: (previous) => ({ ...previous, workspace_id: workspaceId }),
      });
    },
    [navigate],
  );

  const mobileContext = Option.match(selectedWorkspace, {
    onNone: () => "No Project selected",
    onSome: (workspace) => workspace.name,
  });
  const discoveryUnavailable =
    AsyncResult.isFailure(discovery) && Option.isNone(AsyncResult.value(discovery));
  const workspaceUnavailable = AsyncResult.isFailure(workspacesState) && Option.isNone(resource);
  const workspaceStale = AsyncResult.isFailure(workspacesState) && Option.isSome(resource);
  const lastValidated = Option.map(resource, (value) =>
    new Date(value.validatedAt).toLocaleString(),
  );

  return (
    <div className="app-frame min-h-screen">
      <ShellNavigation
        mobileContext={mobileContext}
        selectedId={workspaceId}
        selectWorkspace={selectWorkspace}
        workspaces={workspaces}
      />
      <main
        className="content grid min-h-[calc(100vh-3.25rem)] place-items-center px-4 py-6 md:ml-61 md:min-h-screen md:p-12"
        aria-live="polite"
      >
        <div className="absolute right-4 top-17 w-28 md:hidden">
          <ThemeControl />
        </div>
        <WorkspaceContent
          discoveryInitial={discovery._tag === "Initial"}
          discoveryUnavailable={discoveryUnavailable}
          lastValidated={lastValidated}
          refreshDiscovery={refreshDiscovery}
          refreshWorkspaces={refreshWorkspaces}
          selectedWorkspace={selectedWorkspace}
          waiting={workspacesState.waiting}
          workspaceInitial={workspacesState._tag === "Initial"}
          workspaceStale={workspaceStale}
          workspaceUnavailable={workspaceUnavailable}
          workspaces={workspaces}
        />
      </main>
    </div>
  );
}
