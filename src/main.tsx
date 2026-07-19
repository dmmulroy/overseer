import { RegistryProvider, useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Cause, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Issue } from "./api";
import {
  controlAtom,
  issueAtom,
  issueListAtom,
  optimisticIssueAtom,
  setIssueStateAtom,
  updateTitleAtom,
  type ControlAction,
  type Validated,
} from "./client-atoms";
import "./prototype.css";

interface Draft {
  readonly text: string;
  readonly baseRevision: number;
  readonly baseTitle: string;
}

const draftKey = (issueId: string): string => `overseer-prototype:draft:${issueId}`;

const readDraft = (issueId: string): Draft | null => {
  const encoded = localStorage.getItem(draftKey(issueId));
  if (encoded === null) return null;
  try {
    const value: unknown = JSON.parse(encoded);
    if (
      typeof value === "object" &&
      value !== null &&
      "text" in value &&
      typeof value.text === "string" &&
      "baseRevision" in value &&
      typeof value.baseRevision === "number" &&
      "baseTitle" in value &&
      typeof value.baseTitle === "string"
    ) {
      return {
        text: value.text,
        baseRevision: value.baseRevision,
        baseTitle: value.baseTitle,
      };
    }
  } catch {
    localStorage.removeItem(draftKey(issueId));
  }
  return null;
};

const useDraft = (issue: Issue): readonly [Draft | null, (draft: Draft | null) => void] => {
  const [draft, setDraftState] = useState<Draft | null>(() => readDraft(issue.id));
  const setDraft = (next: Draft | null): void => {
    setDraftState(next);
    if (next === null) localStorage.removeItem(draftKey(issue.id));
    else localStorage.setItem(draftKey(issue.id), JSON.stringify(next));
  };
  return [draft, setDraft];
};

const formatTime = (milliseconds: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(milliseconds);

function PipelineStrip() {
  return (
    <div className="pipeline-strip" aria-label="Architecture pipeline">
      <strong>Effect HttpApi</strong><span>→</span>
      <strong>AtomHttpApi generated client</strong><span>→</span>
      <strong>conditional query + native optimistic atoms</strong><span>→</span>
      <strong>React subscriptions</strong><span>→</span>
      <strong>TanStack URL routes</strong>
    </div>
  );
}

function FailureLab() {
  const [result, run] = useAtom(controlAtom);
  const actions: ReadonlyArray<readonly [ControlAction, string]> = [
    ["external-change", "External title change"],
    ["slow-next-read", "Delay next read 4s"],
    ["fail-next-read", "Fail next read"],
    ["fail-next-write", "Fail next write"],
    ["reset", "Reset server"],
  ];
  return (
    <aside className="lab">
      <div>
        <strong>Failure lab</strong>
        <span>{result.waiting ? "running…" : result._tag.toLowerCase()}</span>
      </div>
      <div className="lab-actions">
        {actions.map(([action, label]) => (
          <button key={action} onClick={() => run(action)} disabled={result.waiting}>
            {label}
          </button>
        ))}
      </div>
    </aside>
  );
}

function ReadMetadata(props: { result: AsyncResult.AsyncResult<Validated<unknown>, unknown> }) {
  const value = Option.getOrUndefined(AsyncResult.value(props.result));
  return (
    <dl className="metadata">
      <div><dt>Atom</dt><dd>{props.result._tag}{props.result.waiting ? " · waiting" : ""}</dd></div>
      <div><dt>HTTP</dt><dd>{value?.validation ?? "—"}</dd></div>
      <div><dt>ETag</dt><dd>{value?.etag ?? "—"}</dd></div>
      <div><dt>Validated</dt><dd>{value === undefined ? "—" : formatTime(value.validatedAt)}</dd></div>
      <div><dt>Persistence</dt><dd>session memory</dd></div>
    </dl>
  );
}

function RootLayout() {
  return (
    <>
      <PipelineStrip />
      <header className="site-header">
        <Link to="/projects/$projectId/issues" params={{ projectId: "project_01" }}>
          Overseer pipeline specimen
        </Link>
        <span>Router loaders intentionally own no server state</span>
      </header>
      <Outlet />
    </>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

function IssueListPage() {
  const { projectId } = listRoute.useParams();
  const atom = issueListAtom(projectId);
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  const value = Option.getOrUndefined(AsyncResult.value(result));

  return (
    <main className="page">
      <section className="heading">
        <div>
          <p className="eyebrow">Project {projectId}</p>
          <h1>Issues</h1>
          <p>Mounted route polls this exact page every 30 seconds; leaving disposes polling but retains a bounded in-memory value.</p>
        </div>
        <button className="primary" onClick={refresh}>Validate now</button>
      </section>

      {result._tag === "Failure" && (
        <div className="error-banner">
          <strong>Couldn’t refresh.</strong> Cached data remains visible; writes are blocked until validation succeeds.
          <button onClick={refresh}>Retry now</button>
          <code>{Cause.pretty(result.cause)}</code>
        </div>
      )}
      {value === undefined ? (
        <div className="empty">{result._tag === "Failure" ? "Unavailable" : "Loading exact Issue page…"}</div>
      ) : (
        <section className="issue-list">
          {value.representation.items.map((issue) => (
            <Link
              key={issue.id}
              to="/projects/$projectId/issues/$issueId"
              params={{ projectId, issueId: issue.id }}
              className="issue-row"
            >
              <span>#{issue.number}</span>
              <strong>{issue.title}</strong>
              <em>{issue.state}</em>
            </Link>
          ))}
        </section>
      )}
      <ReadMetadata result={result} />
      <FailureLab />
    </main>
  );
}

function IssueDetailPage() {
  const { projectId, issueId } = detailRoute.useParams();
  const query = optimisticIssueAtom(issueId);
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(issueAtom(issueId));
  const value = Option.getOrUndefined(AsyncResult.value(result));

  if (value === undefined) {
    return (
      <main className="page">
        <div className="empty">{result._tag === "Failure" ? Cause.pretty(result.cause) : "Loading Issue…"}</div>
        <FailureLab />
      </main>
    );
  }

  return (
    <IssueDetailLoaded
      projectId={projectId}
      validated={value}
      result={result}
      refresh={refresh}
    />
  );
}

function IssueDetailLoaded(props: {
  readonly projectId: string;
  readonly validated: Validated<Issue>;
  readonly result: AsyncResult.AsyncResult<Validated<Issue>, unknown>;
  readonly refresh: () => void;
}) {
  const issue = props.validated.representation;
  const [draft, setDraft] = useDraft(issue);
  const [saveResult, save] = useAtom(updateTitleAtom(issue.id));
  const [stateResult, setState] = useAtom(setIssueStateAtom(issue.id));
  const handledSave = useRef(0);
  const incoming = draft !== null && draft.baseRevision !== issue.current_title_revision;

  useEffect(() => {
    if (saveResult._tag === "Success" && saveResult.timestamp > handledSave.current) {
      handledSave.current = saveResult.timestamp;
      setDraft(null);
    }
  }, [saveResult, setDraft]);

  const edit = (text: string): void => {
    setDraft({
      text,
      baseRevision: draft?.baseRevision ?? issue.current_title_revision,
      baseTitle: draft?.baseTitle ?? issue.title,
    });
  };

  return (
    <main className="page">
      <div className="breadcrumbs">
        <Link to="/projects/$projectId/issues" params={{ projectId: props.projectId }}>Issues</Link>
        <span>/ #{issue.number}</span>
      </div>
      <section className="heading">
        <div>
          <p className="eyebrow">Issue #{issue.number} · revision {issue.current_title_revision}</p>
          <h1>{issue.title}</h1>
          <p>Detail polling is 15 seconds. A mutation older than the five-second grace forces and awaits query validation inside Effect before sending.</p>
        </div>
        <div className="heading-actions">
          <button onClick={props.refresh}>Validate now</button>
          <button
            className="primary"
            disabled={props.result._tag === "Failure" || stateResult.waiting}
            onClick={() => setState({
              projectId: props.projectId,
              issueId: issue.id,
              state: issue.state === "open" ? "closed" : "open",
            })}
          >
            {stateResult.waiting ? "Committing…" : issue.state === "open" ? "Close" : "Reopen"}
          </button>
        </div>
      </section>

      {props.result._tag === "Failure" && (
        <div className="error-banner">
          <strong>Couldn’t refresh — canonical data is stale.</strong>
          <span>Server writes are disabled; the device-local draft remains editable.</span>
          <button onClick={props.refresh}>Retry now</button>
          <code>{Cause.pretty(props.result.cause)}</code>
        </div>
      )}

      <section className="editor-card">
        <div className="editor-label">
          <strong>Title draft</strong>
          <span>{draft === null ? "not persisted" : `prototype localStorage · based on revision ${draft.baseRevision}`}</span>
        </div>
        <textarea value={draft?.text ?? issue.title} onChange={(event) => edit(event.target.value)} />
        {incoming && draft !== null && (
          <div className="incoming">
            <strong>Canonical title changed to revision {issue.current_title_revision}</strong>
            <p>{issue.title}</p>
            <button onClick={() => setDraft(null)}>Use incoming version</button>
            <span>or keep editing and explicitly save over it</span>
          </div>
        )}
        <div className="editor-actions">
          <span>Canonical reads are never persisted.</span>
          <button onClick={() => setDraft(null)} disabled={draft === null}>Discard draft</button>
          <button
            className="primary"
            disabled={draft === null || props.result._tag === "Failure" || saveResult.waiting}
            onClick={() => {
              if (draft !== null) save({ projectId: props.projectId, issueId: issue.id, title: draft.text });
            }}
          >
            {saveResult.waiting ? "Saving optimistically…" : "Save"}
          </button>
        </div>
        {saveResult._tag === "Failure" && <code className="command-error">{Cause.pretty(saveResult.cause)}</code>}
        {stateResult._tag === "Failure" && <code className="command-error">{Cause.pretty(stateResult.cause)}</code>}
      </section>

      <ReadMetadata result={props.result} />
      <section className="ownership">
        <h2>Ownership demonstrated</h2>
        <ul>
          <li><strong>HttpApi:</strong> request/response/error types and generated methods.</li>
          <li><strong>Effect Atom:</strong> execution, interruption, prior success, SWR, route-scoped polling, reactivity, optimism, rollback.</li>
          <li><strong>React:</strong> rendering and ephemeral form interaction only.</li>
          <li><strong>TanStack Router:</strong> typed URL params/navigation; no competing route cache or Promise-shaped ensure seam.</li>
          <li><strong>Draft adapter:</strong> explicit drafts only—localStorage in this specimen, IndexedDB in production.</li>
        </ul>
      </section>
      <FailureLab />
    </main>
  );
}

const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/issues",
  component: IssueListPage,
});

const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/issues/$issueId",
  component: IssueDetailPage,
});

const routeTree = rootRoute.addChildren([listRoute, detailRoute]);
const router = createRouter({ routeTree, defaultPreloadStaleTime: 0 });

declare module "@tanstack/react-router" {
  interface Register {
    readonly router: typeof router;
  }
}

const root = document.getElementById("root");
if (root === null) throw new Error("Prototype root element is missing");

createRoot(root).render(
  <StrictMode>
    <RegistryProvider>
      <RouterProvider router={router} />
    </RegistryProvider>
  </StrictMode>,
);
