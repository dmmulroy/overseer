import { Button, Input } from "@foldkit/ui";
import { Match, Schema } from "effect";
import { Runtime, type Command } from "foldkit";
import { html, type Html } from "foldkit/html";
import { m } from "foldkit/message";

// PROTOTYPE — Three materially different mutation/recovery systems, switchable
// via ?variant=, on the throwaway /prototype/mutation-sync route. All variants
// use the chosen Utility theme and the same issue, mutations, and failure cases.

const VariantSchema = Schema.Union([
  Schema.Literal("A"),
  Schema.Literal("B"),
  Schema.Literal("C"),
]);
const ColorModeSchema = Schema.Union([
  Schema.Literal("light"),
  Schema.Literal("dark"),
]);
const ScenarioSchema = Schema.Union([
  Schema.Literal("steady"),
  Schema.Literal("editing"),
  Schema.Literal("conflict"),
  Schema.Literal("incoming"),
  Schema.Literal("reconnecting"),
  Schema.Literal("closed"),
  Schema.Literal("confirm-delete"),
  Schema.Literal("deleted"),
]);

const ChangedVariant = m("ChangedVariant", { variant: VariantSchema });
const ToggledColorMode = m("ToggledColorMode");
const SelectedScenario = m("SelectedScenario", { scenario: ScenarioSchema });
const ChangedDraftTitle = m("ChangedDraftTitle", { value: Schema.String });
const SavedDraft = m("SavedDraft");
const UsedMine = m("UsedMine");
const UsedCurrent = m("UsedCurrent");
const AppliedIncoming = m("AppliedIncoming");
const KeptEditing = m("KeptEditing");
const RetriedConnection = m("RetriedConnection");
const ClosedIssue = m("ClosedIssue");
const ReopenedIssue = m("ReopenedIssue");
const RequestedDelete = m("RequestedDelete");
const CancelledDelete = m("CancelledDelete");
const ConfirmedDelete = m("ConfirmedDelete");
const RestoredIssue = m("RestoredIssue");
const ClearedNotice = m("ClearedNotice");

const PrototypeMessage = Schema.Union([
  ChangedVariant,
  ToggledColorMode,
  SelectedScenario,
  ChangedDraftTitle,
  SavedDraft,
  UsedMine,
  UsedCurrent,
  AppliedIncoming,
  KeptEditing,
  RetriedConnection,
  ClosedIssue,
  ReopenedIssue,
  RequestedDelete,
  CancelledDelete,
  ConfirmedDelete,
  RestoredIssue,
  ClearedNotice,
]);
type PrototypeMessage = typeof PrototypeMessage.Type;

const PrototypeModel = Schema.Struct({
  variant: VariantSchema,
  colorMode: ColorModeSchema,
  scenario: ScenarioSchema,
  title: Schema.String,
  draftTitle: Schema.String,
  notice: Schema.String,
});
type PrototypeModel = typeof PrototypeModel.Type;
type Variant = PrototypeModel["variant"];
type Scenario = PrototypeModel["scenario"];
type ColorMode = PrototypeModel["colorMode"];

const originalTitle = "Preserve drafts during project cache repair";
const localTitle = "Keep drafts safe during reconnect and cache repair";
const incomingTitle = "Preserve issue and comment drafts during cache rebuild";
const currentTitle = "Preserve drafts when project history is rebuilt";

const variantNames: Readonly<Record<Variant, string>> = {
  A: "Inline continuity",
  B: "Change workspace",
  C: "Timeline recovery",
};

const scenarioNames: Readonly<Record<Scenario, string>> = {
  steady: "Steady",
  editing: "Edit",
  conflict: "Conflict",
  incoming: "Incoming",
  reconnecting: "Reconnect",
  closed: "Close / reopen",
  "confirm-delete": "Delete",
  deleted: "Restore",
};

function variantFromUrl(): Variant {
  const value = new URL(window.location.href).searchParams.get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function colorModeFromUrl(): ColorMode {
  return new URL(window.location.href).searchParams.get("mode") === "dark" ? "dark" : "light";
}

function scenarioFromUrl(): Scenario {
  const value = new URL(window.location.href).searchParams.get("state");
  const scenarios: ReadonlyArray<Scenario> = [
    "steady", "editing", "conflict", "incoming", "reconnecting", "closed", "confirm-delete", "deleted",
  ];
  return scenarios.includes(value as Scenario) ? value as Scenario : "steady";
}

function writeStateToUrl(variant: Variant, colorMode: ColorMode, scenario: Scenario): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/mutation-sync";
  url.searchParams.set("variant", variant);
  url.searchParams.set("mode", colorMode);
  url.searchParams.set("state", scenario);
  window.history.replaceState({}, "", url);
}

function initialModel(): PrototypeModel {
  const variant = variantFromUrl();
  const colorMode = colorModeFromUrl();
  const scenario = scenarioFromUrl();
  writeStateToUrl(variant, colorMode, scenario);
  return {
    variant,
    colorMode,
    scenario,
    title: originalTitle,
    draftTitle: localTitle,
    notice: "",
  };
}

function withScenario(model: PrototypeModel, scenario: Scenario, notice = ""): PrototypeModel {
  writeStateToUrl(model.variant, model.colorMode, scenario);
  return { ...model, scenario, notice };
}

function update(
  model: PrototypeModel,
  message: PrototypeMessage,
): readonly [PrototypeModel, ReadonlyArray<Command.Command<PrototypeMessage>>] {
  return Match.value(message).pipe(
    Match.withReturnType<readonly [PrototypeModel, ReadonlyArray<Command.Command<PrototypeMessage>>]>(),
    Match.tagsExhaustive({
      ChangedVariant: ({ variant }) => {
        writeStateToUrl(variant, model.colorMode, model.scenario);
        return [{ ...model, variant }, []];
      },
      ToggledColorMode: () => {
        const colorMode = model.colorMode === "light" ? "dark" : "light";
        writeStateToUrl(model.variant, colorMode, model.scenario);
        return [{ ...model, colorMode }, []];
      },
      SelectedScenario: ({ scenario }) => [withScenario({ ...model, draftTitle: localTitle }, scenario), []],
      ChangedDraftTitle: ({ value }) => [{ ...model, draftTitle: value }, []],
      SavedDraft: () => [withScenario({ ...model, title: model.draftTitle }, "steady", "Saved as revision 19."), []],
      UsedMine: () => [withScenario({ ...model, title: model.draftTitle }, "steady", "Your version was saved as revision 20."), []],
      UsedCurrent: () => [withScenario({ ...model, title: currentTitle, draftTitle: currentTitle }, "steady", "Current version kept. Your draft was discarded."), []],
      AppliedIncoming: () => [withScenario({ ...model, title: incomingTitle, draftTitle: incomingTitle }, "steady", "Updated to revision 19."), []],
      KeptEditing: () => [withScenario(model, "editing", "Incoming revision 19 is held while you finish."), []],
      RetriedConnection: () => [withScenario(model, "steady", "Caught up through project change 8,241."), []],
      ClosedIssue: () => [withScenario(model, "closed", "Issue closed. Reopen is always available."), []],
      ReopenedIssue: () => [withScenario(model, "steady", "Issue reopened."), []],
      RequestedDelete: () => [withScenario(model, "confirm-delete"), []],
      CancelledDelete: () => [withScenario(model, "steady"), []],
      ConfirmedDelete: () => [withScenario(model, "deleted", "Issue deleted. Its number and history are preserved."), []],
      RestoredIssue: () => [withScenario(model, "steady", "Issue restored with its history and relationships."), []],
      ClearedNotice: () => [{ ...model, notice: "" }, []],
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

function icon(h: ReturnType<typeof html<PrototypeMessage>>, value: string, className = "icon"): Html {
  return h.span([h.Class(className), h.AriaHidden(true)], [value]);
}

function appHeader(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  const reconnecting = model.scenario === "reconnecting";
  return h.header([h.Class("app-header")], [
    h.div([h.Class("brand")], [h.span([h.Class("brand-mark")], ["O"]), h.strong([], ["Overseer"])]),
    h.nav([h.Class("breadcrumbs"), h.AriaLabel("Breadcrumb")], [
      h.span([], ["Personal"]), h.i([], ["/"]), h.span([], ["Overseer"]), h.i([], ["/"]), h.strong([], ["#57"]),
    ]),
    h.div([h.Class("header-search")], [icon(h, "⌕"), h.span([], ["Search issues"]), h.kbd([], ["⌘K"])]),
    h.div([h.Class("header-tools")], [
      h.span([h.Class(reconnecting ? "sync-pill is-reconnecting" : "sync-pill")], [
        icon(h, reconnecting ? "↻" : "●"), reconnecting ? " Reconnecting" : " Live",
      ]),
      h.span([h.Class("avatar")], ["DM"]),
    ]),
  ]);
}

const issueRows = [
  [57, "Preserve drafts during project cache repair", "reliability"],
  [55, "Retry missing project change records", "realtime"],
  [52, "Keep issue filters after refresh", "frontend"],
  [48, "Expose the current project sequence", "api"],
] as const;

function issueNavigation(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return h.aside([h.Class("issue-navigation")], [
    h.header([h.Class("nav-heading")], [
      h.div([], [h.h2([], ["Issues"]), h.p([], ["Overseer · 4 open"])]),
      h.button([h.Class("icon-button"), h.Type("button")], ["+"]),
    ]),
    h.div([h.Class("filters")], [
      h.span([h.Class("filter is-active")], ["Open 4"]), h.span([h.Class("filter")], ["Assigned"]), h.span([h.Class("filter")], ["All labels"]),
    ]),
    h.div([h.Class("issue-list")], issueRows.map(([number, title, label]) => h.button([
      h.Class(number === 57 ? "issue-row is-selected" : "issue-row"), h.Type("button"),
    ], [
      h.span([h.Class(number === 57 && model.scenario === "closed" ? "issue-state is-closed" : "issue-state")], [number === 57 && model.scenario === "closed" ? "✓" : "●"]),
      h.span([h.Class("issue-row-copy")], [h.strong([], [number === 57 ? model.title : title]), h.small([], [`#${number}  ·  ${label}`])]),
      h.time([], [number === 57 ? "now" : "2h"]),
    ]))),
    h.footer([h.Class("nav-footer")], [h.span([], ["4 issues"]), h.button([h.Class("link-button"), h.Type("button")], ["View deleted"])]),
  ]);
}

function scenarioBar(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  const scenarios: ReadonlyArray<Scenario> = ["steady", "editing", "conflict", "incoming", "reconnecting", "closed", "confirm-delete", "deleted"];
  return h.section([h.Class("scenario-bar"), h.AriaLabel("Prototype states")], [
    h.div([h.Class("scenario-label")], [h.small([], ["INTERACTION STATE"]), h.strong([], [scenarioNames[model.scenario]])]),
    h.div([h.Class("scenario-options")], scenarios.map((scenario) => button(
      h,
      scenario === model.scenario ? "scenario-option is-active" : "scenario-option",
      scenarioNames[scenario],
      SelectedScenario({ scenario }),
    ))),
  ]);
}

function titleEditor(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, id: string): Html {
  return Input.view<PrototypeMessage>({
    id,
    value: model.draftTitle,
    onInput: (value) => ChangedDraftTitle({ value }),
    toView: (attributes) => h.div([h.Class("title-editor")], [
      h.label([...attributes.label], ["Title"]),
      h.input([...attributes.input, h.Class("title-input")]),
    ]),
  });
}

function statusBadge(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  const closed = model.scenario === "closed";
  return h.span([h.Class(closed ? "status-badge is-closed" : "status-badge")], [closed ? "✓ Closed" : "● Open"]);
}

function issueCopy(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.div([h.Class("issue-copy")], [
    h.p([], ["When the local project cache has to be rebuilt, keep unsent issue and comment drafts separate so recovery never discards someone’s work."]),
    h.h2([], ["Expected behavior"]),
    h.ul([], [
      h.li([], ["Keep drafts available while cached project data is replaced."]),
      h.li([], ["Show whether each change is local, saved, or waiting for review."]),
      h.li([], ["Never queue issue mutations while the connection is unavailable."]),
    ]),
  ]);
}

function compactMeta(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.aside([h.Class("metadata")], [
    h.div([], [h.small([], ["ASSIGNEE"]), h.strong([], ["pi/sync-recovery"])]),
    h.div([], [h.small([], ["LABELS"]), h.span([h.Class("label-chip")], ["reliability"]), h.span([h.Class("label-chip")], ["frontend"])]),
    h.div([], [h.small([], ["REVISION"]), h.strong([], ["18"])]),
  ]);
}

function conflictCompare(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, compact = false): Html {
  return h.section([h.Class(compact ? "conflict-card is-compact" : "conflict-card")], [
    h.header([], [icon(h, "!", "alert-icon"), h.div([], [h.h2([], ["This issue changed before your edit was saved"]), h.p([], ["pi/cache-repair saved revision 19 a few seconds ago. Choose the title to keep."])])]),
    h.div([h.Class("compare-grid")], [
      h.div([h.Class("compare-version is-yours")], [h.small([], ["YOUR UNSAVED EDIT"]), h.strong([], [model.draftTitle]), h.span([], ["Based on revision 18"])]),
      h.div([h.Class("compare-version")], [h.small([], ["CURRENT · REVISION 19"]), h.strong([], [currentTitle]), h.span([], ["Changed by pi/cache-repair"])]),
    ]),
    h.footer([], [
      button(h, "button button--quiet", "Keep current", UsedCurrent()),
      button(h, "button button--primary", "Save my version", UsedMine()),
    ]),
  ]);
}

function incomingNotice(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return h.section([h.Class("incoming-card")], [
    h.div([], [icon(h, "↓", "incoming-icon"), h.div([], [h.strong([], ["A newer revision arrived"]), h.p([], ["pi/cache-repair changed the title while your edit is open."])])]),
    h.div([h.Class("incoming-diff")], [h.del([], [model.title]), h.ins([], [incomingTitle])]),
    h.footer([], [
      button(h, "button button--quiet", "Keep editing", KeptEditing()),
      button(h, "button button--primary", "Use incoming version", AppliedIncoming()),
    ]),
  ]);
}

function reconnectNotice(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.section([h.Class("reconnect-card")], [
    h.div([], [icon(h, "↻", "reconnect-icon"), h.div([], [
      h.strong([], ["Reconnecting to Overseer"]),
      h.p([], ["Showing saved data from this device. Drafts are safe, but new changes cannot be saved yet."]),
    ])]),
    h.div([h.Class("retry-row")], [h.span([], ["Last caught up 14 seconds ago · retry 3 of 8"]), button(h, "button button--quiet", "Retry now", RetriedConnection())]),
  ]);
}

function noticeToast(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return model.notice === "" ? h.empty : h.div([h.Class("notice-toast")], [
    icon(h, "✓"), h.span([], [model.notice]), button(h, "toast-close", "×", ClearedNotice(), "Dismiss"),
  ]);
}

function deleteDialog(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.div([h.Class("dialog-backdrop")], [
    h.section([h.Class("delete-dialog"), h.AriaLabel("Delete issue")], [
      icon(h, "!", "danger-icon"),
      h.h2([], ["Delete issue #57?"]),
      h.p([], ["It will disappear from issue lists, but its number, history, comments, and relationships will be kept. You can restore it from deleted issues."]),
      h.div([h.Class("dialog-summary")], [h.strong([], ["Preserve drafts during project cache repair"]), h.span([], ["Revision 18 · 3 comments · 2 relationships"])]),
      h.footer([], [button(h, "button button--quiet", "Cancel", CancelledDelete()), button(h, "button button--danger", "Delete issue", ConfirmedDelete())]),
    ]),
  ]);
}

function deletedIssue(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.section([h.Class("deleted-state")], [
    icon(h, "⌫", "deleted-icon"),
    h.small([], ["DELETED ISSUE #57"]),
    h.h1([], ["Preserve drafts during project cache repair"]),
    h.p([], ["Deleted by you just now. Its comments, timeline, issue number, and relationships are preserved but read-only."]),
    h.div([], [button(h, "button button--primary", "Restore issue", RestoredIssue()), h.button([h.Class("button button--quiet"), h.Type("button")], ["Back to issues"])]),
  ]);
}

function timelineRows(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  const dynamic = model.scenario === "closed"
    ? h.article([h.Class("timeline-row is-success")], [icon(h, "✓"), h.p([], [h.strong([], ["You"]), " closed this issue", h.time([], ["just now"])])])
    : model.scenario === "reconnecting"
      ? h.article([h.Class("timeline-row is-pending")], [icon(h, "↻"), h.p([], [h.strong([], ["Connection interrupted"]), " · timeline may be out of date", h.time([], ["14 seconds ago"])])])
      : model.scenario === "incoming"
        ? h.article([h.Class("timeline-row is-incoming")], [icon(h, "↓"), h.p([], [h.strong([], ["pi/cache-repair"]), " edited the title in revision 19", h.time([], ["just now"])])])
        : h.empty;
  return h.section([h.Class("timeline")], [
    h.header([], [h.h2([], ["Timeline"]), h.button([h.Class("link-button"), h.Type("button")], ["Newest first"])]),
    dynamic,
    h.article([h.Class("timeline-row")], [icon(h, "●"), h.p([], [h.strong([], ["pi/sync-recovery"]), " commented", h.time([], ["18 minutes ago"]), h.blockquote([], ["I can reproduce the loss only when a sequence gap forces the project cache to rebuild."])])]),
    h.article([h.Class("timeline-row")], [icon(h, "◎"), h.p([], [h.strong([], ["pi/sync-recovery"]), " claimed this issue", h.time([], ["42 minutes ago"])])]),
    h.article([h.Class("timeline-row")], [icon(h, "+"), h.p([], [h.strong([], ["You"]), " opened this issue", h.time([], ["yesterday"])] )]),
  ]);
}

function issueHeading(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel, actions: Html): Html {
  return h.header([h.Class("issue-heading")], [
    h.div([h.Class("issue-kicker")], [statusBadge(h, model), h.span([], ["Issue #57"]), h.span([], ["updated just now"])]),
    h.div([h.Class("title-row")], [h.h1([], [model.title]), actions]),
    h.p([], ["Opened by you yesterday · ", h.strong([], ["pi/sync-recovery"]), " is working on it"]),
  ]);
}

function inlineActions(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return h.div([h.Class("issue-actions")], [
    model.scenario === "closed"
      ? button(h, "button button--primary", "Reopen", ReopenedIssue())
      : button(h, "button button--quiet", "Close", ClosedIssue()),
    button(h, "button button--primary", "Edit", SelectedScenario({ scenario: "editing" })),
    button(h, "icon-button", "•••", RequestedDelete(), "More actions: delete issue"),
  ]);
}

function variantInline(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  if (model.scenario === "deleted") return h.main([h.Class("detail-panel variant-detail-a")], [deletedIssue(h)]);
  const editing = model.scenario === "editing" || model.scenario === "conflict" || model.scenario === "incoming";
  return h.main([h.Class("detail-panel variant-detail-a")], [
    model.scenario === "reconnecting" ? reconnectNotice(h) : h.empty,
    h.div([h.Class("detail-padding")], [
      editing
        ? h.section([h.Class("inline-editor")], [
            h.header([], [h.div([], [h.small([], ["EDITING ISSUE #57"]), h.span([h.Class("save-state")], ["● Draft saved on this device"])]), h.button([h.Class("link-button"), h.Type("button")], ["Cancel"])]),
            titleEditor(h, model, "inline-title"),
            h.div([h.Class("body-editor")], [h.label([], ["Description"]), h.div([], ["When the local project cache has to be rebuilt, keep unsent issue and comment drafts separate so recovery never discards someone’s work."])]),
            model.scenario === "conflict" ? conflictCompare(h, model) : h.empty,
            model.scenario === "incoming" ? incomingNotice(h, model) : h.empty,
            h.footer([], [h.span([], ["Based on revision 18"]), button(h, "button button--primary", "Save changes", SavedDraft())]),
          ])
        : issueHeading(h, model, inlineActions(h, model)),
      h.div([h.Class("content-grid")], [
        h.div([], [issueCopy(h), timelineRows(h, model)]),
        compactMeta(h),
      ]),
    ]),
    model.scenario === "confirm-delete" ? deleteDialog(h) : h.empty,
    noticeToast(h, model),
  ]);
}

function workspacePanel(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  const scenario = model.scenario;
  return h.aside([h.Class("change-workspace")], [
    h.header([], [h.div([], [h.small([], ["CHANGE WORKSPACE"]), h.h2([], [scenario === "steady" ? "No local changes" : scenarioNames[scenario]])]), h.span([h.Class("workspace-count")], [scenario === "steady" ? "0" : "1"])]),
    scenario === "steady" ? h.div([h.Class("workspace-empty")], [icon(h, "✓"), h.strong([], ["Everything is saved"]), h.p([], ["Edits and recovery actions will appear here without covering the issue."]), button(h, "button button--primary", "Edit issue", SelectedScenario({ scenario: "editing" }))]) : h.empty,
    scenario === "editing" ? h.div([h.Class("workspace-section")], [
      h.div([h.Class("workspace-status")], [h.span([], ["LOCAL DRAFT"]), h.strong([], ["Saved on this device"])]),
      titleEditor(h, model, "workspace-title"),
      h.div([h.Class("base-revision")], [h.small([], ["BASE · REVISION 18"]), h.p([], [model.title])]),
      h.footer([], [h.button([h.Class("button button--quiet"), h.Type("button")], ["Discard"]), button(h, "button button--primary", "Save", SavedDraft())]),
    ]) : h.empty,
    scenario === "conflict" ? conflictCompare(h, model, true) : h.empty,
    scenario === "incoming" ? incomingNotice(h, model) : h.empty,
    scenario === "reconnecting" ? h.div([h.Class("workspace-section")], [reconnectNotice(h)]) : h.empty,
    scenario === "closed" ? h.div([h.Class("workspace-section lifecycle-choice")], [icon(h, "✓"), h.strong([], ["Issue closed"]), h.p([], ["Closed just now. This did not affect its sub-issues or blockers."]), button(h, "button button--primary", "Reopen issue", ReopenedIssue())]) : h.empty,
    scenario === "confirm-delete" ? h.div([h.Class("workspace-section delete-choice")], [icon(h, "!", "danger-icon"), h.h2([], ["Delete issue #57?"]), h.p([], ["The issue becomes a read-only tombstone. You can restore it later with its history and relationships intact."]), h.footer([], [button(h, "button button--quiet", "Cancel", CancelledDelete()), button(h, "button button--danger", "Delete", ConfirmedDelete())])]) : h.empty,
    scenario === "deleted" ? h.div([h.Class("workspace-section lifecycle-choice")], [icon(h, "⌫"), h.strong([], ["Issue is deleted"]), h.p([], ["Hidden from default lists. Number #57 is never reused."]), button(h, "button button--primary", "Restore issue", RestoredIssue())]) : h.empty,
    h.footer([h.Class("workspace-footer")], [h.span([], ["Drafts stay local until saved"]), h.span([], ["Revision 18"])]),
  ]);
}

function variantWorkspace(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return h.main([h.Class("detail-panel variant-detail-b")], [
    h.div([h.Class("workspace-layout")], [
      h.div([h.Class(model.scenario === "deleted" ? "canonical-pane is-tombstone" : "canonical-pane")], [
        model.scenario === "reconnecting" ? h.div([h.Class("canonical-stale")], ["Saved view · last caught up 14 seconds ago"]) : h.empty,
        issueHeading(h, model, h.div([h.Class("issue-actions")], [
          button(h, "button button--quiet", model.scenario === "closed" ? "Closed" : "Close", ClosedIssue()),
          button(h, "button button--primary", "Edit", SelectedScenario({ scenario: "editing" })),
          button(h, "icon-button", "•••", RequestedDelete(), "Delete issue"),
        ])),
        issueCopy(h),
        timelineRows(h, model),
        model.scenario === "deleted" ? h.div([h.Class("tombstone-overlay")], [h.strong([], ["Deleted issue"]), h.span([], ["Read-only until restored"])] ) : h.empty,
      ]),
      workspacePanel(h, model),
    ]),
    noticeToast(h, model),
  ]);
}

function recoveryEvent(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  if (model.scenario === "steady") return h.empty;
  if (model.scenario === "editing") return h.article([h.Class("mutation-event is-local")], [
    h.div([h.Class("event-rail")], [icon(h, "✎")]),
    h.div([h.Class("event-card")], [
      h.header([], [h.div([], [h.small([], ["LOCAL CHANGE"]), h.h2([], ["Editing issue title"])]), h.span([h.Class("event-state")], ["Draft"])]),
      titleEditor(h, model, "timeline-title"),
      h.p([], ["This draft is saved on this device and is not visible to anyone else."]),
      h.footer([], [h.span([], ["Based on revision 18"]), button(h, "button button--primary", "Save change", SavedDraft())]),
    ]),
  ]);
  if (model.scenario === "conflict") return h.article([h.Class("mutation-event is-blocked")], [
    h.div([h.Class("event-rail")], [icon(h, "!")]),
    h.div([h.Class("event-card")], [h.small([], ["CHANGE NEEDS ATTENTION"]), conflictCompare(h, model, true)]),
  ]);
  if (model.scenario === "incoming") return h.article([h.Class("mutation-event is-incoming")], [
    h.div([h.Class("event-rail")], [icon(h, "↓")]),
    h.div([h.Class("event-card")], [h.small([], ["INCOMING · REVISION 19"]), incomingNotice(h, model)]),
  ]);
  if (model.scenario === "reconnecting") return h.article([h.Class("mutation-event is-blocked")], [
    h.div([h.Class("event-rail")], [icon(h, "↻")]),
    h.div([h.Class("event-card")], [h.small([], ["CONNECTION"]), reconnectNotice(h)]),
  ]);
  if (model.scenario === "closed") return h.article([h.Class("mutation-event is-done")], [
    h.div([h.Class("event-rail")], [icon(h, "✓")]),
    h.div([h.Class("event-card lifecycle-event")], [h.small([], ["JUST NOW"]), h.h2([], ["You closed this issue"]), h.p([], ["Open sub-issues and blockers were not changed."]), button(h, "button button--quiet", "Reopen", ReopenedIssue())]),
  ]);
  if (model.scenario === "confirm-delete") return h.article([h.Class("mutation-event is-danger")], [
    h.div([h.Class("event-rail")], [icon(h, "!")]),
    h.div([h.Class("event-card lifecycle-event")], [h.small([], ["DESTRUCTIVE ACTION"]), h.h2([], ["Delete issue #57?"]), h.p([], ["It will be hidden and read-only, not erased. Its number and history remain restorable."]), h.footer([], [button(h, "button button--quiet", "Cancel", CancelledDelete()), button(h, "button button--danger", "Delete issue", ConfirmedDelete())])]),
  ]);
  return h.article([h.Class("mutation-event is-danger")], [
    h.div([h.Class("event-rail")], [icon(h, "⌫")]),
    h.div([h.Class("event-card lifecycle-event")], [h.small([], ["DELETED JUST NOW"]), h.h2([], ["Issue #57 is a tombstone"]), h.p([], ["Comments, timeline events, relationships, and revision history are preserved."]), button(h, "button button--primary", "Restore issue", RestoredIssue())]),
  ]);
}

function variantTimeline(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return h.main([h.Class("detail-panel variant-detail-c")], [
    h.div([h.Class("timeline-layout")], [
      h.header([h.Class("timeline-issue-summary")], [
        h.div([], [h.div([h.Class("issue-kicker")], [statusBadge(h, model), h.span([], ["Issue #57 · revision 18"])]), h.h1([], [model.title]), h.p([], ["Opened by you · assigned to pi/sync-recovery"])]),
        h.div([h.Class("issue-actions")], [button(h, "button button--primary", "Edit", SelectedScenario({ scenario: "editing" })), button(h, "button button--quiet", model.scenario === "closed" ? "Reopen" : "Close", model.scenario === "closed" ? ReopenedIssue() : ClosedIssue()), button(h, "icon-button", "•••", RequestedDelete(), "Delete issue")]),
      ]),
      h.div([h.Class("event-stream")], [
        recoveryEvent(h, model),
        h.article([h.Class("mutation-event")], [h.div([h.Class("event-rail")], [icon(h, "●")]), h.div([h.Class("event-card comment-event")], [h.header([], [h.strong([], ["pi/sync-recovery commented"]), h.time([], ["18 minutes ago"])]), h.p([], ["I can reproduce the loss only when a sequence gap forces the project cache to rebuild."])])]),
        h.article([h.Class("mutation-event")], [h.div([h.Class("event-rail")], [icon(h, "✎")]), h.div([h.Class("event-card compact-event")], [h.strong([], ["You edited the description"]), h.span([], ["yesterday · revision 18"])])]),
        h.article([h.Class("mutation-event")], [h.div([h.Class("event-rail")], [icon(h, "+")]), h.div([h.Class("event-card compact-event")], [h.strong([], ["You opened this issue"]), h.span([], ["yesterday"])])]),
      ]),
      h.aside([h.Class("timeline-context")], [compactMeta(h), h.div([h.Class("sync-explainer")], [h.small([], ["SYNC STATUS"]), h.strong([], [model.scenario === "reconnecting" ? "Waiting for project changes" : "Caught up"]), h.p([], [model.scenario === "reconnecting" ? "Cached issue data remains visible. Mutations wait for a connection." : "Project change 8,241 · just now"])] )]),
    ]),
    noticeToast(h, model),
  ]);
}

function detailPanel(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  return model.variant === "A" ? variantInline(h, model) : model.variant === "B" ? variantWorkspace(h, model) : variantTimeline(h, model);
}

function prototypeIntro(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  const descriptions: Readonly<Record<Variant, string>> = {
    A: "Mutations stay where they begin. Recovery appears directly beside the field, action, or stale content that needs attention.",
    B: "Canonical issue content stays stable while every local, incoming, or interrupted change is resolved in a persistent side workspace.",
    C: "Local attempts, incoming revisions, lifecycle changes, and recovery all become an explicit chronological stream above history.",
  };
  return h.header([h.Class("prototype-intro")], [
    h.div([], [h.p([], [`INTERACTION DIRECTION ${model.variant}`]), h.h1([], [variantNames[model.variant]])]),
    h.p([], [descriptions[model.variant]]),
  ]);
}

function switcher(h: ReturnType<typeof html<PrototypeMessage>>, model: PrototypeModel): Html {
  const order: ReadonlyArray<Variant> = ["A", "B", "C"];
  const currentIndex = order.indexOf(model.variant);
  const previous = order[(currentIndex + order.length - 1) % order.length] ?? "A";
  const next = order[(currentIndex + 1) % order.length] ?? "A";
  return h.nav([h.Class("prototype-switcher"), h.AriaLabel("Prototype directions")], [
    button(h, "switcher-arrow", "←", ChangedVariant({ variant: previous }), "Previous direction"),
    h.div([h.Class("switcher-title")], [h.small([], ["DIRECTION"]), h.strong([], [`${model.variant} — ${variantNames[model.variant]}`])]),
    h.div([h.Class("variant-options")], order.map((variant) => button(h, variant === model.variant ? "variant-option is-active" : "variant-option", variant, ChangedVariant({ variant }), variantNames[variant]))),
    button(h, "mode-toggle", model.colorMode === "light" ? "☾ Dark" : "☀ Light", ToggledColorMode(), `Switch to ${model.colorMode === "light" ? "dark" : "light"} mode`),
    button(h, "switcher-arrow", "→", ChangedVariant({ variant: next }), "Next direction"),
  ]);
}

function view(model: PrototypeModel): Html {
  const h = html<PrototypeMessage>();
  return h.div([h.Class(`prototype-root direction-${model.variant.toLowerCase()} mode-${model.colorMode}`)], [
    h.div([h.Class("prototype-canvas")], [
      prototypeIntro(h, model),
      scenarioBar(h, model),
      h.div([h.Class("app-frame")], [appHeader(h, model), h.div([h.Class("app-workspace")], [issueNavigation(h, model), detailPanel(h, model)])]),
    ]),
    import.meta.env.DEV ? switcher(h, model) : h.empty,
  ]);
}

function attachKeyboardSwitcher(): () => void {
  const listener = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches("input, textarea") || target.isContentEditable)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const title = event.key === "ArrowLeft" ? "Previous direction" : "Next direction";
    document.querySelector<HTMLButtonElement>(`.prototype-switcher [title="${title}"]`)?.click();
  };
  document.addEventListener("keydown", listener);
  return () => document.removeEventListener("keydown", listener);
}

/** Embed the throwaway mutation and synchronization recovery prototype. */
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
  return { dispose: () => { detachKeyboard(); handle.dispose(); } };
}
