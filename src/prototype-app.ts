import { Button, Input, Textarea } from "@foldkit/ui";
import { Match, Schema } from "effect";
import { Runtime, type Command } from "foldkit";
import { html, type Html } from "foldkit/html";
import { m } from "foldkit/message";

// PROTOTYPE — Three issue-centric interface directions, switchable via ?variant=,
// on the throwaway /prototype/issue-centric route (Vite's SPA fallback).

const VariantSchema = Schema.Union([
  Schema.Literal("A"),
  Schema.Literal("B"),
  Schema.Literal("C"),
]);
const ConflictSchema = Schema.Union([
  Schema.Literal("none"),
  Schema.Literal("shown"),
]);
const AttachmentSchema = Schema.Union([
  Schema.Literal("none"),
  Schema.Literal("uploading"),
  Schema.Literal("ready"),
]);
const ConnectionSchema = Schema.Union([
  Schema.Literal("live"),
  Schema.Literal("reconnecting"),
  Schema.Literal("stale"),
]);

const ChangedVariant = m("ChangedVariant", { variant: VariantSchema });
const SelectedIssue = m("SelectedIssue", { issueNumber: Schema.Number });
const StartedEdit = m("StartedEdit");
const CancelledEdit = m("CancelledEdit");
const ChangedTitle = m("ChangedTitle", { value: Schema.String });
const ChangedBody = m("ChangedBody", { value: Schema.String });
const SavedEdit = m("SavedEdit");
const SimulatedConflict = m("SimulatedConflict");
const KeptMine = m("KeptMine");
const AcceptedTheirs = m("AcceptedTheirs");
const ToggledClosed = m("ToggledClosed");
const ToggledClaim = m("ToggledClaim");
const ToggledLabel = m("ToggledLabel");
const ChangedComment = m("ChangedComment", { value: Schema.String });
const AddedComment = m("AddedComment");
const AdvancedAttachment = m("AdvancedAttachment");
const RequestedDelete = m("RequestedDelete");
const CancelledDelete = m("CancelledDelete");
const ConfirmedDelete = m("ConfirmedDelete");
const RestoredIssue = m("RestoredIssue");
const SimulatedRealtime = m("SimulatedRealtime");
const ToggledConnection = m("ToggledConnection");

const PrototypeMessage = Schema.Union([
  ChangedVariant,
  SelectedIssue,
  StartedEdit,
  CancelledEdit,
  ChangedTitle,
  ChangedBody,
  SavedEdit,
  SimulatedConflict,
  KeptMine,
  AcceptedTheirs,
  ToggledClosed,
  ToggledClaim,
  ToggledLabel,
  ChangedComment,
  AddedComment,
  AdvancedAttachment,
  RequestedDelete,
  CancelledDelete,
  ConfirmedDelete,
  RestoredIssue,
  SimulatedRealtime,
  ToggledConnection,
]);
type PrototypeMessage = typeof PrototypeMessage.Type;

const PrototypeModel = Schema.Struct({
  variant: VariantSchema,
  selectedIssue: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  draftTitle: Schema.String,
  draftBody: Schema.String,
  isEditing: Schema.Boolean,
  isClosed: Schema.Boolean,
  isClaimed: Schema.Boolean,
  hasReadyLabel: Schema.Boolean,
  isDeleted: Schema.Boolean,
  deletePrompt: Schema.Boolean,
  conflict: ConflictSchema,
  commentDraft: Schema.String,
  commentCount: Schema.Number,
  attachment: AttachmentSchema,
  connection: ConnectionSchema,
  sequence: Schema.Number,
  notice: Schema.String,
});
type PrototypeModel = typeof PrototypeModel.Type;
type Variant = PrototypeModel["variant"];

type SeedIssue = Readonly<{
  number: number;
  title: string;
  state: "open" | "closed";
  label: string;
  relation: string;
  updated: string;
}>;

const issues: ReadonlyArray<SeedIssue> = [
  { number: 24, title: "Lock the MVP specification and build-readiness boundary", state: "open", label: "wayfinder:grilling", relation: "blocked by #20 and #23", updated: "8m" },
  { number: 23, title: "Prototype the issue-centric human interface", state: "open", label: "wayfinder:prototype", relation: "blocks #24", updated: "now" },
  { number: 20, title: "Define the agent-first REST API contract", state: "open", label: "wayfinder:grilling", relation: "blocks #24", updated: "19m" },
  { number: 28, title: "Validate persistent cache and speculative prefetch performance", state: "closed", label: "wayfinder:prototype", relation: "unblocked", updated: "2h" },
  { number: 27, title: "Validate Foldkit with Overseer's Effect and Cloudflare seams", state: "closed", label: "wayfinder:prototype", relation: "unblocked", updated: "3h" },
  { number: 22, title: "Define the realtime subscription contract", state: "closed", label: "wayfinder:grilling", relation: "unblocked", updated: "1d" },
  { number: 19, title: "Define authentication, actor metadata, and claiming semantics", state: "closed", label: "wayfinder:grilling", relation: "unblocked", updated: "1d" },
  { number: 10, title: "Specify Overseer's simple agent-first MVP", state: "open", label: "wayfinder:map", relation: "parent map", updated: "1d" },
];

const issueBody = `What is the smallest Foldkit- and @foldkit/ui-based issue list and issue-detail experience that lets the owner observe and fully steer agent work—including metadata, graph relations, timeline, comments, attachments, editing, closing, deletion, conflict states, realtime changes, and local-feeling cached/prefetched navigation—without drifting into a GitHub clone or Kanban product?`;

const variantNames: Readonly<Record<Variant, string>> = {
  A: "Workbench",
  B: "Paper trail",
  C: "Ops console",
};

function variantFromUrl(): Variant {
  const value = new URL(window.location.href).searchParams.get("variant");
  if (value === "B" || value === "C") return value;
  return "A";
}

function writeVariantToUrl(variant: Variant): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/issue-centric";
  url.searchParams.set("variant", variant);
  window.history.replaceState({}, "", url);
}

function selectedSeed(issueNumber: number): SeedIssue {
  return issues.find((issue) => issue.number === issueNumber) ?? issues[1] ?? issues[0] ?? {
    number: 23,
    title: "Prototype the issue-centric human interface",
    state: "open",
    label: "wayfinder:prototype",
    relation: "blocks #24",
    updated: "now",
  };
}

function initialModel(): PrototypeModel {
  const variant = variantFromUrl();
  writeVariantToUrl(variant);
  return {
    variant,
    selectedIssue: 23,
    title: "Prototype the issue-centric human interface",
    body: issueBody,
    draftTitle: "Prototype the issue-centric human interface",
    draftBody: issueBody,
    isEditing: false,
    isClosed: false,
    isClaimed: true,
    hasReadyLabel: false,
    isDeleted: false,
    deletePrompt: false,
    conflict: "none",
    commentDraft: "",
    commentCount: 2,
    attachment: "none",
    connection: "live",
    sequence: 184,
    notice: "Prefetched detail · rendered from cache in 18 ms",
  };
}

function update(
  model: PrototypeModel,
  message: PrototypeMessage,
): readonly [PrototypeModel, ReadonlyArray<Command.Command<PrototypeMessage>>] {
  return Match.value(message).pipe(
    Match.withReturnType<readonly [PrototypeModel, ReadonlyArray<Command.Command<PrototypeMessage>>]>(),
    Match.tagsExhaustive({
      ChangedVariant: ({ variant }) => {
        writeVariantToUrl(variant);
        return [{ ...model, variant }, []];
      },
      SelectedIssue: ({ issueNumber }) => {
        const issue = selectedSeed(issueNumber);
        return [{
          ...model,
          selectedIssue: issueNumber,
          title: issue.title,
          draftTitle: issue.title,
          isClosed: issue.state === "closed",
          isEditing: false,
          conflict: "none",
          notice: `Prefetched #${issueNumber} · no blocking network read`,
        }, []];
      },
      StartedEdit: () => [{ ...model, isEditing: true, draftTitle: model.title, draftBody: model.body, conflict: "none" }, []],
      CancelledEdit: () => [{ ...model, isEditing: false, conflict: "none", draftTitle: model.title, draftBody: model.body }, []],
      ChangedTitle: ({ value }) => [{ ...model, draftTitle: value }, []],
      ChangedBody: ({ value }) => [{ ...model, draftBody: value }, []],
      SavedEdit: () => [{ ...model, title: model.draftTitle, body: model.draftBody, isEditing: false, sequence: model.sequence + 1, notice: "Saved revision 8 · change record applied" }, []],
      SimulatedConflict: () => [{ ...model, conflict: "shown", isEditing: true, draftTitle: `${model.title} — my edit`, notice: "Revision conflict · server returned current Issue" }, []],
      KeptMine: () => [{ ...model, title: model.draftTitle, conflict: "none", isEditing: false, sequence: model.sequence + 2, notice: "Rebased your edit onto revision 9" }, []],
      AcceptedTheirs: () => [{ ...model, title: "Prototype the focused issue workspace", draftTitle: "Prototype the focused issue workspace", conflict: "none", isEditing: false, sequence: model.sequence + 1, notice: "Accepted the current server revision" }, []],
      ToggledClosed: () => [{ ...model, isClosed: !model.isClosed, sequence: model.sequence + 1, notice: model.isClosed ? "Issue reopened" : "Issue closed despite open downstream work" }, []],
      ToggledClaim: () => [{ ...model, isClaimed: !model.isClaimed, sequence: model.sequence + 1, notice: model.isClaimed ? "Claim released" : "Claimed as pi/session_01JQ…" }, []],
      ToggledLabel: () => [{ ...model, hasReadyLabel: !model.hasReadyLabel, sequence: model.sequence + 1, notice: model.hasReadyLabel ? "Removed ready-for-human" : "Added ready-for-human" }, []],
      ChangedComment: ({ value }) => [{ ...model, commentDraft: value }, []],
      AddedComment: () => [{ ...model, commentDraft: "", commentCount: model.commentCount + 1, sequence: model.sequence + 1, notice: "Comment published as You" }, []],
      AdvancedAttachment: () => {
        const attachment = model.attachment === "none" ? "uploading" : model.attachment === "uploading" ? "ready" : "none";
        const notice = attachment === "uploading" ? "Uploading interface-review.mp4 · 42%" : attachment === "ready" ? "Upload ready · Markdown snippet inserted" : "Attachment removed from draft";
        return [{ ...model, attachment, notice }, []];
      },
      RequestedDelete: () => [{ ...model, deletePrompt: true }, []],
      CancelledDelete: () => [{ ...model, deletePrompt: false }, []],
      ConfirmedDelete: () => [{ ...model, deletePrompt: false, isDeleted: true, sequence: model.sequence + 1, notice: "Issue moved to a reversible tombstone" }, []],
      RestoredIssue: () => [{ ...model, isDeleted: false, sequence: model.sequence + 1, notice: "Issue restored with graph relations intact" }, []],
      SimulatedRealtime: () => [{ ...model, title: "Prototype the issue-focused human interface", draftTitle: "Prototype the issue-focused human interface", sequence: model.sequence + 1, notice: `Live change ${model.sequence + 1} applied · agent edited title` }, []],
      ToggledConnection: () => {
        const connection = model.connection === "live" ? "reconnecting" : model.connection === "reconnecting" ? "stale" : "live";
        const notice = connection === "live" ? "Caught up through the Project change stream" : connection === "reconnecting" ? "Socket reconnecting · polling every 5 seconds" : "Showing cached data · 2 records behind";
        return [{ ...model, connection, notice }, []];
      },
    }),
  );
}

function button(
  h: ReturnType<typeof html<PrototypeMessage>>,
  className: string,
  label: string,
  message: PrototypeMessage,
  title?: string,
): Html {
  return Button.view<PrototypeMessage>({
    onClick: message,
    toView: (attributes) => h.button([
      ...attributes.button,
      h.Class(className),
      ...(title === undefined ? [] : [h.Title(title)]),
    ], [label]),
  });
}

function iconButton(
  h: ReturnType<typeof html<PrototypeMessage>>,
  label: string,
  icon: string,
  message: PrototypeMessage,
): Html {
  return button(h, "icon-button", icon, message, label);
}

function stateIcon(state: "open" | "closed"): string {
  return state === "open" ? "◉" : "✓";
}

function issueList(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, mode: "rail" | "cards" | "console"): Html {
  return h.div([h.Class(`issue-list issue-list--${mode}`)], issues.map((issue) => {
    const selected = issue.number === model.selectedIssue;
    return Button.view<PrototypeMessage>({
      onClick: SelectedIssue({ issueNumber: issue.number }),
      toView: (attributes) => h.button([
        ...attributes.button,
        h.Class(`issue-row${selected ? " is-selected" : ""}`),
        h.DataAttribute("issue-number", String(issue.number)),
      ], [
        h.span([h.Class(`state-icon state-icon--${issue.state}`)], [stateIcon(issue.state)]),
        h.span([h.Class("issue-row__copy")], [
          h.strong([], [issue.title]),
          h.small([], [`#${issue.number} · ${issue.label}`]),
          mode !== "rail" ? h.em([], [issue.relation]) : h.empty,
        ]),
        h.time([], [issue.updated]),
      ]),
    });
  }));
}

function connectionPill(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return Button.view<PrototypeMessage>({
    onClick: ToggledConnection(),
    toView: (attributes) => h.button([
      ...attributes.button,
      h.Class(`connection connection--${model.connection}`),
    ], [model.connection === "live" ? "● Live" : model.connection === "reconnecting" ? "◌ Reconnecting" : "◐ Cached · stale"]),
  });
}

function topbar(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, compact = false): Html {
  return h.header([h.Class(`topbar${compact ? " topbar--compact" : ""}`)], [
    h.div([h.Class("brand")], [h.span([h.Class("brand-mark")], ["O"]), h.strong([], ["Overseer"])]),
    h.div([h.Class("crumbs")], [
      h.span([], ["Personal"]), h.b([], ["/"]), h.span([], ["Overseer"]),
      h.b([], ["/"]), h.strong([], [`#${model.selectedIssue}`]),
    ]),
    h.div([h.Class("topbar-actions")], [
      h.span([h.Class("shortcut")], ["⌘ K"]),
      connectionPill(h, model),
      h.span([h.Class("avatar")], ["D"]),
    ]),
  ]);
}

function labelChip(h: ReturnType<typeof html<PrototypeMessage>>, text: string, className = ""): Html {
  return h.span([h.Class(`label-chip ${className}`)], [text]);
}

function metadata(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, layout: "rail" | "ribbon" | "console"): Html {
  const value = (label: string, content: Html | string) => h.div([h.Class("meta-field")], [h.dt([], [label]), h.dd([], [content])]);
  return h.dl([h.Class(`metadata metadata--${layout}`)], [
    value("Assignee", button(h, "text-action", model.isClaimed ? "pi/session_01JQ…" : "Unclaimed", ToggledClaim())),
    value("Labels", h.div([h.Class("chip-stack")], [
      labelChip(h, "wayfinder:prototype", "label--violet"),
      model.hasReadyLabel ? labelChip(h, "ready-for-human", "label--green") : h.empty,
      button(h, "chip-add", model.hasReadyLabel ? "−" : "+", ToggledLabel()),
    ])),
    value("Parent", h.a([h.Href("#10")], ["#10 Specify Overseer's MVP"])),
    value("Blocking", h.a([h.Href("#24")], ["#24 Lock the MVP specification"])),
    value("Revision", `8 · sequence ${model.sequence}`),
  ]);
}

function titleBlock(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, layout: "workbench" | "paper" | "console"): Html {
  return h.header([h.Class(`issue-title issue-title--${layout}`)], [
    h.div([h.Class("eyebrow")], [
      h.span([h.Class(model.isClosed ? "state-badge state-badge--closed" : "state-badge")], [model.isClosed ? "✓ Closed" : "◉ Open"]),
      h.span([], [`Issue #${model.selectedIssue}`]),
      h.span([], ["in Overseer"]),
    ]),
    h.h1([], [model.title]),
    h.p([h.Class("byline")], ["Opened by You · 14 minutes ago · ", h.strong([], [model.isClaimed ? "claimed by pi/session_01JQ…" : "unclaimed"])]),
  ]);
}

function issueActions(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, layout: "row" | "stack" | "console"): Html {
  return h.div([h.Class(`issue-actions issue-actions--${layout}`)], [
    button(h, "action action--primary", model.isEditing ? "Editing…" : "Edit", StartedEdit()),
    button(h, "action", model.isClosed ? "Reopen" : "Close", ToggledClosed()),
    button(h, "action", model.isClaimed ? "Release claim" : "Claim", ToggledClaim()),
    button(h, "action", "Test conflict", SimulatedConflict()),
    button(h, "action action--danger", "Delete", RequestedDelete()),
  ]);
}

function editor(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  if (!model.isEditing) {
    return h.section([h.Class("markdown-body")], [
      h.p([], [model.body]),
      h.h3([], ["Completion proof"]),
      h.ul([], [
        h.li([], ["Attach screenshots for each direction"]),
        h.li([], ["Record the chosen interaction flow in the browser"]),
        h.li([], ["Capture the resulting interface decision, not production code"]),
      ]),
    ]);
  }
  return h.section([h.Class("editor")], [
    Input.view<PrototypeMessage>({
      id: "issue-title",
      value: model.draftTitle,
      onInput: (value) => ChangedTitle({ value }),
      toView: (attributes) => h.div([h.Class("field")], [
        h.label(attributes.label, ["Title"]),
        h.input([...attributes.input, h.Class("title-input")]),
      ]),
    }),
    Textarea.view<PrototypeMessage>({
      id: "issue-body",
      value: model.draftBody,
      rows: 8,
      onInput: (value) => ChangedBody({ value }),
      toView: (attributes) => h.div([h.Class("field")], [
        h.label(attributes.label, ["Body · Markdown"]),
        h.textarea([...attributes.textarea, h.Class("body-input")], []),
      ]),
    }),
    model.conflict === "shown" ? conflictPanel(h) : h.div([h.Class("editor-actions")], [
      button(h, "action", "Cancel", CancelledEdit()),
      button(h, "action action--primary", "Save revision 8", SavedEdit()),
    ]),
  ]);
}

function conflictPanel(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.div([h.Class("conflict-panel")], [
    h.div([h.Class("conflict-panel__heading")], [h.strong([], ["Your edit met a newer revision"]), h.span([], ["409 · expected 8, current 9"])]),
    h.div([h.Class("conflict-grid")], [
      h.div([], [h.small([], ["Your draft"]), h.p([], ["Prototype the issue-centric human interface — my edit"])]),
      h.div([], [h.small([], ["Current server value · changed by pi/session_88K"]), h.p([], ["Prototype the focused issue workspace"])]),
    ]),
    h.div([h.Class("editor-actions")], [
      button(h, "action", "Use current", AcceptedTheirs()),
      button(h, "action action--primary", "Rebase & save mine", KeptMine()),
    ]),
  ]);
}

function graph(h: ReturnType<typeof html<PrototypeMessage>>, compact = false): Html {
  return h.section([h.Class(`graph${compact ? " graph--compact" : ""}`)], [
    h.div([h.Class("section-heading")], [h.h2([], ["Relations"]), h.span([], ["Same-project graph"])]),
    h.div([h.Class("graph-flow")], [
      h.a([h.Class("graph-node graph-node--map"), h.Href("#10")], [h.small([], ["Parent"]), h.strong([], ["#10 MVP map"])]),
      h.span([h.Class("graph-arrow")], ["→"]),
      h.div([h.Class("graph-node graph-node--current")], [h.small([], ["Current"]), h.strong([], ["#23 Interface"])]),
      h.span([h.Class("graph-arrow")], ["→"]),
      h.a([h.Class("graph-node graph-node--blocked"), h.Href("#24")], [h.small([], ["Blocks"]), h.strong([], ["#24 Lock spec"])]),
    ]),
    h.div([h.Class("subissue-progress")], [h.span([], ["Map progress"]), h.progress([h.Max("18"), h.Value("15")], []), h.strong([], ["15 / 18"])]),
  ]);
}

function timeline(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, mode: "cards" | "paper" | "stream"): Html {
  const event = (icon: string, actor: string, text: string, time: string, detail?: string) => h.article([h.Class("timeline-item")], [
    h.span([h.Class("timeline-icon")], [icon]),
    h.div([h.Class("timeline-copy")], [
      h.p([], [h.strong([], [actor]), ` ${text}`]),
      detail === undefined ? h.empty : h.blockquote([], [detail]),
      h.time([], [time]),
    ]),
  ]);
  return h.section([h.Class(`timeline timeline--${mode}`)], [
    h.div([h.Class("section-heading")], [h.h2([], [`Timeline · ${model.commentCount + 6}`]), button(h, "text-action", "Oldest first", SimulatedRealtime())]),
    event("＋", "You", "created this Issue", "14 minutes ago"),
    event("⌁", "You", "added parent #10 and made this Issue block #24", "13 minutes ago"),
    event("◎", "pi/session_01JQ…", "claimed this Issue", "12 minutes ago", "I’m exploring three interface directions using the actual Foldkit runtime."),
    event("✎", "pi/session_01JQ…", "edited the body", "9 minutes ago", "Added browser screenshots and video as completion proof."),
    event("●", "You", "commented", "4 minutes ago", "Prioritize steering clarity over GitHub feature parity. I should understand the frontier at a glance."),
    model.commentCount > 2 ? event("●", "You", "commented", "just now", "The chosen direction should keep issue content primary and graph state visible.") : h.empty,
    model.notice.startsWith("Live change") ? event("↻", "pi/session_88K", "edited the title via Project change record", "just now") : h.empty,
  ]);
}

function composer(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, compact = false): Html {
  const attachmentText = model.attachment === "none" ? "+ Attach file" : model.attachment === "uploading" ? "◌ interface-review.mp4 · 42%" : "✓ interface-review.mp4 · ready";
  return h.section([h.Class(`composer${compact ? " composer--compact" : ""}`)], [
    h.div([h.Class("composer-avatar")], ["D"]),
    h.div([h.Class("composer-main")], [
      Textarea.view<PrototypeMessage>({
        id: `new-comment-${compact ? "compact" : "full"}`,
        value: model.commentDraft,
        rows: compact ? 2 : 4,
        placeholder: "Leave a comment… Markdown supported",
        onInput: (value) => ChangedComment({ value }),
        toView: (attributes) => h.div([h.Class("field field--comment")], [
          h.label([...attributes.label, h.Class("sr-only")], ["Comment"]),
          h.textarea([...attributes.textarea, h.Class("comment-input")], []),
        ]),
      }),
      h.div([h.Class("composer-actions")], [
        button(h, `attachment-action attachment-action--${model.attachment}`, attachmentText, AdvancedAttachment()),
        h.span([], [model.attachment === "ready" ? "Snippet inserted into Markdown" : "Paste or drop supported"]),
        button(h, "action action--primary", "Comment", AddedComment()),
      ]),
    ]),
  ]);
}

function deleteOverlay(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  if (!model.deletePrompt) return h.empty;
  return h.div([h.Class("modal-backdrop")], [
    h.section([h.Class("confirm-dialog"), h.Role("dialog"), h.AriaModal(true), h.AriaLabel("Delete Issue")], [
      h.span([h.Class("danger-icon")], ["!"]),
      h.h2([], ["Delete this Issue?"]),
      h.p([], ["It becomes a reversible, read-only tombstone. Sub-issues remain live and preserved relations reactivate on restore."]),
      h.div([h.Class("editor-actions")], [
        button(h, "action", "Cancel", CancelledDelete()),
        button(h, "action action--danger-solid", "Delete Issue", ConfirmedDelete()),
      ]),
    ]),
  ]);
}

function tombstone(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return h.main([h.Class("tombstone")], [
    topbar(h, model),
    h.section([], [
      h.span([h.Class("tombstone-icon")], ["⌫"]),
      h.p([h.Class("eyebrow")], [`Issue #${model.selectedIssue} · deleted just now`]),
      h.h1([], [model.title]),
      h.p([], ["This Issue is a read-only tombstone. Its number, history, sub-issue order, and graph relations are preserved."]),
      button(h, "action action--primary", "Restore Issue", RestoredIssue()),
    ]),
  ]);
}

function notice(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return h.div([h.Class("sync-notice"), h.AriaLive("polite")], [
    h.span([], [model.connection === "live" ? "✓" : "↻"]),
    h.p([], [model.notice]),
    button(h, "text-action", "Simulate incoming change", SimulatedRealtime()),
  ]);
}

function variantA(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  if (model.isDeleted) return tombstone(h, model);
  return h.div([h.Class("variant variant-a")], [
    topbar(h, model),
    h.div([h.Class("workbench")], [
      h.aside([h.Class("list-rail")], [
        h.div([h.Class("rail-heading")], [h.div([], [h.h2([], ["Issues"]), h.span([], ["8 shown · 3 open"])]), iconButton(h, "Create Issue", "+", SimulatedRealtime())]),
        h.div([h.Class("filters")], [labelChip(h, "Open 3", "filter-active"), labelChip(h, "Assigned to me"), labelChip(h, "All labels")]),
        issueList(h, model, "rail"),
      ]),
      h.main([h.Class("detail-pane")], [
        notice(h, model),
        h.div([h.Class("detail-heading")], [titleBlock(h, model, "workbench"), issueActions(h, model, "row")]),
        editor(h, model),
        graph(h),
        timeline(h, model, "cards"),
        composer(h, model),
      ]),
      h.aside([h.Class("metadata-rail")], [
        h.div([h.Class("metadata-rail__heading")], [h.h2([], ["Steer"]), h.span([], ["Everything agents can change"])]),
        metadata(h, model, "rail"),
        h.section([h.Class("quick-steer")], [
          h.h3([], ["Quick steering"]),
          button(h, "quick-command", model.isClaimed ? "Release current claim" : "Claim this Issue", ToggledClaim()),
          button(h, "quick-command", "Mark ready for human", ToggledLabel()),
          button(h, "quick-command", "Copy canonical link", SimulatedRealtime()),
        ]),
      ]),
    ]),
    deleteOverlay(h, model),
  ]);
}

function variantB(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  if (model.isDeleted) return tombstone(h, model);
  return h.div([h.Class("variant variant-b")], [
    topbar(h, model),
    h.div([h.Class("paper-shell")], [
      h.aside([h.Class("paper-index")], [
        h.div([h.Class("rail-heading")], [h.div([], [h.h2([], ["Project issues"]), h.span([], ["Recent and related"])]), iconButton(h, "Create Issue", "+", SimulatedRealtime())]),
        issueList(h, model, "cards"),
      ]),
      h.main([h.Class("paper")], [
        notice(h, model),
        titleBlock(h, model, "paper"),
        issueActions(h, model, "row"),
        metadata(h, model, "ribbon"),
        h.div([h.Class("paper-body")], [
          editor(h, model),
          graph(h),
          timeline(h, model, "paper"),
          composer(h, model),
        ]),
      ]),
    ]),
    deleteOverlay(h, model),
  ]);
}

function variantC(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  if (model.isDeleted) return tombstone(h, model);
  return h.div([h.Class("variant variant-c")], [
    topbar(h, model, true),
    h.main([h.Class("console-grid")], [
      h.aside([h.Class("console-queue")], [
        h.div([h.Class("console-label")], [h.span([], ["ISSUE QUEUE"]), h.kbd([], ["J / K"])]),
        issueList(h, model, "console"),
      ]),
      h.section([h.Class("console-focus")], [
        notice(h, model),
        titleBlock(h, model, "console"),
        h.div([h.Class("console-commandbar")], [
          issueActions(h, model, "console"),
          h.div([h.Class("command-hints")], [h.kbd([], ["E edit"]), h.kbd([], ["C close"]), h.kbd([], ["A claim"]), h.kbd([], ["⌘↵ comment"])]),
        ]),
        h.div([h.Class("console-focus__body")], [editor(h, model), graph(h, true)]),
        composer(h, model, true),
      ]),
      h.aside([h.Class("console-inspector")], [
        h.div([h.Class("console-label")], [h.span([], ["INSPECTOR"]), h.span([], [`SEQ ${model.sequence}`])]),
        metadata(h, model, "console"),
        timeline(h, model, "stream"),
      ]),
    ]),
    deleteOverlay(h, model),
  ]);
}

function switcher(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  const order: ReadonlyArray<Variant> = ["A", "B", "C"];
  const currentIndex = order.indexOf(model.variant);
  const previous = order[(currentIndex + order.length - 1) % order.length] ?? "A";
  const next = order[(currentIndex + 1) % order.length] ?? "A";
  return h.nav([h.Class("prototype-switcher"), h.AriaLabel("Prototype variants")], [
    iconButton(h, "Previous variant", "←", ChangedVariant({ variant: previous })),
    h.div([], [h.small([], ["PROTOTYPE DIRECTION"]), h.strong([], [`${model.variant} — ${variantNames[model.variant]}`])]),
    h.div([h.Class("variant-dots")], order.map((variant) => button(h, variant === model.variant ? "dot is-active" : "dot", variant, ChangedVariant({ variant })))),
    iconButton(h, "Next variant", "→", ChangedVariant({ variant: next })),
  ]);
}

function view(model: PrototypeModel): Html {
  const h = html<PrototypeMessage>();
  const active = model.variant === "A" ? variantA(h, model) : model.variant === "B" ? variantB(h, model) : variantC(h, model);
  return h.div([h.Class("prototype-root")], [
    active,
    import.meta.env.DEV ? switcher(h, model) : h.empty,
  ]);
}

function attachKeyboardSwitcher(): () => void {
  const listener = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches("input, textarea") || target.isContentEditable)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const selector = event.key === "ArrowLeft" ? '[title="Previous variant"]' : '[title="Next variant"]';
    document.querySelector<HTMLButtonElement>(`.prototype-switcher ${selector}`)?.click();
  };
  document.addEventListener("keydown", listener);
  return () => document.removeEventListener("keydown", listener);
}

/** Embed the throwaway issue-interface prototype. */
export function embedPrototype(container: HTMLElement): Readonly<{ dispose: () => void }> {
  const program = Runtime.makeElement({
    Model: PrototypeModel,
    init: () => [initialModel(), []],
    update,
    view,
    container,
    crash: { report: ({ error }) => console.error("Prototype crashed", error) },
    devTools: false,
    slow: false,
  });
  const handle = Runtime.embed(program);
  const detachKeyboard = attachKeyboardSwitcher();
  return {
    dispose: () => {
      detachKeyboard();
      handle.dispose();
    },
  };
}
