import { AlertDialog } from "@/ui/components/alert-dialog";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Textarea } from "@/ui/components/textarea";
import { useEffect, useMemo, useState } from "react";

// PROTOTYPE — Three structural mutation/recovery variants, switchable via
// ?variant=, on /prototype/mutation-recovery. The fixture is an in-memory REST
// simulation: no mutation reaches a server and no stream/reconnect model exists.

type Variant = "A" | "B" | "C";
type Mode = "light" | "dark";
type Scenario = "steady" | "editing" | "conflict" | "stale" | "closed" | "confirm-delete" | "deleted";

const variants: ReadonlyArray<Variant> = ["A", "B", "C"];
const scenarios: ReadonlyArray<Scenario> = ["steady", "editing", "conflict", "stale", "closed", "confirm-delete", "deleted"];
const originalTitle = "Preserve drafts when issue freshness is uncertain";
const draftTitle = "Keep device drafts editable while canonical reads are stale";
const currentTitle = "Keep issue drafts available while validation retries";

const variantMeta: Readonly<Record<Variant, { readonly name: string; readonly thesis: string }>> = {
  A: { name: "Inline recovery", thesis: "Keep every decision beside the field or lifecycle action it affects." },
  B: { name: "Revision workbench", thesis: "Separate the canonical Issue from the device-local working copy." },
  C: { name: "Action checkpoint", thesis: "Lead with one explicit recovery decision before returning to the Issue." },
};

const scenarioMeta: Readonly<Record<Scenario, { readonly short: string; readonly label: string }>> = {
  steady: { short: "Ready", label: "Fresh and ready" },
  editing: { short: "Edit", label: "Editing a device-local draft" },
  conflict: { short: "Conflict", label: "Newer title Revision found" },
  stale: { short: "Stale", label: "Polled data is stale" },
  closed: { short: "Close / reopen", label: "Issue closed" },
  "confirm-delete": { short: "Delete", label: "Delete confirmation" },
  deleted: { short: "Restore", label: "Deleted Issue tombstone" },
};

function parseVariant(value: string | null): Variant {
  if (value === "B" || value === "C") return value;
  return "A";
}

function parseScenario(value: string | null): Scenario {
  if (value === "editing" || value === "conflict" || value === "stale" || value === "closed" || value === "confirm-delete" || value === "deleted") return value;
  return "steady";
}

function readInitial(): { readonly variant: Variant; readonly mode: Mode; readonly scenario: Scenario } {
  const params = new URL(window.location.href).searchParams;
  return {
    variant: parseVariant(params.get("variant")),
    mode: params.get("mode") === "dark" ? "dark" : "light",
    scenario: parseScenario(params.get("state")),
  };
}

function writeUrl(variant: Variant, mode: Mode, scenario: Scenario): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/mutation-recovery";
  url.searchParams.set("variant", variant);
  url.searchParams.set("mode", mode);
  url.searchParams.set("state", scenario);
  window.history.replaceState({}, "", url);
}

function cycleVariant(current: Variant, direction: -1 | 1): Variant {
  const index = variants.indexOf(current);
  const next = variants.at((index + direction + variants.length) % variants.length);
  if (next === undefined) throw new Error("Variant cycle produced no result");
  return next;
}

type PrototypeActions = {
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly setScenario: (scenario: Scenario) => void;
  readonly resolveCurrent: () => void;
  readonly resolveDraft: () => void;
  readonly saveDraft: () => void;
  readonly retry: () => void;
  readonly close: () => void;
  readonly reopen: () => void;
  readonly requestDelete: () => void;
  readonly cancelDelete: () => void;
  readonly confirmDelete: () => void;
  readonly restore: () => void;
};

type VariantProps = {
  readonly scenario: Scenario;
  readonly title: string;
  readonly notice: string;
  readonly actions: PrototypeActions;
};

function AppHeader({ scenario }: { readonly scenario: Scenario }) {
  return (
    <header className="app-header">
      <a className="brand" href="#top" aria-label="Overseer home"><span>O</span><strong>Overseer</strong></a>
      <nav className="breadcrumbs" aria-label="Breadcrumb">Personal <i>/</i> Overseer <i>/</i> <strong>#72</strong></nav>
      <div className="header-status">
        {scenario === "stale" ? <Badge variant="warning">Stale read</Badge> : <span className="validated-dot"><i /> Validated just now</span>}
        <span className="avatar" aria-label="Dillon Mulroy">DM</span>
      </div>
    </header>
  );
}

function ScenarioBar({ current, onSelect }: { readonly current: Scenario; readonly onSelect: (scenario: Scenario) => void }) {
  return (
    <section className="scenario-bar" aria-label="Prototype interaction states">
      <div className="scenario-caption"><small>INTERACTION STATE</small><strong>{scenarioMeta[current].label}</strong></div>
      <div className="scenario-options">
        {scenarios.map((scenario) => (
          <Button key={scenario} variant={scenario === current ? "secondary" : "ghost"} size="sm" onClick={() => onSelect(scenario)}>
            {scenarioMeta[scenario].short}
          </Button>
        ))}
      </div>
    </section>
  );
}

function IssueHeading({ scenario, title, onEdit, onClose, onReopen, onDelete }: {
  readonly scenario: Scenario;
  readonly title: string;
  readonly onEdit: () => void;
  readonly onClose: () => void;
  readonly onReopen: () => void;
  readonly onDelete: () => void;
}) {
  const closed = scenario === "closed";
  return (
    <header className="issue-heading">
      <div>
        <div className="issue-state-line">
          <Badge variant={closed ? "secondary" : "success"}>{closed ? "Closed" : "Open"}</Badge>
          <span>Issue #72</span><span>·</span><span>updated just now</span>
        </div>
        <h1>{title}</h1>
      </div>
      <div className="issue-actions">
        <Button variant="outline" size="sm" onClick={onEdit} disabled={scenario === "stale" || scenario === "deleted"}>Edit title</Button>
        <Button variant="outline" size="sm" onClick={closed ? onReopen : onClose} disabled={scenario === "stale" || scenario === "deleted"}>{closed ? "Reopen" : "Close"}</Button>
        <Button variant="secondary-destructive" size="sm" onClick={onDelete} disabled={scenario === "stale" || scenario === "deleted"}>Delete</Button>
      </div>
    </header>
  );
}

function IssueBody() {
  return (
    <article className="issue-body-copy">
      <p>The detail route should keep a device-local draft usable when its 15-second conditional validation fails.</p>
      <p>A write must wait for a successful freshness check whenever the canonical Issue is older than five seconds. Polling must never overwrite the draft.</p>
      <div className="acceptance-list">
        <strong>Acceptance notes</strong>
        <label><input type="checkbox" checked readOnly /> Cached Issue remains readable</label>
        <label><input type="checkbox" checked readOnly /> Draft remains device-local</label>
        <label><input type="checkbox" readOnly /> Review recovery copy in both themes</label>
      </div>
    </article>
  );
}

function IssueFacts({ scenario }: { readonly scenario: Scenario }) {
  return (
    <aside className="issue-facts" aria-label="Issue metadata">
      <dl>
        <div><dt>Assignee</dt><dd>pi/session-7f3a</dd></div>
        <div><dt>Labels</dt><dd><Badge variant="secondary">ready-for-agent</Badge> <Badge variant="outline">client</Badge></dd></div>
        <div><dt>Blocking</dt><dd className="success-copy">Unblocked</dd></div>
        <div><dt>Title Revision</dt><dd>{scenario === "conflict" ? "20" : "19"}</dd></div>
      </dl>
      <div className="poll-contract"><small>DETAIL FRESHNESS</small><strong>15-second conditional validation</strong><span>Five-second grace before writes</span></div>
    </aside>
  );
}

function StaleNotice({ onRetry, compact = false }: { readonly onRetry: () => void; readonly compact?: boolean }) {
  return (
    <section className={`status-notice stale-notice${compact ? " compact" : ""}`} role="status">
      <div><strong>Couldn’t refresh — showing data from 10:42 AM</strong><p>Cached content stays readable. Server writes are disabled until validation succeeds; device-local draft editing can continue.</p></div>
      <Button variant="outline" size="sm" onClick={onRetry}>Retry now</Button>
    </section>
  );
}

function ConflictCompare({ draft, setDraft, onKeepCurrent, onSaveDraft, vertical = false }: {
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly onKeepCurrent: () => void;
  readonly onSaveDraft: () => void;
  readonly vertical?: boolean;
}) {
  return (
    <section className="conflict-panel" role="status">
      <header><div className="warning-mark">!</div><div><strong>A newer title Revision was found before save</strong><p>Your draft is preserved. Compare it with Revision 20, then choose which complete title to keep.</p></div></header>
      <div className={`compare-grid${vertical ? " vertical" : ""}`}>
        <label className="revision-card mine"><span>Your device draft <small>based on Revision 19</small></span><Input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
        <div className="revision-card current"><span>Current Issue <small>Revision 20 · Jun Park · 10:41 AM</small></span><strong>{currentTitle}</strong></div>
      </div>
      <footer><Button variant="outline" size="sm" onClick={onKeepCurrent}>Keep current</Button><Button size="sm" onClick={onSaveDraft}>Save my version</Button></footer>
    </section>
  );
}

function InlineEditor({ scenario, draft, setDraft, onSave, onCancel, onKeepCurrent, onSaveConflict, onRetry }: {
  readonly scenario: Scenario;
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onKeepCurrent: () => void;
  readonly onSaveConflict: () => void;
  readonly onRetry: () => void;
}) {
  if (scenario === "conflict") return <ConflictCompare draft={draft} setDraft={setDraft} onKeepCurrent={onKeepCurrent} onSaveDraft={onSaveConflict} />;
  if (scenario !== "editing" && scenario !== "stale") return null;
  return (
    <section className="inline-editor">
      {scenario === "stale" ? <StaleNotice onRetry={onRetry} compact /> : null}
      <label htmlFor="inline-title"><span>Title</span><small>Device-local draft · based on title Revision 19</small></label>
      <Input id="inline-title" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <footer><span>{scenario === "stale" ? "Draft changes stay on this device." : "Not yet saved to Overseer."}</span><Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button><Button size="sm" onClick={onSave} disabled={scenario === "stale"}>Save title</Button></footer>
    </section>
  );
}

function DeleteDialog({ onCancel, onConfirm }: { readonly onCancel: () => void; readonly onConfirm: () => void }) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title="Delete Issue #72?"
      description="It will become a reversible, read-only tombstone and disappear from default lists. Number #72, its Timeline, Comments, and relationships stay preserved. Sub-issues are not deleted."
      icon={<div className="danger-mark">!</div>}
    >
      <Button variant="destructive" size="sm" onClick={onConfirm}>Delete issue</Button>
    </AlertDialog>
  );
}

function DeletedIssue({ onRestore }: { readonly onRestore: () => void }) {
  return (
    <section className="deleted-issue">
      <div className="tombstone-mark">⌫</div><Badge variant="destructive">Deleted</Badge>
      <h1>Preserve drafts when issue freshness is uncertain</h1>
      <p>Issue #72 is hidden from default lists and read-only. Its number, Timeline, Comments, and relationships are preserved.</p>
      <div className="tombstone-facts"><span>Deleted by Dillon Mulroy</span><span>Today at 10:44 AM</span><span>Number #72 will never be reused</span></div>
      <Button size="sm" onClick={onRestore}>Restore issue</Button>
    </section>
  );
}

function Notice({ children }: { readonly children: string }) {
  if (children.length === 0) return null;
  return <div className="success-notice" role="status"><strong>✓</strong>{children}</div>;
}

function VariantA({ scenario, title, notice, actions }: VariantProps) {
  if (scenario === "deleted") return <main className="variant-a"><DeletedIssue onRestore={actions.restore} /></main>;
  return (
    <main className="variant-a">
      <Notice>{notice}</Notice>
      {scenario === "stale" ? <StaleNotice onRetry={actions.retry} /> : null}
      <IssueHeading scenario={scenario} title={title} onEdit={() => actions.setScenario("editing")} onClose={actions.close} onReopen={actions.reopen} onDelete={actions.requestDelete} />
      <InlineEditor scenario={scenario} draft={actions.draft} setDraft={actions.setDraft} onSave={actions.saveDraft} onCancel={() => actions.setScenario("steady")} onKeepCurrent={actions.resolveCurrent} onSaveConflict={actions.resolveDraft} onRetry={actions.retry} />
      <div className="detail-grid"><IssueBody /><IssueFacts scenario={scenario} /></div>
      <section className="timeline-preview"><small>TIMELINE · COMMITTED ACTIVITY ONLY</small><div><span className="timeline-avatar">JP</span><p><strong>Jun Park</strong> clarified the validation acceptance notes <time>yesterday at 4:18 PM</time></p></div></section>
      {scenario === "closed" ? <div className="lifecycle-bar"><div><strong>Issue closed</strong><span>Closing did not affect its sub-issues or blockers.</span></div><Button variant="outline" size="sm" onClick={actions.reopen}>Reopen issue</Button></div> : null}
      {scenario === "confirm-delete" ? <DeleteDialog onCancel={actions.cancelDelete} onConfirm={actions.confirmDelete} /> : null}
    </main>
  );
}

function WorkbenchDraft({ scenario, actions }: { readonly scenario: Scenario; readonly actions: PrototypeActions }) {
  if (scenario === "conflict") return <ConflictCompare draft={actions.draft} setDraft={actions.setDraft} onKeepCurrent={actions.resolveCurrent} onSaveDraft={actions.resolveDraft} vertical />;
  if (scenario === "editing" || scenario === "stale") {
    return (
      <div className="working-copy">
        <header><div><small>DEVICE-LOCAL WORKING COPY</small><strong>Title draft</strong></div><Badge variant="warning">Unsaved</Badge></header>
        <label htmlFor="workbench-title">Based on title Revision 19</label>
        <Textarea id="workbench-title" value={actions.draft} onChange={(event) => actions.setDraft(event.target.value)} />
        <p>{scenario === "stale" ? "Canonical validation failed. This draft remains editable on this device." : "The canonical Issue stays unchanged until Save."}</p>
        <footer><Button variant="ghost" size="sm" onClick={() => actions.setScenario("steady")}>Discard draft</Button><Button size="sm" onClick={actions.saveDraft} disabled={scenario === "stale"}>Save title</Button></footer>
      </div>
    );
  }
  if (scenario === "closed") return <div className="empty-working"><div className="state-icon">✓</div><strong>Canonical Issue is closed</strong><p>No working copy is open. Reopen is a named lifecycle action.</p><Button size="sm" onClick={actions.reopen}>Reopen issue</Button></div>;
  return <div className="empty-working"><div className="state-icon">◇</div><strong>No device-local changes</strong><p>Start editing to create a draft based on title Revision 19.</p><Button variant="outline" size="sm" onClick={() => actions.setScenario("editing")}>Start title draft</Button></div>;
}

function VariantB({ scenario, title, notice, actions }: VariantProps) {
  if (scenario === "deleted") return <main className="variant-b tombstone-workbench"><DeletedIssue onRestore={actions.restore} /></main>;
  return (
    <main className="variant-b">
      <Notice>{notice}</Notice>
      {scenario === "stale" ? <StaleNotice onRetry={actions.retry} /> : null}
      <header className="workbench-header"><div><span>Issue #72</span><h1>Revision workbench</h1><p>Canonical server read and device-local working copy remain visibly separate.</p></div><div className="issue-actions"><Button variant="outline" size="sm" onClick={scenario === "closed" ? actions.reopen : actions.close} disabled={scenario === "stale"}>{scenario === "closed" ? "Reopen" : "Close"}</Button><Button variant="secondary-destructive" size="sm" onClick={actions.requestDelete} disabled={scenario === "stale"}>Delete</Button></div></header>
      <div className="workbench-grid">
        <section className="canonical-pane">
          <header><div><small>CANONICAL ISSUE</small><strong>Last validated {scenario === "stale" ? "10:42 AM" : "just now"}</strong></div><Badge variant={scenario === "stale" ? "warning" : "success"}>{scenario === "stale" ? "Stale" : "Fresh"}</Badge></header>
          <div className="canonical-title"><span>Title · Revision {scenario === "conflict" ? "20" : "19"}</span><h2>{scenario === "conflict" ? currentTitle : title}</h2></div>
          <IssueBody />
          <IssueFacts scenario={scenario} />
        </section>
        <aside className="draft-pane"><WorkbenchDraft scenario={scenario} actions={actions} /><div className="workbench-rule"><small>MUTATION RULE</small><p>Validate if older than five seconds, send the write, install the returned Issue, then revalidate affected visible reads.</p></div></aside>
      </div>
      {scenario === "confirm-delete" ? <DeleteDialog onCancel={actions.cancelDelete} onConfirm={actions.confirmDelete} /> : null}
    </main>
  );
}

function CheckpointContent({ scenario, actions }: { readonly scenario: Scenario; readonly actions: PrototypeActions }) {
  if (scenario === "conflict") return <ConflictCompare draft={actions.draft} setDraft={actions.setDraft} onKeepCurrent={actions.resolveCurrent} onSaveDraft={actions.resolveDraft} />;
  if (scenario === "stale") return <StaleNotice onRetry={actions.retry} />;
  if (scenario === "editing") return (
    <div className="checkpoint-editor"><label htmlFor="checkpoint-title"><strong>Review the title draft</strong><span>Stored on this device · based on Revision 19</span></label><Input id="checkpoint-title" value={actions.draft} onChange={(event) => actions.setDraft(event.target.value)} /><footer><Button variant="ghost" size="sm" onClick={() => actions.setScenario("steady")}>Cancel</Button><Button size="sm" onClick={actions.saveDraft}>Save title</Button></footer></div>
  );
  if (scenario === "closed") return <div className="checkpoint-message"><div className="state-icon">✓</div><h2>Issue #72 is closed</h2><p>Its open sub-issues and blocking relations were not changed. Reopen explicitly when work should resume.</p><Button size="sm" onClick={actions.reopen}>Reopen issue</Button></div>;
  return <div className="checkpoint-message"><div className="state-icon">→</div><h2>Issue is fresh enough to mutate</h2><p>Validated just now with a conditional read. No device-local draft needs attention.</p><div><Button size="sm" onClick={() => actions.setScenario("editing")}>Edit title</Button><Button variant="outline" size="sm" onClick={actions.close}>Close issue</Button></div></div>;
}

function VariantC({ scenario, title, notice, actions }: VariantProps) {
  if (scenario === "deleted") return <main className="variant-c"><DeletedIssue onRestore={actions.restore} /></main>;
  return (
    <main className="variant-c">
      <Notice>{notice}</Notice>
      <section className="issue-summary-strip"><div><Badge variant={scenario === "closed" ? "secondary" : "success"}>{scenario === "closed" ? "Closed" : "Open"}</Badge><span>Overseer / Issue #72</span></div><h1>{scenario === "conflict" ? currentTitle : title}</h1><div className="summary-meta"><span>pi/session-7f3a</span><span>Title Revision {scenario === "conflict" ? "20" : "19"}</span><span>{scenario === "stale" ? "Last validated 10:42 AM" : "Validated just now"}</span></div></section>
      <section className={`checkpoint ${scenario === "stale" || scenario === "conflict" ? "needs-attention" : ""}`}>
        <header><div><small>ACTION CHECKPOINT · SESSION-ONLY, NOT TIMELINE</small><strong>{scenarioMeta[scenario].label}</strong></div><Badge variant={scenario === "stale" || scenario === "conflict" ? "warning" : "outline"}>{scenario === "steady" ? "No decision needed" : "Review"}</Badge></header>
        <CheckpointContent scenario={scenario} actions={actions} />
      </section>
      <div className="checkpoint-context"><IssueBody /><aside><IssueFacts scenario={scenario} /><Button variant="secondary-destructive" size="sm" onClick={actions.requestDelete} disabled={scenario === "stale"}>Delete issue</Button></aside></div>
      {scenario === "confirm-delete" ? <DeleteDialog onCancel={actions.cancelDelete} onConfirm={actions.confirmDelete} /> : null}
    </main>
  );
}

function PrototypeSwitcher({ current, onCycle }: { readonly current: Variant; readonly onCycle: (direction: -1 | 1) => void }) {
  if (import.meta.env.PROD) return null;
  return (
    <div className="prototype-switcher" role="group" aria-label="Prototype variant switcher">
      <button type="button" onClick={() => onCycle(-1)} aria-label="Previous variant">←</button>
      <span><strong>{current}</strong> — {variantMeta[current].name}</span>
      <button type="button" onClick={() => onCycle(1)} aria-label="Next variant">→</button>
    </div>
  );
}

/** Render the throwaway simple-REST mutation and recovery comparison. */
export function PrototypeApp() {
  const initial = useMemo(readInitial, []);
  const [variant, setVariant] = useState<Variant>(initial.variant);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [scenario, setScenario] = useState<Scenario>(initial.scenario);
  const [title, setTitle] = useState(originalTitle);
  const [draft, setDraft] = useState(draftTitle);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = "overseer-crisp";
    root.dataset.mode = mode;
    root.classList.toggle("dark", mode === "dark");
    writeUrl(variant, mode, scenario);
  }, [variant, mode, scenario]);

  const moveTo = (next: Scenario, nextNotice = "") => {
    setScenario(next);
    setNotice(nextNotice);
    if (next === "editing" || next === "conflict" || next === "stale") setDraft(draftTitle);
  };

  const actions: PrototypeActions = {
    draft,
    setDraft,
    setScenario: moveTo,
    resolveCurrent: () => { setTitle(currentTitle); setDraft(currentTitle); moveTo("steady", "Current title Revision 20 kept. The device draft was discarded."); },
    resolveDraft: () => { setTitle(draft); moveTo("steady", "Your title was saved as Revision 21 after reviewing Revision 20."); },
    saveDraft: () => { setTitle(draft); moveTo("steady", "Title saved as Revision 20. Visible reads are validating now."); },
    retry: () => moveTo("steady", "Validated at 10:43 AM. Server writes are available again."),
    close: () => moveTo("closed", "Issue closed. The returned Issue was installed before visible reads revalidated."),
    reopen: () => moveTo("steady", "Issue reopened. Its blocking relations were evaluated from current state."),
    requestDelete: () => moveTo("confirm-delete"),
    cancelDelete: () => moveTo("steady"),
    confirmDelete: () => moveTo("deleted"),
    restore: () => moveTo("steady", "Issue restored with its number, Timeline, Comments, and relationships."),
  };

  const cycle = (direction: -1 | 1) => setVariant((current) => cycleVariant(current, direction));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const props: VariantProps = { scenario, title, notice, actions };
  return (
    <div className="prototype-page" id="top">
      <header className="prototype-heading">
        <div><p className="prototype-kicker">PROTOTYPE · ISSUE #44 · SIMPLE REST ONLY</p><h2>Mutation and recovery</h2><p>Compare three structures using one Issue, one in-memory state model, and no stream or reconnect assumptions.</p></div>
        <div className="prototype-tools"><span><strong>{variant}</strong> · {variantMeta[variant].name}</span><Button variant="outline" size="sm" onClick={() => setMode(mode === "light" ? "dark" : "light")}>{mode === "light" ? "Dark" : "Light"} mode</Button></div>
      </header>
      <section className="product-shell">
        <AppHeader scenario={scenario} />
        <ScenarioBar current={scenario} onSelect={moveTo} />
        {variant === "A" ? <VariantA {...props} /> : null}
        {variant === "B" ? <VariantB {...props} /> : null}
        {variant === "C" ? <VariantC {...props} /> : null}
      </section>
      <footer className="prototype-footnote"><strong>{variant} — {variantMeta[variant].name}</strong><span>{variantMeta[variant].thesis}</span><code>?variant={variant}&amp;mode={mode}&amp;state={scenario}</code></footer>
      <PrototypeSwitcher current={variant} onCycle={cycle} />
    </div>
  );
}
