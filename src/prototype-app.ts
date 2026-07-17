import { Button, Input, Textarea } from "@foldkit/ui";
import { Match, Schema } from "effect";
import { Runtime, type Command } from "foldkit";
import { html, type Html } from "foldkit/html";
import { m } from "foldkit/message";

// PROTOTYPE — Three visual theme specimens, switchable via ?variant= and
// ?mode=, on the throwaway /prototype/issue-centric route. Every direction
// renders the same fixture and structure so this round decides theme only.

const VariantSchema = Schema.Union([
  Schema.Literal("A"),
  Schema.Literal("B"),
  Schema.Literal("C"),
]);
const ColorModeSchema = Schema.Union([
  Schema.Literal("light"),
  Schema.Literal("dark"),
]);

const ChangedVariant = m("ChangedVariant", { variant: VariantSchema });
const ToggledColorMode = m("ToggledColorMode");
const ChangedSearch = m("ChangedSearch", { value: Schema.String });
const ChangedComment = m("ChangedComment", { value: Schema.String });

const PrototypeMessage = Schema.Union([
  ChangedVariant,
  ToggledColorMode,
  ChangedSearch,
  ChangedComment,
]);
type PrototypeMessage = typeof PrototypeMessage.Type;

const PrototypeModel = Schema.Struct({
  variant: VariantSchema,
  colorMode: ColorModeSchema,
  search: Schema.String,
  comment: Schema.String,
});
type PrototypeModel = typeof PrototypeModel.Type;
type Variant = PrototypeModel["variant"];
type ColorMode = PrototypeModel["colorMode"];

type SeedIssue = Readonly<{
  number: number;
  title: string;
  state: "open" | "closed";
  labels: ReadonlyArray<string>;
  updated: string;
}>;

const issues: ReadonlyArray<SeedIssue> = [
  {
    number: 42,
    title: "Show upload progress in issue comments",
    state: "open",
    labels: ["attachments", "frontend"],
    updated: "8m",
  },
  {
    number: 41,
    title: "Reject unsupported file types before upload",
    state: "open",
    labels: ["attachments"],
    updated: "24m",
  },
  {
    number: 38,
    title: "Add resumable uploads for large attachments",
    state: "open",
    labels: ["attachments", "reliability"],
    updated: "now",
  },
  {
    number: 34,
    title: "Preserve draft comments after reconnect",
    state: "closed",
    labels: ["offline"],
    updated: "3h",
  },
  {
    number: 29,
    title: "Stream project changes to active clients",
    state: "closed",
    labels: ["realtime"],
    updated: "yesterday",
  },
];

const variantNames: Readonly<Record<Variant, string>> = {
  A: "Utility",
  B: "Editorial",
  C: "Desktop",
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
  url.pathname = "/prototype/issue-centric";
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
    search: "",
    comment: "",
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
      ChangedSearch: ({ value }) => [{ ...model, search: value }, []],
      ChangedComment: ({ value }) => [{ ...model, comment: value }, []],
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

function staticButton(
  h: ReturnType<typeof html<PrototypeMessage>>,
  className: string,
  label: string,
): Html {
  return h.button([h.Class(className), h.Type("button")], [label]);
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
    h.span([h.Class(`state-dot state-dot--${issue.state}`)], [issue.state === "open" ? "●" : "✓"]),
    h.span([h.Class("issue-row__content")], [
      h.strong([], [issue.title]),
      h.span([h.Class("issue-row__meta")], [
        `#${issue.number}`,
        ...issue.labels.slice(0, 1).map((label) => h.span([h.Class("mini-label")], [label])),
      ]),
    ]),
    h.time([], [issue.updated]),
  ]);
}

function appHeader(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.header([h.Class("app-header")], [
    h.div([h.Class("brand")], [
      h.span([h.Class("brand-mark")], ["O"]),
      h.strong([], ["Overseer"]),
    ]),
    h.nav([h.Class("breadcrumbs"), h.AriaLabel("Breadcrumb")], [
      h.span([], ["Personal"]),
      h.i([], ["/"]),
      h.span([], ["Attachments"]),
      h.i([], ["/"]),
      h.strong([], ["#38"]),
    ]),
    Input.view<PrototypeMessage>({
      id: "issue-search",
      value: model.search,
      placeholder: "Search issues",
      onInput: (value) => ChangedSearch({ value }),
      toView: (attributes) => h.div([h.Class("search-field")], [
        h.label([...attributes.label, h.Class("sr-only")], ["Search issues"]),
        h.span([h.AriaHidden(true)], ["⌕"]),
        h.input([...attributes.input, h.Class("search-input")]),
        h.kbd([], ["⌘K"]),
      ]),
    }),
    h.div([h.Class("header-tools")], [
      h.span([h.Class("live-status")], [h.b([], ["●"]), " Live"]),
      h.span([h.Class("avatar")], ["DM"]),
    ]),
  ]);
}

function issueNavigation(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.aside([h.Class("issue-navigation")], [
    h.header([h.Class("panel-heading")], [
      h.div([], [h.h2([], ["Issues"]), h.p([], ["Attachments · 5 issues"])]),
      staticButton(h, "icon-button", "+"),
    ]),
    h.div([h.Class("filter-row")], [
      staticButton(h, "filter is-active", "Open 3"),
      staticButton(h, "filter", "Assigned"),
      staticButton(h, "filter", "All labels"),
    ]),
    h.div([h.Class("issue-list")], issues.map((issue) => issueRow(h, issue))),
    h.footer([h.Class("navigation-footer")], [
      h.span([], ["5 issues"]),
      staticButton(h, "text-button", "View deleted"),
    ]),
  ]);
}

function issueTitle(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.header([h.Class("issue-title")], [
    h.div([h.Class("issue-kicker")], [
      h.span([h.Class("status-badge")], ["● Open"]),
      h.span([], ["Issue #38"]),
      h.span([], ["updated just now"]),
    ]),
    h.div([h.Class("title-row")], [
      h.h1([], ["Add resumable uploads for large attachments"]),
      h.div([h.Class("primary-actions")], [
        staticButton(h, "button button--quiet", "Close"),
        staticButton(h, "button button--primary", "Edit"),
        staticButton(h, "icon-button", "•••"),
      ]),
    ]),
    h.p([h.Class("issue-byline")], [
      "Opened by you two hours ago · ",
      h.strong([], ["claude-code/upload-retry"]),
      " is working on it",
    ]),
  ]);
}

function issueBody(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.section([h.Class("issue-body")], [
    h.p([], [
      "Large uploads currently restart from the beginning when a connection drops. Keep completed chunks and continue from the last confirmed part so contributors can recover without selecting the file again.",
    ]),
    h.h2([], ["Expected behavior"]),
    h.ul([], [
      h.li([], ["Resume after a browser reconnect or temporary network failure."]),
      h.li([], ["Show which parts are complete and which part is retrying."]),
      h.li([], ["Let someone cancel the upload without deleting their comment draft."]),
    ]),
  ]);
}

function relations(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.section([h.Class("relations section-block")], [
    h.header([h.Class("section-heading")], [
      h.h2([], ["Related work"]),
      staticButton(h, "text-button", "Edit relationships"),
    ]),
    h.div([h.Class("relation-grid")], [
      h.a([h.Class("relation-card"), h.Href("#17")], [
        h.small([], ["Parent"]),
        h.strong([], ["#17 Improve attachment reliability"]),
        h.span([], ["6 of 8 issues closed"]),
      ]),
      h.a([h.Class("relation-card"), h.Href("#42")], [
        h.small([], ["Blocks"]),
        h.strong([], ["#42 Show upload progress in issue comments"]),
        h.span([], ["Waiting on this issue"]),
      ]),
    ]),
  ]);
}

function timelineItem(
  h: ReturnType<typeof html<PrototypeMessage>>,
  icon: string,
  actor: string,
  action: string,
  time: string,
  detail?: string,
): Html {
  return h.article([h.Class("timeline-item")], [
    h.span([h.Class("timeline-icon")], [icon]),
    h.div([], [
      h.p([], [h.strong([], [actor]), ` ${action}`]),
      detail === undefined ? h.empty : h.blockquote([], [detail]),
      h.time([], [time]),
    ]),
  ]);
}

function timeline(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.section([h.Class("timeline section-block")], [
    h.header([h.Class("section-heading")], [
      h.h2([], ["Timeline"]),
      staticButton(h, "text-button", "Newest first"),
    ]),
    timelineItem(h, "◎", "claude-code/upload-retry", "claimed this issue", "1 hour ago"),
    timelineItem(
      h,
      "●",
      "claude-code/upload-retry",
      "commented",
      "38 minutes ago",
      "I reproduced the restart after interrupting part 4 of a 12-part upload. I’m checking whether completed part tokens survive reconnects.",
    ),
    timelineItem(
      h,
      "●",
      "You",
      "commented",
      "21 minutes ago",
      "Please preserve the comment draft even when the upload itself is cancelled.",
    ),
    timelineItem(h, "↥", "claude-code/upload-retry", "attached upload-reconnect.mp4", "just now"),
  ]);
}

function composer(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.section([h.Class("composer")], [
    h.span([h.Class("avatar avatar--composer")], ["DM"]),
    h.div([h.Class("composer-main")], [
      Textarea.view<PrototypeMessage>({
        id: "comment-body",
        value: model.comment,
        rows: 4,
        placeholder: "Leave a comment…",
        onInput: (value) => ChangedComment({ value }),
        toView: (attributes) => h.div([], [
          h.label([...attributes.label, h.Class("sr-only")], ["Comment"]),
          h.textarea([...attributes.textarea, h.Class("comment-input")], []),
        ]),
      }),
      h.div([h.Class("composer-actions")], [
        h.div([], [
          staticButton(h, "text-button", "+ Attach file"),
          h.span([], ["Markdown supported"]),
        ]),
        staticButton(h, "button button--primary", "Comment"),
      ]),
    ]),
  ]);
}

function metadataSidebar(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  const field = (label: string, value: Html | string) => h.div([h.Class("metadata-field")], [
    h.dt([], [label]),
    h.dd([], [value]),
  ]);
  return h.aside([h.Class("metadata-sidebar")], [
    h.section([h.Class("sidebar-card")], [
      h.header([h.Class("section-heading")], [h.h2([], ["Details"]), staticButton(h, "text-button", "Edit")]),
      h.dl([h.Class("metadata-list")], [
        field("Assignee", h.div([h.Class("agent-value")], [h.span([], ["CC"]), h.strong([], ["claude-code/upload-retry"])])),
        field("Labels", h.div([h.Class("label-stack")], [
          h.span([h.Class("label-chip label-chip--blue")], ["attachments"]),
          h.span([h.Class("label-chip label-chip--green")], ["reliability"]),
          staticButton(h, "chip-add", "+"),
        ])),
        field("Project", h.a([h.Href("#attachments")], ["Attachments"])),
        field("Revision", "12 · updated just now"),
      ]),
    ]),
    h.section([h.Class("sidebar-card state-sample")], [
      h.small([h.Class("specimen-label")], ["Warning treatment"]),
      h.div([h.Class("message message--warning")], [
        h.strong([], ["Upload interrupted"]),
        h.p([], ["8 of 12 parts are safe. Continue when the connection is stable."]),
        staticButton(h, "button button--quiet", "Retry upload"),
      ]),
    ]),
    h.section([h.Class("sidebar-card state-sample")], [
      h.small([h.Class("specimen-label")], ["Dialog treatment"]),
      h.div([h.Class("dialog-sample")], [
        h.span([h.Class("danger-mark")], ["!"]),
        h.h2([], ["Delete issue?"]),
        h.p([], ["You can restore it later from deleted issues."]),
        h.div([h.Class("dialog-actions")], [
          staticButton(h, "button button--quiet", "Cancel"),
          staticButton(h, "button button--danger", "Delete"),
        ]),
      ]),
    ]),
  ]);
}

function detailPanel(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.main([h.Class("detail-panel")], [
    h.div([h.Class("cache-notice")], [
      h.span([], ["✓"]),
      h.p([], ["Ready from this device"]),
      h.span([], ["Synced just now"]),
    ]),
    h.div([h.Class("detail-content")], [
      issueTitle(h),
      h.div([h.Class("detail-layout")], [
        h.div([h.Class("issue-column")], [
          issueBody(h),
          relations(h),
          timeline(h),
          composer(h, model),
        ]),
        metadataSidebar(h),
      ]),
    ]),
  ]);
}

function appSpecimen(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.div([h.Class("app-frame")], [
    appHeader(h, model),
    h.div([h.Class("app-workspace")], [
      issueNavigation(h),
      detailPanel(h, model),
    ]),
  ]);
}

function prototypeIntro(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.header([h.Class("prototype-intro")], [
    h.div([], [
      h.p([], [`Visual direction ${model.variant}`]),
      h.h1([], [variantNames[model.variant]]),
    ]),
    h.p([], [
      "Theme specimen only — every direction uses the same structure, fixture, and states. Layout and interactions remain open questions.",
    ]),
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
  return h.nav([h.Class("prototype-switcher"), h.AriaLabel("Prototype themes")], [
    button(h, "switcher-arrow", "←", ChangedVariant({ variant: previous }), "Previous theme"),
    h.div([h.Class("switcher-title")], [
      h.small([], ["THEME DIRECTION"]),
      h.strong([], [`${model.variant} — ${variantNames[model.variant]}`]),
    ]),
    h.div([h.Class("variant-options")], order.map((variant) => button(
      h,
      variant === model.variant ? "variant-option is-active" : "variant-option",
      variant,
      ChangedVariant({ variant }),
      variantNames[variant],
    ))),
    button(
      h,
      "mode-toggle",
      model.colorMode === "light" ? "☾ Dark" : "☀ Light",
      ToggledColorMode(),
      `Switch to ${model.colorMode === "light" ? "dark" : "light"} mode`,
    ),
    button(h, "switcher-arrow", "→", ChangedVariant({ variant: next }), "Next theme"),
  ]);
}

function view(model: PrototypeModel): Html {
  const h = html<PrototypeMessage>();
  return h.div([h.Class(`prototype-root variant-${model.variant.toLowerCase()} mode-${model.colorMode}`)], [
    h.div([h.Class("prototype-canvas")], [
      prototypeIntro(h, model),
      appSpecimen(h, model),
    ]),
    import.meta.env.DEV ? switcher(h, model) : h.empty,
  ]);
}

function attachKeyboardSwitcher(): () => void {
  const listener = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches("input, textarea") || target.isContentEditable)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const title = event.key === "ArrowLeft" ? "Previous theme" : "Next theme";
    document.querySelector<HTMLButtonElement>(`.prototype-switcher [title="${title}"]`)?.click();
  };
  document.addEventListener("keydown", listener);
  return () => document.removeEventListener("keydown", listener);
}

/** Embed the throwaway issue-interface theme prototype. */
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
