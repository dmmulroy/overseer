import { Button } from "@foldkit/ui";
import { Match, Schema } from "effect";
import { Runtime, type Command } from "foldkit";
import { html, type Html } from "foldkit/html";
import { m } from "foldkit/message";

// PROTOTYPE — Three structurally different ways to compose issue identity,
// steering state, relationships, and actions on /prototype/issue-detail.
// All three use the previously selected Utility visual direction.

const VariantSchema = Schema.Union([
  Schema.Literal("A"),
  Schema.Literal("B"),
  Schema.Literal("C"),
]);
const ColorModeSchema = Schema.Union([
  Schema.Literal("light"),
  Schema.Literal("dark"),
]);
const IssueStateSchema = Schema.Union([
  Schema.Literal("open"),
  Schema.Literal("closed"),
]);
const ClaimStateSchema = Schema.Union([
  Schema.Literal("unclaimed"),
  Schema.Literal("claimed"),
]);

const ChangedVariant = m("ChangedVariant", { variant: VariantSchema });
const ToggledColorMode = m("ToggledColorMode");
const ToggledIssueState = m("ToggledIssueState");
const ToggledClaim = m("ToggledClaim");

const PrototypeMessage = Schema.Union([
  ChangedVariant,
  ToggledColorMode,
  ToggledIssueState,
  ToggledClaim,
]);
type PrototypeMessage = typeof PrototypeMessage.Type;

const PrototypeModel = Schema.Struct({
  variant: VariantSchema,
  colorMode: ColorModeSchema,
  issueState: IssueStateSchema,
  claimState: ClaimStateSchema,
});
type PrototypeModel = typeof PrototypeModel.Type;
type Variant = PrototypeModel["variant"];
type ColorMode = PrototypeModel["colorMode"];

type SeedIssue = Readonly<{
  number: number;
  title: string;
  state: "open" | "closed";
  meta: string;
}>;

const nearbyIssues: ReadonlyArray<SeedIssue> = [
  { number: 42, title: "Show upload progress in issue comments", state: "open", meta: "blocked" },
  { number: 41, title: "Cancel upload without clearing the draft", state: "open", meta: "unclaimed" },
  { number: 40, title: "Recover active uploads after reconnect", state: "open", meta: "claimed" },
  { number: 38, title: "Add resumable uploads for large attachments", state: "open", meta: "blocked" },
  { number: 35, title: "Store multipart upload sessions", state: "open", meta: "in progress" },
  { number: 17, title: "Improve attachment reliability", state: "open", meta: "3 / 5 done" },
];

const variantNames: Readonly<Record<Variant, string>> = {
  A: "Control strip",
  B: "Steering rail",
  C: "Work map",
};

function variantFromUrl(): Variant {
  const value = new URL(window.location.href).searchParams.get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function colorModeFromUrl(): ColorMode {
  return new URL(window.location.href).searchParams.get("mode") === "dark"
    ? "dark"
    : "light";
}

function writePrototypeStateToUrl(variant: Variant, colorMode: ColorMode): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/issue-detail";
  url.searchParams.set("variant", variant);
  url.searchParams.set("mode", colorMode);
  window.history.replaceState({}, "", url);
}

function initialModel(): PrototypeModel {
  const variant = variantFromUrl();
  const colorMode = colorModeFromUrl();
  writePrototypeStateToUrl(variant, colorMode);
  return {
    variant,
    colorMode,
    issueState: "open",
    claimState: "unclaimed",
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
        writePrototypeStateToUrl(variant, model.colorMode);
        return [{ ...model, variant }, []];
      },
      ToggledColorMode: () => {
        const colorMode = model.colorMode === "light" ? "dark" : "light";
        writePrototypeStateToUrl(model.variant, colorMode);
        return [{ ...model, colorMode }, []];
      },
      ToggledIssueState: () => [{
        ...model,
        issueState: model.issueState === "open" ? "closed" : "open",
      }, []],
      ToggledClaim: () => [{
        ...model,
        claimState: model.claimState === "unclaimed" ? "claimed" : "unclaimed",
      }, []],
    }),
  );
}

function actionButton(
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

function staticButton(
  h: ReturnType<typeof html<PrototypeMessage>>,
  className: string,
  label: string,
): Html {
  return h.button([h.Class(className), h.Type("button")], [label]);
}

function stateBadge(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.span([h.Class(`state-badge state-badge--${model.issueState}`)], [
    model.issueState === "open" ? "● Open" : "✓ Closed",
  ]);
}

function labelChips(h: ReturnType<typeof html<PrototypeMessage>>): ReadonlyArray<Html> {
  return [
    h.span([h.Class("label-chip label-chip--blue")], ["attachments"]),
    h.span([h.Class("label-chip label-chip--green")], ["reliability"]),
    h.span([h.Class("label-chip label-chip--violet")], ["ready-for-agent"]),
  ];
}

function claimValue(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return model.claimState === "claimed"
    ? h.span([h.Class("claim-value is-claimed")], [
      h.span([h.Class("agent-avatar")], ["PI"]),
      h.span([], [h.strong([], ["pi/wayfinder-32"]), h.small([], ["claimed by you"])]),
    ])
    : h.span([h.Class("claim-value is-empty")], [
      h.span([h.Class("agent-avatar")], ["—"]),
      h.span([], [h.strong([], ["Unclaimed"]), h.small([], ["available to work"])]),
    ]);
}

function closeAction(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
  className = "button button--quiet",
): Html {
  return actionButton(
    h,
    className,
    model.issueState === "open" ? "Close issue" : "Reopen issue",
    ToggledIssueState(),
  );
}

function claimAction(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
  className = "button button--primary",
): Html {
  return actionButton(
    h,
    className,
    model.claimState === "claimed" ? "Release claim" : "Claim issue",
    ToggledClaim(),
  );
}

function issueRow(
  h: ReturnType<typeof html<PrototypeMessage>>,
  issue: SeedIssue,
): Html {
  const selected = issue.number === 38;
  return h.button([
    h.Class(`issue-row${selected ? " is-selected" : ""}`),
    h.Type("button"),
  ], [
    h.span([h.Class(`issue-row__state issue-row__state--${issue.state}`)], [
      issue.state === "open" ? "●" : "✓",
    ]),
    h.span([h.Class("issue-row__copy")], [
      h.strong([], [issue.title]),
      h.small([], [`#${issue.number} · ${issue.meta}`]),
    ]),
  ]);
}

function appHeader(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.header([h.Class("app-header")], [
    h.div([h.Class("brand")], [h.span([h.Class("brand-mark")], ["O"]), h.strong([], ["Overseer"])]),
    h.nav([h.Class("breadcrumbs"), h.AriaLabel("Breadcrumb")], [
      h.span([], ["Personal"]), h.i([], ["/"]), h.span([], ["Attachments"]), h.i([], ["/"]), h.strong([], ["#38"]),
    ]),
    h.div([h.Class("header-search")], [h.span([], ["⌕"]), h.span([], ["Search issues"]), h.kbd([], ["⌘K"])]),
    h.div([h.Class("header-tools")], [
      actionButton(
        h,
        "mode-icon",
        model.colorMode === "light" ? "☾" : "☀",
        ToggledColorMode(),
        `Switch to ${model.colorMode === "light" ? "dark" : "light"} mode`,
      ),
      h.span([h.Class("live-status")], ["● Live"]),
      h.span([h.Class("avatar")], ["DM"]),
    ]),
  ]);
}

function issueNavigation(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.aside([h.Class("issue-navigation")], [
    h.header([h.Class("navigation-heading")], [
      h.div([], [h.h2([], ["Issues"]), h.p([], ["Attachments · 14 open"])]),
      staticButton(h, "icon-button", "+"),
    ]),
    h.div([h.Class("filter-row")], [
      staticButton(h, "filter is-active", "Open"),
      staticButton(h, "filter", "Assigned"),
      staticButton(h, "filter", "Blocked"),
    ]),
    h.div([h.Class("issue-list")], nearbyIssues.map((issue) => issueRow(h, issue))),
  ]);
}

function issueDescription(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.div([h.Class("issue-description")], [
    h.p([], [
      "Large uploads restart from the beginning when a connection drops. Keep completed chunks and continue from the last confirmed part so contributors can recover without selecting the file again.",
    ]),
    h.h2([], ["Expected behavior"]),
    h.ul([], [
      h.li([], ["Resume after a browser reconnect or temporary network failure."]),
      h.li([], ["Retain completed part tokens until the upload is committed or cancelled."]),
      h.li([], ["Preserve the comment draft when an upload is cancelled."]),
    ]),
  ]);
}

function relationRow(
  h: ReturnType<typeof html<PrototypeMessage>>,
  kind: "open" | "closed" | "blocked",
  number: number,
  title: string,
  trailing: string,
): Html {
  const icon = kind === "closed" ? "✓" : kind === "blocked" ? "⊘" : "●";
  return h.a([h.Class("relation-row"), h.Href(`#${number}`)], [
    h.span([h.Class(`relation-state relation-state--${kind}`)], [icon]),
    h.span([h.Class("relation-copy")], [
      h.strong([], [`#${number} ${title}`]),
      h.small([], [trailing]),
    ]),
    h.span([h.Class("relation-arrow")], ["→"]),
  ]);
}

function variantA(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.main([h.Class("detail detail--control-strip")], [
    h.header([h.Class("control-header")], [
      h.div([h.Class("identity-line")], [stateBadge(h, model), h.span([], ["Attachments / Issue #38"]), h.span([], ["Updated 8m ago"])]),
      h.div([h.Class("control-title-row")], [
        h.h1([], ["Add resumable uploads for large attachments"]),
        h.div([h.Class("action-row")], [
          claimAction(h, model),
          staticButton(h, "button button--quiet", "Edit"),
          closeAction(h, model),
          staticButton(h, "icon-button", "•••"),
        ]),
      ]),
    ]),
    h.section([h.Class("control-strip"), h.AriaLabel("Issue steering state")], [
      h.div([h.Class("control-cell")], [h.small([], ["State"]), h.strong([], [model.issueState === "open" ? "Open" : "Closed"]), h.span([], ["Created today by you"])]),
      h.div([h.Class("control-cell control-cell--claim")], [h.small([], ["Assignee / claim"]), claimValue(h, model)]),
      h.div([h.Class("control-cell")], [h.small([], ["Labels"]), h.div([h.Class("chip-row")], labelChips(h))]),
      h.div([h.Class("control-cell control-cell--gate")], [h.small([], ["Current gate"]), h.strong([], ["⊘ Blocked"]), h.span([], ["1 open prerequisite"])]),
    ]),
    h.div([h.Class("control-content")], [
      h.article([h.Class("control-body")], [
        issueDescription(h),
        h.section([h.Class("relation-section")], [
          h.header([h.Class("section-heading")], [h.div([], [h.small([], ["Hierarchy"]), h.h2([], ["Parent & sub-issues"])]), staticButton(h, "text-button", "Edit hierarchy")]),
          h.div([h.Class("parent-band")], [h.small([], ["Parent"]), h.a([h.Href("#17")], ["#17 Improve attachment reliability"]), h.span([], ["3 of 5 complete"])]),
          h.div([h.Class("relation-list")], [
            relationRow(h, "closed", 39, "Persist completed part tokens", "Closed by pi/storage-parts"),
            relationRow(h, "open", 40, "Recover active uploads after reconnect", "Assigned to claude-code/reconnect"),
            relationRow(h, "open", 41, "Cancel upload without clearing the draft", "Unclaimed"),
          ]),
        ]),
      ]),
      h.aside([h.Class("control-relations")], [
        h.section([h.Class("side-section side-section--danger")], [
          h.header([], [h.small([], ["Blocked by"]), h.span([h.Class("count-badge")], ["1 open"])]),
          relationRow(h, "blocked", 35, "Store multipart upload sessions", "In progress · pi/uploads-do"),
          h.p([], ["This issue becomes actionable when #35 closes."]),
        ]),
        h.section([h.Class("side-section")], [
          h.header([], [h.small([], ["Blocks"]), h.span([h.Class("count-badge")], ["1 issue"])]),
          relationRow(h, "open", 42, "Show upload progress in issue comments", "Waiting on this issue"),
        ]),
        h.section([h.Class("activity-note")], [h.small([], ["Latest"]), h.p([], [h.strong([], ["pi/uploads-do"]), " claimed blocker #35 12 minutes ago."])]),
      ]),
    ]),
  ]);
}

function outlineItem(
  h: ReturnType<typeof html<PrototypeMessage>>,
  className: string,
  eyebrow: string,
  title: string,
  detail: string,
): Html {
  return h.a([h.Class(`outline-item ${className}`), h.Href("#relation")], [
    h.span([h.Class("outline-marker")], []),
    h.span([], [h.small([], [eyebrow]), h.strong([], [title]), h.em([], [detail])]),
  ]);
}

function variantB(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.main([h.Class("detail detail--steering-rail")], [
    h.aside([h.Class("steering-rail")], [
      h.a([h.Class("back-link"), h.Href("#issues")], ["← Attachments issues"]),
      h.div([h.Class("rail-identity")], [h.small([], ["ISSUE"]), h.strong([], ["#38"]), stateBadge(h, model)]),
      h.section([h.Class("rail-section rail-claim")], [
        h.small([], ["Assignee / claim"]),
        claimValue(h, model),
        claimAction(h, model, "button button--primary button--wide"),
      ]),
      h.section([h.Class("rail-section")], [h.small([], ["Labels"]), h.div([h.Class("chip-row")], labelChips(h))]),
      h.section([h.Class("rail-section rail-gate")], [
        h.small([], ["Readiness"]),
        h.strong([], ["⊘ Waiting on #35"]),
        h.p([], ["Multipart upload sessions must land first."]),
      ]),
      h.div([h.Class("rail-actions")], [
        staticButton(h, "button button--quiet button--wide", "Edit issue"),
        closeAction(h, model, "button button--quiet button--wide"),
        staticButton(h, "text-button", "Delete…"),
      ]),
    ]),
    h.article([h.Class("reading-pane")], [
      h.header([h.Class("reading-header")], [
        h.p([], ["Personal / Attachments"]),
        h.h1([], ["Add resumable uploads for large attachments"]),
        h.span([], ["Opened by you today · updated 8 minutes ago"]),
      ]),
      issueDescription(h),
      h.section([h.Class("outline")], [
        h.header([h.Class("section-heading")], [h.div([], [h.small([], ["Work outline"]), h.h2([], ["Where this issue sits"])]), staticButton(h, "text-button", "Edit relationships")]),
        outlineItem(h, "is-parent", "PARENT · 3 OF 5 COMPLETE", "#17 Improve attachment reliability", "Open"),
        h.div([h.Class("outline-current")], [
          h.span([h.Class("outline-marker")], []),
          h.div([], [h.small([], ["CURRENT ISSUE"]), h.strong([], ["#38 Add resumable uploads for large attachments"]), h.em([], [model.issueState === "open" ? "Open · blocked" : "Closed"])]),
        ]),
        h.div([h.Class("outline-children")], [
          outlineItem(h, "is-closed", "SUB-ISSUE", "#39 Persist completed part tokens", "Closed"),
          outlineItem(h, "", "SUB-ISSUE", "#40 Recover active uploads after reconnect", "Open · claimed"),
          outlineItem(h, "", "SUB-ISSUE", "#41 Cancel upload without clearing the draft", "Open · unclaimed"),
        ]),
      ]),
      h.section([h.Class("dependency-ledger")], [
        h.header([h.Class("section-heading")], [h.div([], [h.small([], ["Blocking relations"]), h.h2([], ["Prerequisites & downstream work"])]), h.span([h.Class("ledger-summary")], ["1 in · 1 out"])]),
        h.div([h.Class("ledger-row ledger-row--blocked")], [h.small([], ["WAITING ON"]), h.a([h.Href("#35")], ["#35 Store multipart upload sessions"]), h.span([], ["pi/uploads-do · in progress"])]),
        h.div([h.Class("ledger-row")], [h.small([], ["UNLOCKS"]), h.a([h.Href("#42")], ["#42 Show upload progress in issue comments"]), h.span([], ["unclaimed"])]),
      ]),
    ]),
  ]);
}

function mapNode(
  h: ReturnType<typeof html<PrototypeMessage>>,
  className: string,
  eyebrow: string,
  title: string,
  meta: string,
): Html {
  return h.a([h.Class(`map-node ${className}`), h.Href("#relation")], [
    h.small([], [eyebrow]),
    h.strong([], [title]),
    h.span([], [meta]),
  ]);
}

function variantC(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.main([h.Class("detail detail--work-map")], [
    h.header([h.Class("map-header")], [
      h.div([], [h.p([], ["Attachments · #38"]), h.h1([], ["Add resumable uploads for large attachments"])]),
      h.div([h.Class("action-row")], [claimAction(h, model), staticButton(h, "button button--quiet", "Edit"), closeAction(h, model)]),
    ]),
    h.div([h.Class("map-content")], [
      h.section([h.Class("map-canvas"), h.AriaLabel("Issue relationship map")], [
        h.header([h.Class("map-canvas-heading")], [h.div([], [h.small([], ["RELATIONSHIP MAP"]), h.h2([], ["Work around #38"])]), staticButton(h, "text-button", "Edit map")]),
        h.div([h.Class("map-parent")], [mapNode(h, "map-node--parent", "PARENT · 3/5 DONE", "#17 Improve attachment reliability", "Open")]),
        h.div([h.Class("map-middle")], [
          mapNode(h, "map-node--blocker", "BLOCKED BY", "#35 Store multipart upload sessions", "Open · pi/uploads-do"),
          h.div([h.Class("map-current")], [
            h.div([h.Class("map-current__top")], [stateBadge(h, model), h.span([h.Class("blocked-badge")], ["⊘ Blocked"])]),
            h.small([], ["CURRENT ISSUE"]),
            h.strong([], ["#38 Resumable uploads"]),
            h.div([h.Class("chip-row")], labelChips(h)),
            claimValue(h, model),
          ]),
          mapNode(h, "map-node--downstream", "BLOCKS", "#42 Show upload progress", "Open · unclaimed"),
        ]),
        h.div([h.Class("map-children-label")], [h.span([], ["SUB-ISSUES"]), h.span([], ["1 of 3 closed"])]),
        h.div([h.Class("map-children")], [
          mapNode(h, "map-node--child is-complete", "✓ CLOSED", "#39 Persist completed part tokens", "pi/storage-parts"),
          mapNode(h, "map-node--child", "● OPEN", "#40 Recover after reconnect", "claude-code/reconnect"),
          mapNode(h, "map-node--child", "● OPEN", "#41 Preserve draft on cancel", "Unclaimed"),
        ]),
      ]),
      h.aside([h.Class("map-inspector")], [
        h.section([h.Class("next-move")], [
          h.small([], ["NEXT MOVE"]),
          h.span([h.Class("next-move__icon")], ["⊘"]),
          h.h2([], ["Help #35 land first"]),
          h.p([], ["This issue is open but not actionable until multipart upload sessions are stored durably."]),
          h.a([h.Href("#35")], ["Open blocker #35 →"]),
        ]),
        h.section([h.Class("inspector-section")], [h.small([], ["ASSIGNEE / CLAIM"]), claimValue(h, model), claimAction(h, model, "button button--primary button--wide")]),
        h.section([h.Class("inspector-section inspector-description")], [h.small([], ["ISSUE BODY"]), issueDescription(h)]),
        h.section([h.Class("inspector-actions")], [staticButton(h, "button button--quiet", "Edit issue"), closeAction(h, model), staticButton(h, "icon-button", "•••")]),
      ]),
    ]),
  ]);
}

function detailVariant(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return Match.value(model.variant).pipe(
    Match.when("A", () => variantA(h, model)),
    Match.when("B", () => variantB(h, model)),
    Match.when("C", () => variantC(h, model)),
    Match.exhaustive,
  );
}

function appSpecimen(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.div([h.Class("app-frame")], [
    appHeader(h, model),
    h.div([h.Class("app-workspace")], [issueNavigation(h), detailVariant(h, model)]),
  ]);
}

function prototypeIntro(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const descriptions: Readonly<Record<Variant, string>> = {
    A: "A dense horizontal control plane puts every steering signal directly under the title.",
    B: "A persistent left rail separates ownership and actions from a calm reading and work outline.",
    C: "Relations become the main canvas, with the next actionable move explained in an inspector.",
  };
  return h.header([h.Class("prototype-intro")], [
    h.div([], [h.p([], [`ISSUE DETAIL DIRECTION ${model.variant}`]), h.h1([], [variantNames[model.variant]])]),
    h.p([], [descriptions[model.variant]]),
  ]);
}

function switcher(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const order: ReadonlyArray<Variant> = ["A", "B", "C"];
  const currentIndex = order.indexOf(model.variant);
  const previous = order[(currentIndex + order.length - 1) % order.length] ?? "A";
  const next = order[(currentIndex + 1) % order.length] ?? "A";
  return h.nav([h.Class("prototype-switcher"), h.AriaLabel("Prototype variants")], [
    actionButton(h, "switcher-arrow", "←", ChangedVariant({ variant: previous }), "Previous variant"),
    h.div([h.Class("switcher-title")], [h.small([], ["UTILITY · ISSUE DETAIL"]), h.strong([], [`${model.variant} — ${variantNames[model.variant]}`])]),
    h.div([h.Class("variant-options")], order.map((variant) => actionButton(
      h,
      variant === model.variant ? "variant-option is-active" : "variant-option",
      variant,
      ChangedVariant({ variant }),
      variantNames[variant],
    ))),
    actionButton(h, "switcher-mode", model.colorMode === "light" ? "☾ Dark" : "☀ Light", ToggledColorMode()),
    actionButton(h, "switcher-arrow", "→", ChangedVariant({ variant: next }), "Next variant"),
  ]);
}

function view(model: PrototypeModel): Html {
  const h = html<PrototypeMessage>();
  return h.div([h.Class(`prototype-root mode-${model.colorMode} variant-${model.variant.toLowerCase()}`)], [
    h.div([h.Class("prototype-canvas")], [prototypeIntro(h, model), appSpecimen(h, model)]),
    import.meta.env.DEV ? switcher(h, model) : h.empty,
  ]);
}

function attachKeyboardSwitcher(): () => void {
  const listener = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches("input, textarea") || target.isContentEditable)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const title = event.key === "ArrowLeft" ? "Previous variant" : "Next variant";
    document.querySelector<HTMLButtonElement>(`.prototype-switcher [title="${title}"]`)?.click();
  };
  document.addEventListener("keydown", listener);
  return () => document.removeEventListener("keydown", listener);
}

/** Embed the throwaway issue-detail steering prototype. */
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
