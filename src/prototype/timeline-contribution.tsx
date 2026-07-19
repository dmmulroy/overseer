import {
  Bot,
  Check,
  ChevronDown,
  CircleDot,
  FileText,
  GitCommit,
  History,
  Link2,
  Moon,
  MoreHorizontal,
  Paperclip,
  Sun,
  Tag,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Textarea } from "@/ui/components/textarea";

// PROTOTYPE — Three structurally different timeline and contribution models,
// switchable via ?variant= and ?mode= on /prototype/timeline-contribution.

type Variant = "A" | "B" | "C";
type Mode = "light" | "dark";
type ComposeMode = "write" | "preview";
type Channel = "conversation" | "changes" | "files";
type ActorKind = "human" | "agent";

const variants: ReadonlyArray<Variant> = ["A", "B", "C"];
const variantMeta: Readonly<Record<Variant, { readonly name: string; readonly thesis: string }>> = {
  A: {
    name: "Narrative thread",
    thesis: "Treat the body as the opening contribution, summarize structured changes before the discussion, and keep comments chronological.",
  },
  B: {
    name: "Brief + checkpoints",
    thesis: "Pin the issue brief beside a work notebook that groups contributions, evidence, and event summaries by outcome.",
  },
  C: {
    name: "Conversation + ledger",
    thesis: "Give conversation the center while structured history and files remain complete in dedicated parallel views.",
  },
};

const initialDraft = "Confirmed on a throttled connection. The draft stayed intact while the upload resumed at part 9 of 12.";

function readUrlState(): { readonly variant: Variant; readonly mode: Mode } {
  const params = new URL(window.location.href).searchParams;
  const candidate = params.get("variant");
  return {
    variant: candidate === "B" || candidate === "C" ? candidate : "A",
    mode: params.get("mode") === "dark" ? "dark" : "light",
  };
}

function writeUrl(variant: Variant, mode: Mode): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/timeline-contribution";
  url.searchParams.set("variant", variant);
  url.searchParams.set("mode", mode);
  window.history.replaceState({}, "", url);
}

function cycleVariant(current: Variant, direction: -1 | 1): Variant {
  const currentIndex = variants.indexOf(current);
  const next = variants.at((currentIndex + direction + variants.length) % variants.length);
  if (next === undefined) throw new Error("Variant cycle produced no result");
  return next;
}

function Actor({ kind, time }: { readonly kind: ActorKind; readonly time: string }) {
  const isHuman = kind === "human";
  return (
    <div className="actor">
      <span className={`actor-avatar actor-avatar--${kind}`} aria-hidden="true">
        {isHuman ? <UserRound size={14} /> : <Bot size={15} />}
      </span>
      <div className="actor-copy">
        <div className="actor-name">
          <strong>{isHuman ? "Dillon Mulroy" : "pi · cf-agent…b71"}</strong>
          <Badge variant={isHuman ? "outline" : "secondary"}>{isHuman ? "Human" : "Agent"}</Badge>
        </div>
        <p>{isHuman ? time : `${time} · session upload-retry-7F2`}</p>
      </div>
    </div>
  );
}

function Attachment({ name, meta, kind = "file" }: { readonly name: string; readonly meta: string; readonly kind?: "file" | "image" | "video" }) {
  return (
    <a className="attachment" href={`#${name}`}>
      <span className={`attachment-icon attachment-icon--${kind}`} aria-hidden="true">
        {kind === "file" ? <FileText size={15} /> : <Paperclip size={15} />}
      </span>
      <span className="attachment-copy">
        <strong>{name}</strong>
        <small>{meta}</small>
      </span>
      <span className="attachment-action" aria-hidden="true">↗</span>
    </a>
  );
}

function MarkdownBody({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div className={`markdown${compact ? " markdown--compact" : ""}`}>
      <p>
        Large uploads restart from zero after a reconnect. Preserve confirmed parts so contributors can continue without selecting the file again or losing the surrounding comment draft.
      </p>
      <h3>Acceptance checks</h3>
      <ul>
        <li>Resume from the last confirmed part after reconnecting.</li>
        <li>Keep the comment draft when an upload is retried or cancelled.</li>
        <li>Show meaningful progress without posting an event for every part.</li>
      </ul>
      {!compact && <blockquote>A failed upload is recoverable work, not a reason to rewrite the contribution.</blockquote>}
    </div>
  );
}

function Comment({ kind, time, children, flat = false }: { readonly kind: ActorKind; readonly time: string; readonly children: ReactNode; readonly flat?: boolean }) {
  return (
    <article className={`comment${flat ? " comment--flat" : ""}`}>
      <Actor kind={kind} time={time} />
      <div className="comment-content markdown">{children}</div>
      <footer className="comment-actions">
        <Button variant="ghost" size="xs">Reply</Button>
        <Button variant="ghost" size="icon" aria-label="More comment actions"><MoreHorizontal size={14} /></Button>
      </footer>
    </article>
  );
}

function Composer({ placement, draft, onDraftChange }: { readonly placement: "bottom" | "top" | "dock"; readonly draft: string; readonly onDraftChange: (value: string) => void }) {
  const [composeMode, setComposeMode] = useState<ComposeMode>("write");
  return (
    <section className={`composer composer--${placement}`} aria-label="Add a comment">
      <header className="composer-header">
        <div className="composer-identity">
          <span className="actor-avatar actor-avatar--human" aria-hidden="true"><UserRound size={13} /></span>
          <strong>{placement === "top" ? "Post a checkpoint" : "Join the conversation"}</strong>
        </div>
        <div className="compose-tabs" role="group" aria-label="Comment editor mode">
          <Button variant={composeMode === "write" ? "secondary" : "ghost"} size="xs" onClick={() => setComposeMode("write")}>Write</Button>
          <Button variant={composeMode === "preview" ? "secondary" : "ghost"} size="xs" onClick={() => setComposeMode("preview")}>Preview</Button>
        </div>
      </header>
      {composeMode === "write" ? (
        <Textarea
          aria-label="Comment"
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
      ) : (
        <div className="compose-preview markdown" aria-label="Rendered Markdown preview">
          <p>{draft.length === 0 ? "Nothing to preview." : draft}</p>
        </div>
      )}
      <div className="pending-upload">
        <span aria-hidden="true"><UploadCloud size={15} /></span>
        <div><strong>reconnect-waterfall.png</strong><small>482 KB · uploaded · ready to include</small></div>
        <Button variant="ghost" size="icon" aria-label="Remove reconnect-waterfall.png"><X size={13} /></Button>
      </div>
      <footer className="composer-footer">
        <div><Button variant="ghost" size="xs"><Paperclip size={13} /> Attach file</Button><span>Markdown supported</span></div>
        <Button>{placement === "top" ? "Post update" : "Comment"}</Button>
      </footer>
    </section>
  );
}

function IssueHeader({ model }: { readonly model: string }) {
  return (
    <header className="issue-header">
      <div className="issue-kicker"><Badge variant="success"><CircleDot size={10} /> Open</Badge><span>Issue #38</span><span className="model-label">{model}</span></div>
      <div className="issue-title-row">
        <h1>Add resumable uploads for large attachments</h1>
        <div><Button variant="outline">Close</Button><Button>Edit</Button></div>
      </div>
      <p>Opened by Dillon 2 hours ago · <strong>pi/upload-retry-7F2</strong> is assigned</p>
    </header>
  );
}

function VariantA({ draft, onDraftChange }: { readonly draft: string; readonly onDraftChange: (value: string) => void }) {
  const [digestExpanded, setDigestExpanded] = useState(false);
  return (
    <main className="variant variant-a">
      <IssueHeader model="Body → thread → digest" />
      <article className="opening-contribution">
        <header><Actor kind="human" time="Opened 2 hours ago · edited 1 hour ago" /><Button variant="ghost" size="icon" aria-label="Issue body actions"><MoreHorizontal size={14} /></Button></header>
        <div className="opening-body"><MarkdownBody /><Attachment name="retry-flow.png" meta="Issue body · 1240 × 760 · 286 KB" kind="image" /></div>
        <footer><span>Revision 3</span><Button variant="ghost" size="xs"><History size={12} /> View edits</Button></footer>
      </article>

      <div className="section-heading"><h2>Conversation</h2><span>3 comments · 9 changes</span></div>
      <section className="thread" aria-label="Issue timeline">
        <section className="event-digest">
          <button type="button" className="digest-toggle" onClick={() => setDigestExpanded((value) => !value)} aria-expanded={digestExpanded}>
            <span><ChevronDown size={14} className={digestExpanded ? "is-open" : ""} /> 4 changes · 48–31 minutes ago</span>
            <small>claim, label, blocker, body edit</small>
          </button>
          {digestExpanded && (
            <ol className="digest-list">
              <li><time>48m</time><CircleDot size={12} /><span><strong>pi · cf-agent…b71</strong> claimed as pi/upload-retry-7F2</span></li>
              <li><time>44m</time><Tag size={12} /><span><strong>Dillon Mulroy</strong> added reliability</span></li>
              <li><time>36m</time><Link2 size={12} /><span><strong>pi · cf-agent…b71</strong> linked blocker #42</span></li>
              <li><time>31m</time><History size={12} /><span><strong>Dillon Mulroy</strong> edited the issue body · revision 3</span></li>
            </ol>
          )}
        </section>
        <Comment kind="agent" time="1 hour ago">
          <p>I reproduced the restart by interrupting part 4 of 12. Confirmed part tokens survive on the server, but the browser discards its local upload session.</p>
          <Attachment name="upload-reconnect.mp4" meta="0:24 · 3.8 MB" kind="video" />
        </Comment>
        <Comment kind="human" time="21 minutes ago">
          <p>Please preserve the comment draft even when the upload itself is cancelled. The text is the contribution; the file should not hold it hostage.</p>
        </Comment>
        <Comment kind="agent" time="6 minutes ago">
          <p>Moved draft state above the upload lifecycle. A reconnect now resumes at the first unconfirmed part.</p>
          <pre><code>8 / 12 parts confirmed{"\n"}retrying part 9 · attempt 2</code></pre>
          <Attachment name="reconnect-waterfall.png" meta="1440 × 900 · 482 KB" kind="image" />
        </Comment>
      </section>
      <Composer placement="bottom" draft={draft} onDraftChange={onDraftChange} />
    </main>
  );
}

function Checkpoint({ title, time, summary, children }: { readonly title: string; readonly time: string; readonly summary: string; readonly children: ReactNode }) {
  return (
    <section className="checkpoint">
      <header><div><span className="checkpoint-mark" aria-hidden="true"><Check size={12} /></span><h2>{title}</h2></div><time>{time}</time></header>
      <p className="checkpoint-summary">{summary}</p>
      <div className="checkpoint-content">{children}</div>
    </section>
  );
}

function VariantB({ draft, onDraftChange }: { readonly draft: string; readonly onDraftChange: (value: string) => void }) {
  const [briefExpanded, setBriefExpanded] = useState(true);
  return (
    <main className="variant variant-b">
      <IssueHeader model="Pinned brief + outcome log" />
      <div className="notebook-layout">
        <aside className="brief-rail">
          <header><div><FileText size={13} /><strong>Pinned brief</strong></div><Button variant="ghost" size="xs" onClick={() => setBriefExpanded((value) => !value)}>{briefExpanded ? "Collapse" : "Expand"}</Button></header>
          {briefExpanded ? <><MarkdownBody compact /><Attachment name="retry-flow.png" meta="Issue body · 286 KB" kind="image" /></> : <p className="brief-summary">Resume uploads without losing the surrounding comment draft.</p>}
          <dl>
            <div><dt>Assignee</dt><dd>pi/upload-retry-7F2</dd></div>
            <div><dt>Labels</dt><dd><Badge variant="secondary">attachments</Badge> <Badge variant="secondary">reliability</Badge></dd></div>
            <div><dt>Blocked by</dt><dd><a href="#42">#42 Show upload progress</a></dd></div>
            <div><dt>Body</dt><dd>Revision 3 · edited 1h ago</dd></div>
          </dl>
        </aside>
        <section className="work-notebook">
          <Composer placement="top" draft={draft} onDraftChange={onDraftChange} />
          <header className="notebook-heading"><h2>Work checkpoints</h2><p>Contributions and evidence grouped by outcome; mechanics summarized on each checkpoint.</p></header>
          <Checkpoint title="Reproduced" time="10:18–10:42" summary="3 changes · claimed, labelled, linked blocker #42">
            <Comment kind="agent" time="10:31" flat><p>Interrupted part 4 of 12. The server retained completed parts; reconnect created a fresh local upload session.</p></Comment>
            <Attachment name="upload-reconnect.mp4" meta="Evidence · 0:24 · 3.8 MB" kind="video" />
          </Checkpoint>
          <Checkpoint title="Constraint clarified" time="10:59" summary="1 human comment · no structured changes">
            <Comment kind="human" time="10:59" flat><p>The draft must survive retry and cancel. Treat the attachment as part of the comment, not as the owner of its text.</p></Comment>
          </Checkpoint>
          <Checkpoint title="Retry checkpoint ready" time="11:14–11:32" summary="5 changes · body edit, attachment, claim retained">
            <Comment kind="agent" time="11:28" flat><p>Moved draft state above the upload lifecycle. Reconnect resumes at the first unconfirmed part.</p><pre><code>8 / 12 parts confirmed · retrying part 9</code></pre></Comment>
            <div className="artifact-pair"><Attachment name="reconnect-waterfall.png" meta="Result · 482 KB" kind="image" /><Attachment name="retry-trace.txt" meta="Diagnostic · 12 KB" /></div>
          </Checkpoint>
        </section>
      </div>
    </main>
  );
}

function ChangesLedger() {
  const events = [
    { icon: <CircleDot size={13} />, actor: "pi · cf-agent…b71", action: "claimed this issue", detail: "Assignee: pi/upload-retry-7F2", time: "48m" },
    { icon: <Tag size={13} />, actor: "Dillon Mulroy", action: "added reliability", detail: "Project label", time: "44m" },
    { icon: <Link2 size={13} />, actor: "pi · cf-agent…b71", action: "linked blocker #42", detail: "Show upload progress in issue comments", time: "36m" },
    { icon: <History size={13} />, actor: "Dillon Mulroy", action: "edited the issue body", detail: "Revision 3 · compare changes", time: "18m" },
    { icon: <GitCommit size={13} />, actor: "pi · cf-agent…b71", action: "added implementation evidence", detail: "reconnect-waterfall.png", time: "6m" },
  ] as const;
  return (
    <section className="ledger" aria-label="Structured changes">
      <header><div><History size={14} /><strong>Change ledger</strong></div><Badge variant="outline">5 events</Badge></header>
      <p className="ledger-note">Complete structured history, kept adjacent to—but out of—the conversation.</p>
      <ol>{events.map((event) => <li key={`${event.time}-${event.action}`}><span className="ledger-icon" aria-hidden="true">{event.icon}</span><div><p><strong>{event.actor}</strong> {event.action}</p><small>{event.detail}</small></div><time>{event.time}</time></li>)}</ol>
    </section>
  );
}

function FilesShelf() {
  return (
    <section className="files-shelf" aria-label="Issue attachments">
      <header><div><Paperclip size={14} /><strong>Files</strong><span>3</span></div><Button variant="ghost" size="xs">View all</Button></header>
      <Attachment name="retry-flow.png" meta="Issue body · 286 KB" kind="image" />
      <Attachment name="upload-reconnect.mp4" meta="Agent comment · 3.8 MB" kind="video" />
      <Attachment name="reconnect-waterfall.png" meta="Agent comment · 482 KB" kind="image" />
    </section>
  );
}

function VariantC({ draft, onDraftChange }: { readonly draft: string; readonly onDraftChange: (value: string) => void }) {
  const [channel, setChannel] = useState<Channel>("conversation");
  return (
    <main className="variant variant-c">
      <IssueHeader model="Conversation center + parallel record" />
      <article className="compact-brief">
        <div><FileText size={14} /><div><strong>Issue brief</strong><p>Resume large uploads from the last confirmed part without letting upload state own the comment draft.</p></div></div>
        <Button variant="outline" size="xs">Read full body</Button>
      </article>
      <nav className="mobile-channels" aria-label="Issue content">
        {(["conversation", "changes", "files"] as const).map((value) => <Button key={value} variant={channel === value ? "secondary" : "ghost"} size="xs" onClick={() => setChannel(value)}>{value === "conversation" ? "Conversation 3" : value === "changes" ? "Changes 5" : "Files 3"}</Button>)}
      </nav>
      <div className={`record-layout channel-${channel}`}>
        <section className="conversation-pane" aria-label="Conversation">
          <div className="conversation-heading"><div><h2>Conversation</h2><p>Comments and their evidence</p></div><Badge variant="outline">3</Badge></div>
          <Comment kind="agent" time="1 hour ago" flat><p>I reproduced the restart after interrupting part 4. Completed part tokens survive on the server, but the browser starts a fresh upload session.</p><Attachment name="upload-reconnect.mp4" meta="0:24 · 3.8 MB" kind="video" /></Comment>
          <Comment kind="human" time="21 minutes ago" flat><p>Please preserve the draft on both retry and cancel. The attachment should not own the text around it.</p></Comment>
          <Comment kind="agent" time="6 minutes ago" flat><p>Done. Draft state now sits outside the upload lifecycle, and reconnect resumes at part 9 of 12.</p><Attachment name="reconnect-waterfall.png" meta="1440 × 900 · 482 KB" kind="image" /></Comment>
          <Composer placement="dock" draft={draft} onDraftChange={onDraftChange} />
        </section>
        <aside className="record-rail"><ChangesLedger /><FilesShelf /></aside>
      </div>
    </main>
  );
}

function AppChrome({ children }: { readonly children: ReactNode }) {
  return (
    <section className="app-frame">
      <header className="app-bar">
        <div className="brand"><span>O</span><strong>Overseer</strong></div>
        <nav aria-label="Breadcrumb"><span>Personal</span><i>/</i><span>Attachments</span><i>/</i><strong>#38</strong></nav>
        <div className="app-status"><span><CircleDot size={10} /> Current</span><span className="mini-avatar">DM</span></div>
      </header>
      <div className="app-workspace">
        <aside className="issue-nav">
          <header><div><strong>Issues</strong><small>Attachments · 5 open</small></div><Button variant="outline" size="icon" aria-label="New issue">+</Button></header>
          <div className="nav-filters"><Badge variant="secondary">Open 3</Badge><span>Assigned</span><span>Labels</span></div>
          {[
            [42, "Show upload progress in issue comments", "blocked"],
            [41, "Cancel upload without clearing the draft", "unclaimed"],
            [38, "Add resumable uploads for large attachments", "claimed"],
            [34, "Preserve draft comments after reconnect", "ready"],
          ].map(([number, title, state]) => <button type="button" className={`nav-issue${number === 38 ? " is-selected" : ""}`} key={number}><CircleDot size={11} /><span><strong>{title}</strong><small>#{number} · {state}</small></span></button>)}
        </aside>
        <div className="detail-panel"><div className="freshness"><span><Check size={12} /> Fresh from this device</span><span>Checked just now</span></div>{children}</div>
      </div>
    </section>
  );
}

function PrototypeSwitcher({ current, onChange, onCycle }: { readonly current: Variant; readonly onChange: (variant: Variant) => void; readonly onCycle: (direction: -1 | 1) => void }) {
  if (import.meta.env.PROD) return null;
  return (
    <nav className="prototype-switcher" aria-label="Timeline prototype variants">
      <button type="button" onClick={() => onCycle(-1)} aria-label="Previous variant">←</button>
      <div><small>TIMELINE MODEL</small><strong>{current} — {variantMeta[current].name}</strong></div>
      <span>{variants.map((variant) => <button type="button" className={variant === current ? "is-active" : ""} onClick={() => onChange(variant)} key={variant} aria-label={`Show ${variantMeta[variant].name}`}>{variant}</button>)}</span>
      <button type="button" onClick={() => onCycle(1)} aria-label="Next variant">→</button>
    </nav>
  );
}

/** Render the throwaway timeline and contribution prototype. */
export function TimelineContributionPrototype() {
  const initial = useMemo(readUrlState, []);
  const [variant, setVariant] = useState<Variant>(initial.variant);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.classList.toggle("light", mode === "light");
    document.documentElement.dataset.mode = mode;
    writeUrl(variant, mode);
  }, [mode, variant]);

  const cycle = (direction: -1 | 1) => setVariant((current) => cycleVariant(current, direction));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const content = variant === "A"
    ? <VariantA draft={draft} onDraftChange={setDraft} />
    : variant === "B"
      ? <VariantB draft={draft} onDraftChange={setDraft} />
      : <VariantC draft={draft} onDraftChange={setDraft} />;

  return (
    <div className="prototype-page">
      <header className="prototype-intro">
        <div><p>PROTOTYPE · Issue #43 · review required</p><h1>{variant} — {variantMeta[variant].name}</h1></div>
        <div className="prototype-thesis"><p>{variantMeta[variant].thesis}</p><Button variant="outline" onClick={() => setMode((current) => current === "light" ? "dark" : "light")}>{mode === "light" ? <Moon size={13} /> : <Sun size={13} />}{mode === "light" ? "Dark" : "Light"} mode</Button></div>
      </header>
      <AppChrome>{content}</AppChrome>
      <PrototypeSwitcher current={variant} onChange={setVariant} onCycle={cycle} />
    </div>
  );
}
