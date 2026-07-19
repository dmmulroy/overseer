import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Clock3,
  ListFilter,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Select, type SelectOption } from "@/ui/components/select";

// PROTOTYPE — Four issue discovery structures, switchable with ?variant= on
// /prototype/issue-discovery. All variants use the approved Crisp foundation.

type Variant = "A" | "B" | "C" | "D";
type Mode = "light" | "dark";
type Freshness = "fresh" | "refreshing" | "stale";
type ProjectId = "personal-overseer" | "personal-household" | "northstar-launchpad";
type IssueId = "issue-41" | "issue-42" | "issue-43" | "issue-44" | "issue-39" | "issue-45" | "issue-48" | "issue-12" | "issue-13" | "issue-21";
type IssueState = "open" | "closed";
type StateFilter = "open" | "closed" | "all";
type AssigneeFilter = "any" | "assigned" | "unassigned";
type LabelFilter = "any" | "wayfinder:prototype" | "ready-for-human" | "ready-for-agent" | "needs-triage";
type BlockingFilter = "any" | "blocked" | "unblocked";
type TransitionSource = "session-cache" | "prefetch" | "network";

type Project = {
  readonly id: ProjectId;
  readonly workspace: string;
  readonly name: string;
  readonly openCount: number;
  readonly shortMark: string;
};

type Issue = {
  readonly id: IssueId;
  readonly projectId: ProjectId;
  readonly number: number;
  readonly title: string;
  readonly state: IssueState;
  readonly labels: ReadonlyArray<Exclude<LabelFilter, "any">>;
  readonly assignee: string | null;
  readonly updated: string;
  readonly comments: number;
  readonly blockerCount: number;
  readonly summary: string;
  readonly cached: boolean;
};

type Filters = {
  readonly state: StateFilter;
  readonly assignee: AssigneeFilter;
  readonly label: LabelFilter;
  readonly blocking: BlockingFilter;
};

type InitialState = {
  readonly variant: Variant;
  readonly mode: Mode;
  readonly freshness: Freshness;
  readonly projectId: ProjectId;
  readonly selectedIssueId: IssueId;
  readonly routeOpen: boolean;
  readonly filters: Filters;
};

const variantOrder: ReadonlyArray<Variant> = ["A", "B", "C", "D"];
const variantMeta: Readonly<Record<Variant, { readonly name: string; readonly thesis: string }>> = {
  A: { name: "Triage rail", thesis: "Workspace context, issue queue, and selected issue stay spatially anchored in three panes." },
  B: { name: "Issue ledger", thesis: "A full-width comparison table keeps scanning primary and opens selection in a bottom dock." },
  C: { name: "Route stack", thesis: "A compact list owns the screen; selection navigates to one focused issue and Back restores filters." },
  D: { name: "Rail + route", thesis: "A persistent context rail frames one focused route, with the full structured filter strip kept visible." },
};

const projects: Readonly<Record<ProjectId, Project>> = {
  "personal-overseer": { id: "personal-overseer", workspace: "Personal", name: "Overseer", openCount: 5, shortMark: "P" },
  "personal-household": { id: "personal-household", workspace: "Personal", name: "Household", openCount: 1, shortMark: "P" },
  "northstar-launchpad": { id: "northstar-launchpad", workspace: "Northstar Studio", name: "Launchpad", openCount: 2, shortMark: "N" },
};

const issuesByProject: Readonly<Record<ProjectId, ReadonlyArray<Issue>>> = {
  "personal-overseer": [
    {
      id: "issue-41", projectId: "personal-overseer", number: 41,
      title: "Prototype issue discovery and navigation in shadcn/Base UI",
      state: "open", labels: ["wayfinder:prototype", "ready-for-human"], assignee: "dmmulroy",
      updated: "6 minutes ago", comments: 0, blockerCount: 0, cached: true,
      summary: "Compare the smallest structures for switching context, narrowing issues, selecting work, and understanding freshness on every screen size.",
    },
    {
      id: "issue-42", projectId: "personal-overseer", number: 42,
      title: "Prototype issue detail steering in shadcn/Base UI",
      state: "open", labels: ["wayfinder:prototype", "ready-for-agent"], assignee: null,
      updated: "24 minutes ago", comments: 3, blockerCount: 1, cached: false,
      summary: "Test how state, claim, Labels, parent/sub-issues, and blocking relations guide the next action.",
    },
    {
      id: "issue-43", projectId: "personal-overseer", number: 43,
      title: "Prototype timeline and contribution in shadcn/Base UI",
      state: "open", labels: ["wayfinder:prototype"], assignee: "claude-code/session-8f2",
      updated: "1 hour ago", comments: 5, blockerCount: 0, cached: true,
      summary: "Explore an ordered Timeline that keeps comments and structured changes readable without an activity dashboard.",
    },
    {
      id: "issue-44", projectId: "personal-overseer", number: 44,
      title: "Prototype mutation and recovery in shadcn/Base UI",
      state: "open", labels: ["wayfinder:prototype", "needs-triage"], assignee: null,
      updated: "3 hours ago", comments: 2, blockerCount: 2, cached: false,
      summary: "Make drafts, optimistic actions, failed validation, and stale reads recoverable without hiding canonical state.",
    },
    {
      id: "issue-39", projectId: "personal-overseer", number: 39,
      title: "Prototype the Effect HTTP → Atom → React → TanStack client pipeline",
      state: "closed", labels: ["ready-for-human"], assignee: "dmmulroy",
      updated: "yesterday", comments: 4, blockerCount: 0, cached: true,
      summary: "A wired specimen for conditional reads, SWR, polling, optimistic updates, and device-local drafts.",
    },
    {
      id: "issue-45", projectId: "personal-overseer", number: 45,
      title: "Define simple REST polling and freshness policy",
      state: "closed", labels: ["ready-for-human"], assignee: "dmmulroy",
      updated: "yesterday", comments: 1, blockerCount: 0, cached: false,
      summary: "Lock foreground conditional polling and clear stale, unavailable, and recovery states.",
    },
    {
      id: "issue-48", projectId: "personal-overseer", number: 48,
      title: "Choose the React UI component ownership boundary",
      state: "closed", labels: ["ready-for-human"], assignee: "dmmulroy",
      updated: "2 days ago", comments: 1, blockerCount: 0, cached: true,
      summary: "Own shadcn/Base UI source at a strict generic seam while keeping product UI with features.",
    },
  ],
  "personal-household": [
    {
      id: "issue-21", projectId: "personal-household", number: 21,
      title: "Schedule annual heat-pump inspection",
      state: "open", labels: ["needs-triage"], assignee: null,
      updated: "2 days ago", comments: 1, blockerCount: 0, cached: false,
      summary: "Confirm a service window before the first cold week and attach the prior inspection report.",
    },
  ],
  "northstar-launchpad": [
    {
      id: "issue-12", projectId: "northstar-launchpad", number: 12,
      title: "Publish onboarding checklist for pilot teams",
      state: "open", labels: ["ready-for-human"], assignee: "sam",
      updated: "18 minutes ago", comments: 6, blockerCount: 0, cached: false,
      summary: "Turn the pilot notes into one short checklist that teams can follow without a live walkthrough.",
    },
    {
      id: "issue-13", projectId: "northstar-launchpad", number: 13,
      title: "Confirm data export before pilot migration",
      state: "open", labels: ["ready-for-agent"], assignee: "cursor/export-audit",
      updated: "47 minutes ago", comments: 2, blockerCount: 1, cached: true,
      summary: "Verify the export archive and record the restore steps before any pilot data moves.",
    },
  ],
};

const projectOptions: ReadonlyArray<SelectOption<ProjectId>> = Object.values(projects).map((project) => ({
  value: project.id,
  label: `${project.workspace} / ${project.name}`,
}));
const stateOptions: ReadonlyArray<SelectOption<StateFilter>> = [
  { value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "all", label: "Open & closed" },
];
const assigneeOptions: ReadonlyArray<SelectOption<AssigneeFilter>> = [
  { value: "any", label: "Anyone" }, { value: "assigned", label: "Assigned" }, { value: "unassigned", label: "Unassigned" },
];
const labelOptions: ReadonlyArray<SelectOption<LabelFilter>> = [
  { value: "any", label: "Any Label" }, { value: "wayfinder:prototype", label: "wayfinder:prototype" },
  { value: "ready-for-human", label: "ready-for-human" }, { value: "ready-for-agent", label: "ready-for-agent" },
  { value: "needs-triage", label: "needs-triage" },
];
const blockingOptions: ReadonlyArray<SelectOption<BlockingFilter>> = [
  { value: "any", label: "Any readiness" }, { value: "blocked", label: "Blocked" }, { value: "unblocked", label: "Unblocked" },
];

function parseInitialState(): InitialState {
  const params = new URL(window.location.href).searchParams;
  const variantParam = params.get("variant");
  const modeParam = params.get("mode");
  const freshnessParam = params.get("freshness");
  const projectParam = params.get("project");
  const projectId: ProjectId = projectParam === "personal-household" || projectParam === "northstar-launchpad" ? projectParam : "personal-overseer";
  const availableIssues = issuesByProject[projectId];
  const issueParam = params.get("issue");
  const selectedIssue = availableIssues.find((issue) => issue.id === issueParam) ?? availableIssues[0];
  if (selectedIssue === undefined) throw new Error("Prototype project has no issue fixture");
  const stateParam = params.get("state");
  const assigneeParam = params.get("assignee_status");
  const labelParam = params.get("label");
  const blockingParam = params.get("blocking_status");
  return {
    variant: variantParam === "B" || variantParam === "C" || variantParam === "D" ? variantParam : "A",
    mode: modeParam === "dark" ? "dark" : "light",
    freshness: freshnessParam === "refreshing" || freshnessParam === "stale" ? freshnessParam : "fresh",
    projectId,
    selectedIssueId: selectedIssue.id,
    routeOpen: params.get("view") === "issue",
    filters: {
      state: stateParam === "closed" || stateParam === "all" ? stateParam : "open",
      assignee: assigneeParam === "assigned" || assigneeParam === "unassigned" ? assigneeParam : "any",
      label: labelParam === "wayfinder:prototype" || labelParam === "ready-for-human" || labelParam === "ready-for-agent" || labelParam === "needs-triage" ? labelParam : "any",
      blocking: blockingParam === "blocked" || blockingParam === "unblocked" ? blockingParam : "any",
    },
  };
}

function cycleVariant(current: Variant, direction: -1 | 1): Variant {
  const currentIndex = variantOrder.indexOf(current);
  const next = variantOrder.at((currentIndex + direction + variantOrder.length) % variantOrder.length);
  if (next === undefined) throw new Error("Variant cycle produced no result");
  return next;
}

function filterIssues(issues: ReadonlyArray<Issue>, filters: Filters): ReadonlyArray<Issue> {
  return issues.filter((issue) =>
    (filters.state === "all" || issue.state === filters.state)
    && (filters.assignee === "any" || (filters.assignee === "assigned" ? issue.assignee !== null : issue.assignee === null))
    && (filters.label === "any" || issue.labels.includes(filters.label))
    && (filters.blocking === "any" || (filters.blocking === "blocked" ? issue.blockerCount > 0 : issue.blockerCount === 0)),
  );
}

function stateVariant(state: IssueState): "success" | "secondary" {
  return state === "open" ? "success" : "secondary";
}

function labelVariant(label: Exclude<LabelFilter, "any">): "secondary" | "warning" | "outline" {
  if (label === "needs-triage") return "warning";
  if (label === "ready-for-human") return "outline";
  return "secondary";
}

function AppHeader({ freshness, onRetry }: { readonly freshness: Freshness; readonly onRetry: () => void }) {
  return (
    <header className="app-header">
      <div className="brand"><span aria-hidden="true">O</span><strong>Overseer</strong></div>
      <span className="route-name">Issues</span>
      <div className="header-freshness" aria-live="polite">
        {freshness === "refreshing" ? <span><RefreshCw aria-hidden="true" className="spin" /> Updating…</span> : null}
        {freshness === "stale" ? <button type="button" onClick={onRetry}><WifiOff aria-hidden="true" /> Retry refresh</button> : null}
      </div>
      <Button size="default"><Plus aria-hidden="true" className="size-3.5" /> New issue</Button>
      <span className="avatar" aria-label="Signed in as Dillon Mulroy">DM</span>
    </header>
  );
}

function FreshnessNotice({ freshness, onRetry }: { readonly freshness: Freshness; readonly onRetry: () => void }) {
  if (freshness === "fresh") return null;
  if (freshness === "refreshing") {
    return <div className="freshness-notice freshness-notice--updating" role="status"><RefreshCw aria-hidden="true" className="spin" /><span><strong>Updating…</strong> Current issues remain available while this page is checked.</span></div>;
  }
  return (
    <div className="freshness-notice freshness-notice--stale" role="alert">
      <WifiOff aria-hidden="true" />
      <span><strong>Couldn’t refresh</strong> — showing data from 10:42 AM. Server changes and actions may be unavailable.</span>
      <Button variant="outline" size="xs" onClick={onRetry}>Retry now</Button>
    </div>
  );
}

function FilterStrip({ filters, onChange, resultCount, collapsible = false }: {
  readonly filters: Filters;
  readonly onChange: (filters: Filters) => void;
  readonly resultCount: number;
  readonly collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  const activeCount = Number(filters.state !== "open") + Number(filters.assignee !== "any") + Number(filters.label !== "any") + Number(filters.blocking !== "any");
  return (
    <div className={`filter-area${expanded ? " is-expanded" : ""}`}>
      {collapsible ? (
        <button className="filter-disclosure" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
          <ListFilter aria-hidden="true" /> Filters{activeCount > 0 ? ` · ${activeCount}` : ""}
          <span>{resultCount} results</span>
        </button>
      ) : null}
      <div className="filter-strip" aria-label="Structured issue filters">
        <Select ariaLabel="Filter by issue state" prefix="State" value={filters.state} options={stateOptions} onValueChange={(state) => onChange({ ...filters, state })} />
        <Select ariaLabel="Filter by assignee" prefix="Assignee" value={filters.assignee} options={assigneeOptions} onValueChange={(assignee) => onChange({ ...filters, assignee })} />
        <Select ariaLabel="Filter by Label" prefix="Label" value={filters.label} options={labelOptions} onValueChange={(label) => onChange({ ...filters, label })} />
        <Select ariaLabel="Filter by blocking status" prefix="Readiness" value={filters.blocking} options={blockingOptions} onValueChange={(blocking) => onChange({ ...filters, blocking })} />
        {activeCount > 0 ? <Button variant="ghost" size="xs" onClick={() => onChange({ state: "open", assignee: "any", label: "any", blocking: "any" })}>Reset</Button> : null}
        {!collapsible ? <span className="result-count">{resultCount} {resultCount === 1 ? "issue" : "issues"}</span> : null}
      </div>
    </div>
  );
}

function EmptyIssues({ onReset }: { readonly onReset: () => void }) {
  return (
    <div className="empty-issues">
      <strong>No issues match these filters</strong>
      <p>Change a discrete filter. This project has no hidden query syntax or saved view.</p>
      <Button variant="outline" onClick={onReset}>Reset filters</Button>
    </div>
  );
}

function IssueLabels({ labels }: { readonly labels: ReadonlyArray<Exclude<LabelFilter, "any">> }) {
  return <span className="issue-labels">{labels.map((label) => <Badge key={label} variant={labelVariant(label)}>{label}</Badge>)}</span>;
}

function StateMark({ state }: { readonly state: IssueState }) {
  return state === "open"
    ? <CircleDot aria-label="Open" className="state-icon state-icon--open" />
    : <CircleCheck aria-label="Closed" className="state-icon state-icon--closed" />;
}

function CacheHint({ issue, warmed }: { readonly issue: Issue; readonly warmed: boolean }) {
  if (warmed) return <span className="cache-hint cache-hint--warm">Prefetched</span>;
  if (issue.cached) return <span className="cache-hint">Session cache</span>;
  return null;
}

function Detail({ issue, source, onBack, compact = false }: {
  readonly issue: Issue;
  readonly source: TransitionSource;
  readonly onBack: () => void;
  readonly compact?: boolean;
}) {
  const sourceCopy: Readonly<Record<TransitionSource, string>> = {
    "session-cache": "Shown from session memory · validating when outside the 5-second grace period",
    prefetch: "Opened from a conditional prefetch started on row focus",
    network: "Fetched on selection · retained in session memory for Back",
  };
  return (
    <article className={`issue-detail${compact ? " issue-detail--compact" : ""}`} aria-label={`Selected issue ${issue.number}`}>
      <div className="detail-source"><Clock3 aria-hidden="true" /><span>{sourceCopy[source]}</span></div>
      <div className="detail-inner">
        <Button className="back-button" variant="ghost" size="xs" onClick={onBack}><ArrowLeft aria-hidden="true" className="size-3.5" /> Issues</Button>
        <div className="detail-kicker"><Badge variant={stateVariant(issue.state)}>{issue.state}</Badge><span>#{issue.number}</span><span>updated {issue.updated}</span></div>
        <h2>{issue.title}</h2>
        <p>{issue.summary}</p>
        <dl className="detail-facts">
          <div><dt>Assignee</dt><dd>{issue.assignee ?? "Unassigned"}</dd></div>
          <div><dt>Readiness</dt><dd className={issue.blockerCount > 0 ? "warning-copy" : "success-copy"}>{issue.blockerCount > 0 ? `Blocked by ${issue.blockerCount}` : "Unblocked"}</dd></div>
          <div><dt>Timeline</dt><dd>{issue.comments} comments</dd></div>
        </dl>
        <IssueLabels labels={issue.labels} />
        <div className="latest-activity">
          <span className="avatar avatar--agent">CC</span>
          <p><strong>claude-code/client-shell</strong> commented 24 minutes ago<br /><span>The compact filter path now preserves its exact collection URL when the issue opens.</span></p>
        </div>
        <Button className="open-full" variant="outline">Open full issue <ChevronRight aria-hidden="true" className="size-3.5" /></Button>
      </div>
    </article>
  );
}

function ContextRail({ projectId, onProject }: { readonly projectId: ProjectId; readonly onProject: (projectId: ProjectId) => void }) {
  return (
    <aside className="context-rail" aria-label="Workspace and project navigation">
      <div className="rail-heading"><span>Workspaces</span><Button aria-label="Add project" variant="ghost" size="icon"><Plus aria-hidden="true" className="size-3.5" /></Button></div>
      <div className="workspace-group"><strong><span>P</span> Personal</strong>
        <button className={projectId === "personal-overseer" ? "active" : ""} type="button" onClick={() => onProject("personal-overseer")}>Overseer <small>5</small></button>
        <button className={projectId === "personal-household" ? "active" : ""} type="button" onClick={() => onProject("personal-household")}>Household <small>1</small></button>
      </div>
      <div className="workspace-group"><strong><span>N</span> Northstar Studio</strong>
        <button className={projectId === "northstar-launchpad" ? "active" : ""} type="button" onClick={() => onProject("northstar-launchpad")}>Launchpad <small>2</small></button>
      </div>
      <p className="poll-note">This visible list checks for changes every 30 seconds.</p>
    </aside>
  );
}

function VariantA({ projectId, issues, filters, selected, warmedIssueId, freshness, source, routeOpen, onProject, onFilters, onSelect, onWarm, onBack, onRetry }: VariantProps) {
  const project = projects[projectId];
  return (
    <div className={`product-shell variant-a${routeOpen ? " mobile-detail-open" : ""}`}>
      <AppHeader freshness={freshness} onRetry={onRetry} />
      <FreshnessNotice freshness={freshness} onRetry={onRetry} />
      <div className="triage-layout">
        <ContextRail projectId={projectId} onProject={onProject} />
        <main className="queue-pane">
          <div className="mobile-context"><Select ariaLabel="Switch workspace and project" value={projectId} options={projectOptions} onValueChange={onProject} /></div>
          <header className="queue-heading"><div><span>{project.workspace}</span><h1>{project.name}</h1></div><small>{issues.length} results</small></header>
          <FilterStrip filters={filters} onChange={onFilters} resultCount={issues.length} collapsible />
          <div className="queue-list">
            {issues.length === 0 ? <EmptyIssues onReset={() => onFilters({ state: "open", assignee: "any", label: "any", blocking: "any" })} /> : issues.map((issue) => (
              <button
                key={issue.id}
                className={`queue-row${selected.id === issue.id ? " selected" : ""}`}
                type="button"
                onClick={() => onSelect(issue)}
                onMouseEnter={() => onWarm(issue.id)}
                onFocus={() => onWarm(issue.id)}
              >
                <StateMark state={issue.state} />
                <span className="row-main"><strong>{issue.title}</strong><span>#{issue.number} · {issue.assignee ?? "Unassigned"}</span><IssueLabels labels={issue.labels.slice(0, 1)} /></span>
                <span className="row-end"><time>{issue.updated}</time><CacheHint issue={issue} warmed={warmedIssueId === issue.id} /></span>
              </button>
            ))}
          </div>
        </main>
        <Detail issue={selected} source={source} onBack={onBack} />
      </div>
    </div>
  );
}

function VariantB({ projectId, issues, filters, selected, warmedIssueId, freshness, source, routeOpen, onProject, onFilters, onSelect, onWarm, onBack, onRetry }: VariantProps) {
  const project = projects[projectId];
  return (
    <div className={`product-shell variant-b${routeOpen ? " mobile-detail-open" : ""}`}>
      <AppHeader freshness={freshness} onRetry={onRetry} />
      <FreshnessNotice freshness={freshness} onRetry={onRetry} />
      <main className="ledger-page">
        <header className="ledger-heading">
          <div><Select className="project-select" ariaLabel="Switch workspace and project" value={projectId} options={projectOptions} onValueChange={onProject} /><h1>{project.name} issues</h1><p>Compare current work across state, ownership, readiness, and recent activity.</p></div>
          <span>Sorted by updated · newest first</span>
        </header>
        <FilterStrip filters={filters} onChange={onFilters} resultCount={issues.length} />
        <div className="ledger-table-wrap">
          {issues.length === 0 ? <EmptyIssues onReset={() => onFilters({ state: "open", assignee: "any", label: "any", blocking: "any" })} /> : (
            <table className="ledger-table">
              <thead><tr><th><span className="sr-only">Select</span></th><th>Issue</th><th>Labels</th><th>Assignee</th><th>Readiness</th><th>Updated</th></tr></thead>
              <tbody>{issues.map((issue) => (
                <tr key={issue.id} className={selected.id === issue.id ? "selected" : ""} onMouseEnter={() => onWarm(issue.id)}>
                  <td><button type="button" className="ledger-select" aria-label={`Select issue ${issue.number}`} onClick={() => onSelect(issue)} onFocus={() => onWarm(issue.id)}><StateMark state={issue.state} /></button></td>
                  <td><button type="button" className="ledger-title" onClick={() => onSelect(issue)}><strong>{issue.title}</strong><span>#{issue.number} · {issue.comments} comments</span></button></td>
                  <td><IssueLabels labels={issue.labels.slice(0, 2)} /></td>
                  <td>{issue.assignee ?? <span className="muted-copy">Unassigned</span>}</td>
                  <td>{issue.blockerCount > 0 ? <Badge variant="warning">Blocked by {issue.blockerCount}</Badge> : <span className="success-copy">Unblocked</span>}</td>
                  <td><time>{issue.updated}</time><CacheHint issue={issue} warmed={warmedIssueId === issue.id} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <Detail issue={selected} source={source} onBack={onBack} compact />
      </main>
    </div>
  );
}

function VariantC({ projectId, issues, filters, selected, warmedIssueId, freshness, source, routeOpen, onProject, onFilters, onSelect, onWarm, onBack, onRetry }: VariantProps) {
  const project = projects[projectId];
  return (
    <div className="product-shell variant-c">
      <AppHeader freshness={freshness} onRetry={onRetry} />
      <FreshnessNotice freshness={freshness} onRetry={onRetry} />
      <main className="route-page">
        <header className="route-context"><Select className="project-select" ariaLabel="Switch workspace and project" value={projectId} options={projectOptions} onValueChange={onProject} /><span>{routeOpen ? `Issue #${selected.number}` : `${issues.length} results`}</span></header>
        {routeOpen ? <Detail issue={selected} source={source} onBack={onBack} /> : (
          <section className="route-list-card">
            <div className="route-heading"><div><span>{project.workspace}</span><h1>{project.name} issues</h1><p>Choose one issue to continue. Your filters stay in the URL for Back.</p></div><Button><Plus aria-hidden="true" className="size-3.5" /> New issue</Button></div>
            <FilterStrip filters={filters} onChange={onFilters} resultCount={issues.length} collapsible />
            <div className="route-rows">
              {issues.length === 0 ? <EmptyIssues onReset={() => onFilters({ state: "open", assignee: "any", label: "any", blocking: "any" })} /> : issues.map((issue) => (
                <button key={issue.id} className="route-row" type="button" onClick={() => onSelect(issue)} onMouseEnter={() => onWarm(issue.id)} onFocus={() => onWarm(issue.id)}>
                  <StateMark state={issue.state} />
                  <span className="route-row-copy"><strong>{issue.title}</strong><span>#{issue.number} · {issue.assignee ?? "Unassigned"} · {issue.comments} comments</span><IssueLabels labels={issue.labels.slice(0, 2)} /></span>
                  <span className="route-row-end"><time>{issue.updated}</time>{issue.blockerCount > 0 ? <Badge variant="warning">Blocked</Badge> : null}<CacheHint issue={issue} warmed={warmedIssueId === issue.id} /><ChevronRight aria-hidden="true" /></span>
                </button>
              ))}
            </div>
            <footer className="route-footer">Only this visible page polls. Prefetched issues do not start background timers.</footer>
          </section>
        )}
      </main>
    </div>
  );
}

function VariantD({ projectId, issues, filters, selected, warmedIssueId, freshness, source, routeOpen, onProject, onFilters, onSelect, onWarm, onBack, onRetry }: VariantProps) {
  const project = projects[projectId];
  return (
    <div className="product-shell variant-d">
      <AppHeader freshness={freshness} onRetry={onRetry} />
      <FreshnessNotice freshness={freshness} onRetry={onRetry} />
      <div className="hybrid-layout">
        <ContextRail projectId={projectId} onProject={onProject} />
        <main className="hybrid-page">
          <div className="mobile-context"><Select ariaLabel="Switch workspace and project" value={projectId} options={projectOptions} onValueChange={onProject} /></div>
          <header className="hybrid-heading">
            <div><span>{project.workspace}</span><h1>{routeOpen ? `Issue #${selected.number}` : `${project.name} issues`}</h1><p>{routeOpen ? "Focused issue" : "Choose one issue to continue. Filters remain in the URL for Back."}</p></div>
          </header>
          {routeOpen ? <Detail issue={selected} source={source} onBack={onBack} /> : (
            <section className="hybrid-list-card">
              <FilterStrip filters={filters} onChange={onFilters} resultCount={issues.length} />
              <div className="route-rows">
                {issues.length === 0 ? <EmptyIssues onReset={() => onFilters({ state: "open", assignee: "any", label: "any", blocking: "any" })} /> : issues.map((issue) => (
                  <button key={issue.id} className="route-row" type="button" onClick={() => onSelect(issue)} onMouseEnter={() => onWarm(issue.id)} onFocus={() => onWarm(issue.id)}>
                    <StateMark state={issue.state} />
                    <span className="route-row-copy"><strong>{issue.title}</strong><span>#{issue.number} · {issue.assignee ?? "Unassigned"} · {issue.comments} comments</span><IssueLabels labels={issue.labels.slice(0, 2)} /></span>
                    <span className="route-row-end"><time>{issue.updated}</time>{issue.blockerCount > 0 ? <Badge variant="warning">Blocked</Badge> : null}<CacheHint issue={issue} warmed={warmedIssueId === issue.id} /><ChevronRight aria-hidden="true" /></span>
                  </button>
                ))}
              </div>
              <footer className="route-footer">Only this visible page polls. Prefetched issues do not start background timers.</footer>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

type VariantProps = {
  readonly projectId: ProjectId;
  readonly issues: ReadonlyArray<Issue>;
  readonly filters: Filters;
  readonly selected: Issue;
  readonly warmedIssueId: IssueId | null;
  readonly freshness: Freshness;
  readonly source: TransitionSource;
  readonly routeOpen: boolean;
  readonly onProject: (projectId: ProjectId) => void;
  readonly onFilters: (filters: Filters) => void;
  readonly onSelect: (issue: Issue) => void;
  readonly onWarm: (issueId: IssueId) => void;
  readonly onBack: () => void;
  readonly onRetry: () => void;
};

function PrototypeSwitcher({ variant, mode, freshness, onCycle, onVariant, onMode, onFreshness }: {
  readonly variant: Variant;
  readonly mode: Mode;
  readonly freshness: Freshness;
  readonly onCycle: (direction: -1 | 1) => void;
  readonly onVariant: (variant: Variant) => void;
  readonly onMode: (mode: Mode) => void;
  readonly onFreshness: (freshness: Freshness) => void;
}) {
  if (import.meta.env.PROD) return null;
  const nextFreshness: Readonly<Record<Freshness, Freshness>> = { fresh: "refreshing", refreshing: "stale", stale: "fresh" };
  return (
    <div className="prototype-switcher" aria-label="Prototype review controls">
      <Button variant="ghost" size="icon" onClick={() => onCycle(-1)} aria-label="Previous variant"><ChevronLeft aria-hidden="true" /></Button>
      <div className="switcher-identity"><span>Variant</span><strong>{variant} — {variantMeta[variant].name}</strong></div>
      <div className="switcher-variants" role="group" aria-label="Choose variant">{variantOrder.map((option) => <button key={option} className={option === variant ? "active" : ""} type="button" onClick={() => onVariant(option)}>{option}</button>)}</div>
      <Button variant="ghost" size="icon" onClick={() => onCycle(1)} aria-label="Next variant"><ChevronRight aria-hidden="true" /></Button>
      <span className="switcher-divider" />
      <Button variant="ghost" size="icon" onClick={() => onMode(mode === "light" ? "dark" : "light")} aria-label={`Use ${mode === "light" ? "dark" : "light"} mode`}>{mode === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}</Button>
      <Button className="freshness-cycle" variant="ghost" size="xs" onClick={() => onFreshness(nextFreshness[freshness])} aria-label="Cycle freshness evidence">{freshness}</Button>
    </div>
  );
}

/** Render the throwaway issue discovery and navigation comparison for #41. */
export function IssueDiscoveryPrototype() {
  const initial = useMemo(parseInitialState, []);
  const [variant, setVariant] = useState<Variant>(initial.variant);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [freshness, setFreshness] = useState<Freshness>(initial.freshness);
  const [projectId, setProjectId] = useState<ProjectId>(initial.projectId);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [selectedIssueId, setSelectedIssueId] = useState<IssueId>(initial.selectedIssueId);
  const [warmedIssueId, setWarmedIssueId] = useState<IssueId | null>(null);
  const [transitionSource, setTransitionSource] = useState<TransitionSource>("session-cache");
  const [routeOpen, setRouteOpen] = useState(initial.routeOpen);

  const projectIssues = issuesByProject[projectId];
  const visibleIssues = filterIssues(projectIssues, filters);
  const selected = projectIssues.find((issue) => issue.id === selectedIssueId) ?? projectIssues[0];
  if (selected === undefined) throw new Error("Prototype project has no selected issue fixture");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("overseer-theme", mode);
    const url = new URL(window.location.href);
    url.pathname = "/prototype/issue-discovery";
    url.searchParams.set("variant", variant);
    url.searchParams.set("mode", mode);
    url.searchParams.set("project", projectId);
    url.searchParams.set("state", filters.state);
    url.searchParams.set("assignee_status", filters.assignee);
    url.searchParams.set("label", filters.label);
    url.searchParams.set("blocking_status", filters.blocking);
    url.searchParams.set("freshness", freshness);
    url.searchParams.set("issue", selectedIssueId);
    if (routeOpen) url.searchParams.set("view", "issue"); else url.searchParams.delete("view");
    window.history.replaceState({}, "", url);
  }, [filters, freshness, mode, projectId, routeOpen, selectedIssueId, variant]);

  const changeProject = (nextProjectId: ProjectId) => {
    const firstIssue = issuesByProject[nextProjectId][0];
    if (firstIssue === undefined) throw new Error("Prototype project has no issue fixture");
    setProjectId(nextProjectId);
    setSelectedIssueId(firstIssue.id);
    setFilters({ state: "open", assignee: "any", label: "any", blocking: "any" });
    setWarmedIssueId(null);
    setTransitionSource("network");
    setRouteOpen(false);
  };

  const selectIssue = (issue: Issue) => {
    setSelectedIssueId(issue.id);
    setTransitionSource(warmedIssueId === issue.id ? "prefetch" : issue.cached ? "session-cache" : "network");
    setRouteOpen(true);
  };

  const retry = () => {
    setFreshness("refreshing");
    window.setTimeout(() => setFreshness("fresh"), 700);
  };

  const cycle = (direction: -1 | 1) => setVariant((current) => cycleVariant(current, direction));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.matches("input, textarea, select, [contenteditable='true'], [role='combobox']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const variantProps: VariantProps = {
    projectId,
    issues: visibleIssues,
    filters,
    selected,
    warmedIssueId,
    freshness,
    source: transitionSource,
    routeOpen,
    onProject: changeProject,
    onFilters: setFilters,
    onSelect: selectIssue,
    onWarm: setWarmedIssueId,
    onBack: () => setRouteOpen(false),
    onRetry: retry,
  };

  return (
    <div className="prototype-page">
      <header className="prototype-intro">
        <div><p>PROTOTYPE · ISSUE #41 · CRISP FOUNDATION</p><h1>{variant} — {variantMeta[variant].name}</h1></div>
        <p>{variantMeta[variant].thesis}</p>
      </header>
      {variant === "A" ? <VariantA {...variantProps} /> : variant === "B" ? <VariantB {...variantProps} /> : variant === "C" ? <VariantC {...variantProps} /> : <VariantD {...variantProps} />}
      <PrototypeSwitcher variant={variant} mode={mode} freshness={freshness} onCycle={cycle} onVariant={setVariant} onMode={setMode} onFreshness={setFreshness} />
    </div>
  );
}
