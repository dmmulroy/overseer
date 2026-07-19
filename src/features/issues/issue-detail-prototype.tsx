import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  GitBranch,
  LockKeyholeOpen,
  Pencil,
  UserRound,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/ui/components/badge";
import { Button, ButtonLink } from "@/ui/components/button";
import { Separator } from "@/ui/components/separator";

/** The three URL-addressable issue-detail structures. */
export type IssueDetailVariant = "A" | "B" | "C";

/** Human-facing context for one issue-detail structure. */
export type IssueDetailVariantMeta = {
  readonly name: string;
  readonly thesis: string;
};

type IssueState = "open" | "closed";
type Assignee = "dmmulroy" | null;
type ActionRelation =
  | "edit"
  | "close"
  | "reopen"
  | "claim"
  | "release"
  | "reassign"
  | "set_parent"
  | "add_blocker"
  | "add_label"
  | "delete";

type ActionLink = {
  readonly relation: ActionRelation;
  readonly label: string;
  readonly method: "PATCH" | "POST" | "PUT" | "DELETE";
  readonly href: string;
  readonly schema: string | null;
};

type MutableIssue = {
  readonly state: IssueState;
  readonly assignee: Assignee;
  readonly lastAction: string;
};

const variantMeta: Readonly<Record<IssueDetailVariant, IssueDetailVariantMeta>> = {
  A: {
    name: "Command header",
    thesis: "Identity and immediately applicable actions lead; state and relationships form a compact scan below.",
  },
  B: {
    name: "Steering rail",
    thesis: "A durable right rail owns claim and state while the issue reads as a calm work brief.",
  },
  C: {
    name: "Readiness board",
    thesis: "Prerequisites, the current decision, and downstream work become the primary steering canvas.",
  },
};

const resolvedInputs = [
  { number: 40, title: "Prototype the Utility foundation in Tailwind and shadcn/Base UI", kind: "Foundation" },
  { number: 47, title: "Assess Tailwind and shadcn/Base UI for Overseer's React client", kind: "Research" },
  { number: 48, title: "Choose the React UI component ownership boundary", kind: "Decision" },
] as const;

function discoveredActions(issue: MutableIssue): ReadonlyArray<ActionLink> {
  const base = "/api/issues/issue_01K0H42DETAIL";
  return [
    {
      relation: "edit",
      label: "Edit issue",
      method: "PATCH",
      href: base,
      schema: "/api/schemas/sha256-6f3a/edit_issue",
    },
    issue.state === "open"
      ? { relation: "close", label: "Close issue", method: "POST", href: `${base}/close`, schema: null }
      : { relation: "reopen", label: "Reopen issue", method: "POST", href: `${base}/reopen`, schema: null },
    issue.assignee === null
      ? { relation: "claim", label: "Claim issue", method: "POST", href: `${base}/claim`, schema: "/api/schemas/sha256-c42d/claim_issue" }
      : { relation: "release", label: "Release claim", method: "POST", href: `${base}/release`, schema: null },
    ...(issue.assignee === null
      ? []
      : [{ relation: "reassign", label: "Reassign", method: "POST", href: `${base}/reassign`, schema: "/api/schemas/sha256-d91b/reassign_issue" }] as const),
    { relation: "set_parent", label: "Change parent", method: "PUT", href: `${base}/parent`, schema: "/api/schemas/sha256-71da/set_parent" },
    { relation: "add_blocker", label: "Add blocker", method: "PUT", href: `${base}/blocked-by/{issue_id}`, schema: null },
    { relation: "add_label", label: "Add label", method: "PUT", href: `${base}/labels/{label_id}`, schema: null },
    { relation: "delete", label: "Delete issue", method: "DELETE", href: base, schema: null },
  ];
}

function StateBadge({ state }: { readonly state: IssueState }) {
  return (
    <Badge variant={state === "open" ? "success" : "secondary"}>
      {state === "open" ? <Circle aria-hidden="true" size={8} /> : <Check aria-hidden="true" size={10} />}
      {state === "open" ? "Open" : "Closed"}
    </Badge>
  );
}

function LabelBadges() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Labels">
      <Badge variant="secondary">wayfinder:prototype</Badge>
      <Badge variant="outline">UI</Badge>
      <Badge variant="warning">HITL</Badge>
    </div>
  );
}

function AssigneeValue({ assignee }: { readonly assignee: Assignee }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-accent-foreground">
        {assignee === null ? "—" : "DM"}
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-xs">{assignee ?? "Unassigned"}</strong>
        <span className="block text-[11px] text-muted-foreground">
          {assignee === null ? "Available to claim" : "Cooperative claim"}
        </span>
      </span>
    </div>
  );
}

function applyAction(issue: MutableIssue, relation: ActionRelation): MutableIssue {
  if (relation === "close") return { ...issue, state: "closed", lastAction: "Closed locally; discovered action changed to reopen." };
  if (relation === "reopen") return { ...issue, state: "open", lastAction: "Reopened locally; discovered action changed to close." };
  if (relation === "release") return { ...issue, assignee: null, lastAction: "Released claim; claim is now applicable." };
  if (relation === "claim") return { ...issue, assignee: "dmmulroy", lastAction: "Claimed as dmmulroy; release and reassign are now applicable." };
  return { ...issue, lastAction: `${relation.replaceAll("_", " ")} selected; mutation is stubbed in this prototype.` };
}

function PrimaryActions({
  issue,
  onAction,
  orientation = "row",
}: {
  readonly issue: MutableIssue;
  readonly onAction: (relation: ActionRelation) => void;
  readonly orientation?: "row" | "column";
}) {
  const claimRelation = issue.assignee === null ? "claim" : "release";
  const stateRelation = issue.state === "open" ? "close" : "reopen";
  return (
    <div className={orientation === "row" ? "flex flex-wrap gap-2" : "grid gap-2"}>
      <Button onClick={() => onAction(claimRelation)} className={orientation === "column" ? "w-full" : undefined}>
        <UserRound aria-hidden="true" size={14} />
        {issue.assignee === null ? "Claim issue" : "Release claim"}
      </Button>
      <Button variant="outline" onClick={() => onAction("edit")} className={orientation === "column" ? "w-full" : undefined}>
        <Pencil aria-hidden="true" size={13} /> Edit
      </Button>
      <Button variant="outline" onClick={() => onAction(stateRelation)} className={orientation === "column" ? "w-full" : undefined}>
        {issue.state === "open" ? "Close issue" : "Reopen issue"}
      </Button>
    </div>
  );
}

function ActionLinks({ links, onAction, compact = false }: {
  readonly links: ReadonlyArray<ActionLink>;
  readonly onAction: (relation: ActionRelation) => void;
  readonly compact?: boolean;
}) {
  return (
    <section aria-labelledby={compact ? "action-links-compact" : "action-links"}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground">DISCOVERED ACTIONS</p>
          <h2 id={compact ? "action-links-compact" : "action-links"} className="mt-1 text-sm font-semibold text-strong">
            Available from current state
          </h2>
        </div>
        <Badge variant="outline">{links.length} links</Badge>
      </div>
      <div className={compact ? "mt-3 grid gap-1.5" : "mt-3 overflow-hidden rounded-md border border-border"}>
        {links.map((link) => (
          <button
            key={link.relation}
            type="button"
            onClick={() => onAction(link.relation)}
            className={compact
              ? "grid w-full grid-cols-[46px_minmax(0,1fr)] gap-2 rounded-md border border-hairline bg-card px-2.5 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              : "grid w-full grid-cols-[52px_120px_minmax(0,1fr)] items-center gap-2 border-b border-hairline bg-card px-3 py-2 text-left last:border-b-0 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"}
          >
            <span className="font-mono text-[9px] font-semibold text-accent-foreground">{link.method}</span>
            <strong className={compact ? "truncate text-xs" : "text-xs"}>{link.label}</strong>
            {!compact && <code className="truncate text-[10px] text-muted-foreground">{link.relation}</code>}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        Controls appear only when their relation is present; the server still validates every mutation.
      </p>
    </section>
  );
}

function IssueBody() {
  return (
    <section aria-labelledby="issue-question">
      <p className="font-mono text-[10px] tracking-widest text-muted-foreground">QUESTION</p>
      <h2 id="issue-question" className="mt-1 text-base font-semibold text-strong">What must this prototype settle?</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-foreground">
        Using React, Tailwind CSS v4, shadcn/Base UI, and the formalized Utility foundation, compose identity,
        state, Labels, Assignee, hierarchy, Blocking relations, primary actions, and HATEOAS-discovered actions
        so the owner can understand and steer work at a glance.
      </p>
      <ul className="mt-4 grid gap-2 pl-5 text-sm leading-5 text-muted-foreground marker:text-accent-foreground">
        <li>Compare at least three materially different structures in light, dark, desktop, and mobile.</li>
        <li>Keep product concepts in the Issue feature; generic components stay domain-free.</li>
        <li>Request human review before selecting or resolving a direction.</li>
      </ul>
    </section>
  );
}

function ParentAndSubIssues({ outline = false }: { readonly outline?: boolean }) {
  return (
    <section aria-labelledby={outline ? "hierarchy-outline" : "hierarchy"}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground">HIERARCHY</p>
          <h2 id={outline ? "hierarchy-outline" : "hierarchy"} className="mt-1 text-sm font-semibold text-strong">Parent & sub-issues</h2>
        </div>
        <Button variant="ghost" size="xs">Edit</Button>
      </div>
      <a href="#parent-35" className="mt-3 flex items-center gap-3 rounded-md border border-info bg-info-muted p-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <GitBranch aria-hidden="true" className="shrink-0 text-info-foreground" size={16} />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9px] tracking-wider text-info-foreground">PARENT · #35</span>
          <strong className="mt-1 block truncate text-xs">Specify Overseer's simple agent-first MVP (v2)</strong>
        </span>
        <ArrowRight aria-hidden="true" className="text-muted-foreground" size={14} />
      </a>
      <div className={outline ? "ml-5 border-l border-border py-3 pl-4" : "mt-2 rounded-md border border-dashed border-border bg-surface-recessed p-3"}>
        <p className="text-xs font-medium">No sub-issues</p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">This decision is a leaf under the MVP specification map.</p>
      </div>
    </section>
  );
}

function BlockingRelations({ condensed = false }: { readonly condensed?: boolean }) {
  return (
    <section aria-labelledby={condensed ? "blocking-condensed" : "blocking"}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground">BLOCKING RELATIONS</p>
          <h2 id={condensed ? "blocking-condensed" : "blocking"} className="mt-1 text-sm font-semibold text-strong">Ready now · 3 resolved inputs</h2>
        </div>
        <Badge variant="success">0 active</Badge>
      </div>
      <div className="mt-3 grid gap-2">
        {resolvedInputs.map((input) => (
          <a
            href={`#issue-${input.number}`}
            key={input.number}
            className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Check aria-label="Resolved" className="text-success-foreground" size={13} />
            <span className="min-w-0">
              <strong className="block truncate text-xs">#{input.number} {input.title}</strong>
              {!condensed && <span className="mt-0.5 block text-[10px] text-muted-foreground">Inactive blocker · closed</span>}
            </span>
            <Badge variant="secondary">{input.kind}</Badge>
          </a>
        ))}
      </div>
    </section>
  );
}

function DownstreamIssue() {
  return (
    <a href="#issue-46" className="flex items-center gap-3 rounded-md border border-border bg-card p-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <LockKeyholeOpen aria-hidden="true" className="shrink-0 text-warning-foreground" size={16} />
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[9px] tracking-wider text-muted-foreground">BLOCKS · #46</span>
        <strong className="mt-1 block text-xs">Lock the MVP specification and build-readiness boundary</strong>
      </span>
      <ArrowRight aria-hidden="true" className="text-muted-foreground" size={14} />
    </a>
  );
}

function ReviewGate() {
  return (
    <div className="rounded-md border border-warning bg-warning-muted p-3 text-warning-foreground">
      <div className="flex items-center gap-2">
        <LockKeyholeOpen aria-hidden="true" size={14} />
        <strong className="text-xs">Human review required</strong>
      </div>
      <p className="mt-1.5 text-[11px] leading-4">Do not choose a winner or resolve #42 until the owner reviews all variants.</p>
    </div>
  );
}

function VariantA({ issue, links, onAction }: VariantProps) {
  return (
    <article className="detail-variant-a bg-card" data-variant="A">
      <header className="px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StateBadge state={issue.state} />
          <span>Overseer / Issue #42</span>
          <span aria-hidden="true">·</span>
          <span>Updated just now</span>
        </div>
        <div className="mt-3 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl">
            <h1 className="text-3xl font-semibold leading-[1.08] tracking-tight text-strong sm:text-4xl lg:text-5xl">
              Prototype issue detail steering in shadcn/Base UI
            </h1>
          </div>
          <PrimaryActions issue={issue} onAction={onAction} />
        </div>
      </header>

      <div className="grid border-y border-border sm:grid-cols-2 xl:grid-cols-4">
        <div className="border-b border-border bg-surface-recessed p-4 sm:border-r xl:border-b-0">
          <p className="font-mono text-[9px] tracking-widest text-muted-foreground">STATE</p>
          <div className="mt-2"><StateBadge state={issue.state} /></div>
        </div>
        <div className="border-b border-border bg-surface-recessed p-4 xl:border-b-0 xl:border-r">
          <p className="font-mono text-[9px] tracking-widest text-muted-foreground">ASSIGNEE / CLAIM</p>
          <div className="mt-2"><AssigneeValue assignee={issue.assignee} /></div>
        </div>
        <div className="border-b border-border bg-surface-recessed p-4 sm:border-r sm:border-b-0">
          <p className="font-mono text-[9px] tracking-widest text-muted-foreground">LABELS</p>
          <div className="mt-2"><LabelBadges /></div>
        </div>
        <div className="bg-success-muted p-4 text-success-foreground">
          <p className="font-mono text-[9px] tracking-widest">READINESS</p>
          <strong className="mt-2 block text-sm">Ready for prototype</strong>
          <span className="mt-1 block text-[11px]">0 active blockers</span>
        </div>
      </div>

      <div className="grid gap-8 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          <IssueBody />
          <Separator />
          <ParentAndSubIssues />
        </div>
        <aside className="min-w-0 space-y-6">
          <BlockingRelations condensed />
          <div>
            <p className="mb-3 font-mono text-[10px] tracking-widest text-muted-foreground">DOWNSTREAM</p>
            <DownstreamIssue />
          </div>
          <ActionLinks links={links} onAction={onAction} compact />
          <ReviewGate />
        </aside>
      </div>
    </article>
  );
}

function VariantB({ issue, links, onAction }: VariantProps) {
  return (
    <article className="detail-variant-b grid bg-card lg:grid-cols-[minmax(0,1fr)_290px]" data-variant="B">
      <aside className="order-2 border-t border-border bg-surface-recessed p-5 lg:border-t-0 lg:border-l lg:p-6">
        <ButtonLink href="#issues" variant="ghost" className="mb-5">
          <ArrowLeft aria-hidden="true" size={13} /> Issues
        </ButtonLink>
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xl font-semibold text-strong">#42</span>
          <StateBadge state={issue.state} />
        </div>
        <Separator className="my-5" />
        <div>
          <p className="font-mono text-[9px] tracking-widest text-muted-foreground">ASSIGNEE / CLAIM</p>
          <div className="mt-3"><AssigneeValue assignee={issue.assignee} /></div>
        </div>
        <div className="mt-4"><PrimaryActions issue={issue} onAction={onAction} orientation="column" /></div>
        <Separator className="my-5" />
        <div>
          <p className="mb-2 font-mono text-[9px] tracking-widest text-muted-foreground">LABELS</p>
          <LabelBadges />
        </div>
        <div className="mt-5 rounded-md border border-success bg-success-muted p-3 text-success-foreground">
          <p className="font-mono text-[9px] tracking-widest">READINESS</p>
          <strong className="mt-2 block text-xs">All inputs resolved</strong>
          <p className="mt-1 text-[11px]">Ready for human-guided review.</p>
        </div>
        <div className="mt-5"><ReviewGate /></div>
      </aside>

      <div className="order-1 min-w-0 px-5 py-7 sm:px-8 lg:px-12 lg:py-10">
        <header className="max-w-4xl">
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground">PERSONAL / OVERSEER / ISSUE</p>
          <h1 className="mt-3 text-3xl font-semibold leading-[1.08] tracking-tight text-strong sm:text-5xl">
            Prototype issue detail steering in shadcn/Base UI
          </h1>
          <p className="mt-4 text-xs text-muted-foreground">Opened from the MVP specification map · claimed by dmmulroy</p>
        </header>
        <Separator className="my-7" />
        <IssueBody />
        <Separator className="my-8" />
        <div className="grid gap-8 xl:grid-cols-2">
          <ParentAndSubIssues outline />
          <BlockingRelations />
        </div>
        <Separator className="my-8" />
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
          <ActionLinks links={links} onAction={onAction} />
          <div>
            <p className="mb-3 font-mono text-[10px] tracking-widest text-muted-foreground">UNLOCKS</p>
            <DownstreamIssue />
            <p className="mt-3 text-[11px] leading-4 text-muted-foreground">#46 remains blocked until this prototype receives a human decision.</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function BoardNode({ eyebrow, children, tone = "default" }: {
  readonly eyebrow: string;
  readonly children: ReactNode;
  readonly tone?: "default" | "success" | "warning" | "info";
}) {
  const toneClass = {
    default: "border-border bg-card",
    success: "border-success bg-success-muted",
    warning: "border-warning bg-warning-muted",
    info: "border-info bg-info-muted",
  }[tone];
  return (
    <div className={`rounded-md border p-4 ${toneClass}`}>
      <p className="font-mono text-[9px] tracking-widest text-muted-foreground">{eyebrow}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function VariantC({ issue, links, onAction }: VariantProps) {
  return (
    <article className="detail-variant-c bg-surface-recessed" data-variant="C">
      <header className="flex flex-col gap-5 border-b border-border bg-card px-5 py-6 sm:px-8 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><StateBadge state={issue.state} /><span>Overseer #42</span></div>
          <h1 className="mt-3 max-w-4xl text-3xl font-semibold leading-[1.08] tracking-tight text-strong sm:text-4xl">
            Prototype issue detail steering in shadcn/Base UI
          </h1>
        </div>
        <PrimaryActions issue={issue} onAction={onAction} />
      </header>

      <div className="prototype-grid-dots px-4 py-7 sm:px-7 lg:py-10">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground">READINESS BOARD</p>
            <h2 className="mt-1 text-lg font-semibold text-strong">What makes #42 actionable?</h2>
          </div>
          <Badge variant="success">Ready · 0 active blockers</Badge>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)_minmax(0,1fr)] xl:items-center">
          <div className="space-y-2">
            <p className="font-mono text-[9px] tracking-widest text-muted-foreground">RESOLVED INPUTS</p>
            {resolvedInputs.map((input) => (
              <BoardNode key={input.number} eyebrow={`${input.kind.toUpperCase()} · #${input.number}`} tone="success">
                <div className="flex items-start gap-2">
                  <Check aria-hidden="true" className="mt-0.5 shrink-0 text-success-foreground" size={13} />
                  <strong className="text-xs leading-4">{input.title}</strong>
                </div>
              </BoardNode>
            ))}
          </div>

          <BoardNode eyebrow="CURRENT ISSUE" tone="info">
            <div className="flex items-center justify-between gap-2"><StateBadge state={issue.state} /><Badge variant="warning">HITL</Badge></div>
            <h3 className="mt-3 text-lg font-semibold leading-5 text-strong">#42 Issue detail steering</h3>
            <div className="mt-3"><LabelBadges /></div>
            <Separator className="my-4" />
            <AssigneeValue assignee={issue.assignee} />
          </BoardNode>

          <div>
            <p className="mb-2 font-mono text-[9px] tracking-widest text-muted-foreground">UNLOCKS</p>
            <BoardNode eyebrow="BLOCKS · #46" tone="warning">
              <strong className="text-sm leading-5">Lock the MVP specification and build-readiness boundary</strong>
              <p className="mt-2 text-[11px] leading-4 text-warning-foreground">Waiting for a reviewed issue-detail direction.</p>
            </BoardNode>
          </div>
        </div>
      </div>

      <div className="grid border-t border-border bg-card xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8 p-5 sm:p-8">
          <IssueBody />
          <Separator />
          <ParentAndSubIssues />
          <ReviewGate />
        </div>
        <aside className="border-t border-border bg-surface-raised p-5 sm:p-7 xl:border-t-0 xl:border-l">
          <ActionLinks links={links} onAction={onAction} compact />
          <Separator className="my-6" />
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground">NEXT MOVE</p>
          <h2 className="mt-2 text-base font-semibold text-strong">Compare, then ask the owner</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">The issue is technically unblocked. The remaining gate is a human choice across the three structures.</p>
          <ButtonLink className="mt-4" href="#review">Open review context <ArrowRight aria-hidden="true" size={13} /></ButtonLink>
        </aside>
      </div>
    </article>
  );
}

type VariantProps = {
  readonly issue: MutableIssue;
  readonly links: ReadonlyArray<ActionLink>;
  readonly onAction: (relation: ActionRelation) => void;
};

/** Render one throwaway issue-detail direction using realistic #42 state. */
export function IssueDetailPrototype({ variant }: { readonly variant: IssueDetailVariant }) {
  const [issue, setIssue] = useState<MutableIssue>({
    state: "open",
    assignee: "dmmulroy",
    lastAction: "Fixture loaded from current #42 review state.",
  });
  const links = useMemo(() => discoveredActions(issue), [issue]);
  const onAction = (relation: ActionRelation) => setIssue((current) => applyAction(current, relation));

  return (
    <div>
      <div className="border-b border-info bg-info-muted px-4 py-2 text-center text-[11px] text-info-foreground" role="status" aria-live="polite">
        <strong>{issue.state}</strong> · {issue.assignee === null ? "unassigned" : `assigned to ${issue.assignee}`} · 3 Labels · 0 active blockers · {links.length} current actions
        <span className="hidden sm:inline"> — {issue.lastAction}</span>
      </div>
      {variant === "A" && <VariantA issue={issue} links={links} onAction={onAction} />}
      {variant === "B" && <VariantB issue={issue} links={links} onAction={onAction} />}
      {variant === "C" && <VariantC issue={issue} links={links} onAction={onAction} />}
    </div>
  );
}

/** Return the human-facing name and thesis for a prototype direction. */
export function issueDetailVariantMeta(variant: IssueDetailVariant): IssueDetailVariantMeta {
  return variantMeta[variant];
}
