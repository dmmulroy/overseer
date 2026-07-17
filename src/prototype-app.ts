import { Button, Textarea } from "@foldkit/ui";
import { Match, Schema } from "effect";
import { Runtime, type Command } from "foldkit";
import { html, type Html } from "foldkit/html";
import { m } from "foldkit/message";

// PROTOTYPE — Three structurally different timeline and contribution models,
// switchable via ?variant=, on the throwaway /prototype/timeline-contribution route.
// All three intentionally use the previously selected Utility visual theme.

const VariantSchema = Schema.Union([
  Schema.Literal("A"),
  Schema.Literal("B"),
  Schema.Literal("C"),
]);
const ComposeModeSchema = Schema.Union([
  Schema.Literal("write"),
  Schema.Literal("preview"),
]);
const FocusTabSchema = Schema.Union([
  Schema.Literal("conversation"),
  Schema.Literal("changes"),
  Schema.Literal("files"),
]);

const ChangedVariant = m("ChangedVariant", { variant: VariantSchema });
const ChangedComment = m("ChangedComment", { value: Schema.String });
const ChangedComposeMode = m("ChangedComposeMode", { mode: ComposeModeSchema });
const ToggledDigest = m("ToggledDigest");
const ToggledBrief = m("ToggledBrief");
const ChangedFocusTab = m("ChangedFocusTab", { tab: FocusTabSchema });

const PrototypeMessage = Schema.Union([
  ChangedVariant,
  ChangedComment,
  ChangedComposeMode,
  ToggledDigest,
  ToggledBrief,
  ChangedFocusTab,
]);
type PrototypeMessage = typeof PrototypeMessage.Type;

const PrototypeModel = Schema.Struct({
  variant: VariantSchema,
  comment: Schema.String,
  composeMode: ComposeModeSchema,
  digestExpanded: Schema.Boolean,
  briefExpanded: Schema.Boolean,
  focusTab: FocusTabSchema,
});
type PrototypeModel = typeof PrototypeModel.Type;
type Variant = PrototypeModel["variant"];
type ComposeMode = PrototypeModel["composeMode"];
type FocusTab = PrototypeModel["focusTab"];

const variantNames: Readonly<Record<Variant, string>> = {
  A: "Thread + digests",
  B: "Brief + work log",
  C: "Focused channels",
};

function variantFromUrl(): Variant {
  const value = new URL(window.location.href).searchParams.get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function writeVariantToUrl(variant: Variant): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/timeline-contribution";
  url.searchParams.set("variant", variant);
  window.history.replaceState({}, "", url);
}

function initialModel(): PrototypeModel {
  const variant = variantFromUrl();
  writeVariantToUrl(variant);
  return {
    variant,
    comment: "Confirmed on a throttled connection. The draft stayed intact after the retry completed.",
    composeMode: "write",
    digestExpanded: false,
    briefExpanded: true,
    focusTab: "conversation",
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
      ChangedComment: ({ value }) => [{ ...model, comment: value }, []],
      ChangedComposeMode: ({ mode }) => [{ ...model, composeMode: mode }, []],
      ToggledDigest: () => [{ ...model, digestExpanded: !model.digestExpanded }, []],
      ToggledBrief: () => [{ ...model, briefExpanded: !model.briefExpanded }, []],
      ChangedFocusTab: ({ tab }) => [{ ...model, focusTab: tab }, []],
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

function avatar(
  h: ReturnType<typeof html<PrototypeMessage>>,
  kind: "human" | "agent",
  initials: string,
): Html {
  return h.span([h.Class(`actor-avatar actor-avatar--${kind}`)], [initials]);
}

function actorLine(
  h: ReturnType<typeof html<PrototypeMessage>>,
  kind: "human" | "agent",
  time: string,
): Html {
  return h.div([h.Class("actor-line")], [
    avatar(h, kind, kind === "human" ? "DM" : "CC"),
    h.div([], [
      h.div([h.Class("actor-name")], [
        h.strong([], [kind === "human" ? "Dillon Mulroy" : "claude-code · Mac Studio"]),
        h.span([h.Class(`actor-kind actor-kind--${kind}`)], [kind === "human" ? "Human" : "Agent"]),
      ]),
      h.p([], [kind === "human" ? time : `${time} · via pi · upload-retry-7F2`]),
    ]),
  ]);
}

function attachment(
  h: ReturnType<typeof html<PrototypeMessage>>,
  type: "video" | "image" | "log",
  name: string,
  meta: string,
): Html {
  const marks = { video: "▶", image: "▧", log: "≡" } as const;
  return h.a([h.Class(`attachment attachment--${type}`), h.Href(`#${name}`)], [
    h.span([h.Class("attachment-preview")], [marks[type]]),
    h.span([h.Class("attachment-copy")], [
      h.strong([], [name]),
      h.small([], [meta]),
    ]),
    h.span([h.Class("attachment-open")], ["↗"]),
  ]);
}

function issueMarkdown(h: ReturnType<typeof html<PrototypeMessage>>, compact = false): Html {
  return h.div([h.Class(`markdown${compact ? " markdown--compact" : ""}`)], [
    h.p([], [
      "Large uploads restart from zero after a reconnect. Preserve confirmed chunks so contributors can continue without selecting the file again or losing the surrounding comment draft.",
    ]),
    h.h3([], ["Acceptance checks"]),
    h.ul([], [
      h.li([], ["Resume from the last confirmed chunk after reconnecting."]),
      h.li([], ["Keep the comment draft when an upload is retried or cancelled."]),
      h.li([], ["Show progress without posting an event for every chunk."]),
    ]),
    compact ? h.empty : h.blockquote([], ["A failed upload should be recoverable work, not a reason to rewrite the contribution."]),
  ]);
}

function appHeader(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.header([h.Class("app-header")], [
    h.div([h.Class("brand")], [h.span([], ["O"]), h.strong([], ["Overseer"])]),
    h.nav([h.Class("breadcrumbs"), h.AriaLabel("Breadcrumb")], [
      h.span([], ["Personal"]), h.i([], ["/"]), h.span([], ["Attachments"]), h.i([], ["/"]), h.strong([], ["#38"]),
    ]),
    h.div([h.Class("header-actions")], [
      h.span([h.Class("sync-state")], ["● Live"]),
      h.span([h.Class("header-avatar")], ["DM"]),
    ]),
  ]);
}

function issueNavigation(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  const row = (number: string, title: string, selected = false) => h.button([
    h.Class(`nav-issue${selected ? " is-selected" : ""}`),
    h.Type("button"),
  ], [
    h.span([h.Class("open-dot")], ["●"]),
    h.span([], [h.strong([], [title]), h.small([], [`#${number} · attachments`])]),
  ]);
  return h.aside([h.Class("issue-navigation")], [
    h.header([], [
      h.div([], [h.h2([], ["Issues"]), h.p([], ["Attachments · 5 issues"])]),
      staticButton(h, "icon-button", "+"),
    ]),
    h.div([h.Class("nav-filters")], [
      h.span([h.Class("is-active")], ["Open 3"]), h.span([], ["Assigned"]), h.span([], ["Labels"]),
    ]),
    row("42", "Show upload progress in issue comments"),
    row("41", "Reject unsupported file types before upload"),
    row("38", "Add resumable uploads for large attachments", true),
    row("34", "Preserve draft comments after reconnect"),
  ]);
}

function issueHeading(h: ReturnType<typeof html<PrototypeMessage>>, eyebrow?: string): Html {
  return h.header([h.Class("issue-heading")], [
    h.div([h.Class("issue-meta")], [
      h.span([h.Class("status-badge")], ["● Open"]),
      h.span([], ["Issue #38"]),
      eyebrow === undefined ? h.empty : h.span([h.Class("concept-label")], [eyebrow]),
    ]),
    h.div([h.Class("title-row")], [
      h.h1([], ["Add resumable uploads for large attachments"]),
      h.div([], [staticButton(h, "button button--quiet", "Close"), staticButton(h, "button button--primary", "Edit")]),
    ]),
    h.p([h.Class("issue-byline")], [
      "Opened by Dillon 2h ago · ", h.strong([], ["pi/upload-retry-7F2"]), " is assigned",
    ]),
  ]);
}

function composer(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
  placement: "bottom" | "top" | "dock",
): Html {
  const modeButton = (mode: ComposeMode, label: string) => actionButton(
    h,
    model.composeMode === mode ? "compose-tab is-active" : "compose-tab",
    label,
    ChangedComposeMode({ mode }),
  );
  return h.section([h.Class(`composer composer--${placement}`)], [
    h.header([h.Class("composer-header")], [
      h.div([], [avatar(h, "human", "DM"), h.strong([], [placement === "top" ? "Post a progress update" : "Join the conversation"])]),
      h.div([h.Class("compose-tabs")], [modeButton("write", "Write"), modeButton("preview", "Preview")]),
    ]),
    model.composeMode === "write"
      ? Textarea.view<PrototypeMessage>({
        id: `comment-body-${placement}`,
        value: model.comment,
        rows: placement === "dock" ? 3 : 4,
        onInput: (value) => ChangedComment({ value }),
        toView: (attributes) => h.div([], [
          h.label([...attributes.label, h.Class("sr-only")], ["Comment"]),
          h.textarea([...attributes.textarea, h.Class("comment-input")], []),
        ]),
      })
      : h.div([h.Class("comment-preview markdown")], [h.p([], [model.comment.length === 0 ? "Nothing to preview." : model.comment])]),
    h.div([h.Class("upload-draft")], [
      h.span([h.Class("upload-file-icon")], ["▧"]),
      h.div([], [h.strong([], ["reconnect-waterfall.png"]), h.small([], ["482 KB · Ready to include"])]),
      staticButton(h, "remove-file", "×"),
    ]),
    h.footer([h.Class("composer-actions")], [
      h.div([], [staticButton(h, "text-button", "+ Attach file"), h.span([], ["Markdown supported"])]),
      staticButton(h, "button button--primary", placement === "top" ? "Post update" : "Comment"),
    ]),
  ]);
}

function commentCard(
  h: ReturnType<typeof html<PrototypeMessage>>,
  kind: "human" | "agent",
  time: string,
  content: ReadonlyArray<Html>,
  className = "",
): Html {
  return h.article([h.Class(`comment-card ${className}`)], [
    actorLine(h, kind, time),
    h.div([h.Class("comment-body markdown")], content),
    h.footer([], [staticButton(h, "text-button", "Reply"), staticButton(h, "text-button", "•••")]),
  ]);
}

function variantA(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.div([h.Class("variant-layout variant-layout--a")], [
    issueHeading(h, "Conversation-first"),
    h.article([h.Class("opening-post")], [
      actorLine(h, "human", "Opened 2 hours ago"),
      issueMarkdown(h),
      h.div([h.Class("attachment-row")], [attachment(h, "image", "retry-flow.png", "1240 × 760 · 286 KB")]),
      h.footer([], [h.span([], ["Edited 1h ago"]), staticButton(h, "text-button", "Edit description")]),
    ]),
    h.section([h.Class("thread")], [
      h.header([h.Class("section-title")], [h.h2([], ["Conversation"]), h.span([], ["3 comments"])]),
      commentCard(h, "agent", "1 hour ago", [
        h.p([], ["I reproduced the restart by interrupting part 4 of 12. Confirmed part tokens survive in memory but are discarded when the transport reconnects."]),
        attachment(h, "video", "upload-reconnect.mp4", "0:24 · 3.8 MB"),
      ]),
      h.div([h.Class("event-digest")], [
        actionButton(
          h,
          "digest-toggle",
          `${model.digestExpanded ? "▾" : "▸"} 4 changes · 48–31 minutes ago`,
          ToggledDigest(),
          model.digestExpanded ? "Collapse structured changes" : "Expand structured changes",
        ),
        h.span([], ["claim, label, relation, attachment"]),
        model.digestExpanded ? h.div([h.Class("digest-events")], [
          h.p([], [h.time([], ["48m"]), h.span([], ["◎"]), h.strong([], ["claude-code · Mac Studio"]), " claimed as pi/upload-retry-7F2"]),
          h.p([], [h.time([], ["44m"]), h.span([], ["◆"]), h.strong([], ["Dillon Mulroy"]), " added reliability"]),
          h.p([], [h.time([], ["36m"]), h.span([], ["↗"]), h.strong([], ["claude-code · Mac Studio"]), " linked blocker #42"]),
          h.p([], [h.time([], ["31m"]), h.span([], ["↥"]), h.strong([], ["claude-code · Mac Studio"]), " attached upload-reconnect.mp4"]),
        ]) : h.empty,
      ]),
      commentCard(h, "human", "21 minutes ago", [
        h.p([], ["Please preserve the comment draft even when the upload itself is cancelled. The text is the contribution; the file should not hold it hostage."]),
      ]),
      commentCard(h, "agent", "6 minutes ago", [
        h.p([], ["Implemented a retry checkpoint and kept draft state outside the upload lifecycle."]),
        h.pre([], [h.code([], ["8 / 12 chunks confirmed\nretrying chunk 9 · attempt 2"])]),
        attachment(h, "image", "reconnect-waterfall.png", "1440 × 900 · 482 KB"),
      ]),
    ]),
    composer(h, model, "bottom"),
  ]);
}

function logComment(
  h: ReturnType<typeof html<PrototypeMessage>>,
  kind: "human" | "agent",
  time: string,
  content: ReadonlyArray<Html>,
): Html {
  return h.article([h.Class("log-comment")], [
    actorLine(h, kind, time),
    h.div([h.Class("markdown")], content),
  ]);
}

function phase(
  h: ReturnType<typeof html<PrototypeMessage>>,
  title: string,
  time: string,
  summary: string,
  content: ReadonlyArray<Html>,
): Html {
  return h.section([h.Class("work-phase")], [
    h.header([], [
      h.div([], [h.span([h.Class("phase-check")], ["✓"]), h.h2([], [title])]),
      h.time([], [time]),
    ]),
    h.p([h.Class("phase-summary")], [summary]),
    h.div([h.Class("phase-content")], content),
  ]);
}

function variantB(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.div([h.Class("variant-layout variant-layout--b")], [
    issueHeading(h, "Milestone journal"),
    h.div([h.Class("brief-log-layout")], [
      h.aside([h.Class("brief-rail")], [
        h.header([], [h.p([], ["Pinned brief"]), actionButton(h, "text-button", model.briefExpanded ? "Collapse" : "Expand", ToggledBrief())]),
        model.briefExpanded ? h.div([], [issueMarkdown(h, true), attachment(h, "image", "retry-flow.png", "Brief attachment · 286 KB")]) : h.p([h.Class("brief-collapsed")], ["Resume uploads without losing comment drafts."]),
        h.dl([], [
          h.div([], [h.dt([], ["Assignee"]), h.dd([], ["pi/upload-retry-7F2"])]),
          h.div([], [h.dt([], ["Labels"]), h.dd([], [h.span([h.Class("label-chip")], ["attachments"]), h.span([h.Class("label-chip")], ["reliability"])])]),
          h.div([], [h.dt([], ["Blocks"]), h.dd([], [h.a([h.Href("#42")], ["#42 Upload progress"])]),]),
        ]),
      ]),
      h.main([h.Class("work-log")], [
        composer(h, model, "top"),
        h.div([h.Class("log-heading")], [h.h2([], ["Work log"]), h.p([], ["Comments and artifacts grouped by outcome; mechanics summarized in each phase."])]),
        phase(h, "Reproduced", "10:18–10:42", "3 changes · claimed, labelled, linked blocker #42", [
          logComment(h, "agent", "10:31", [h.p([], ["Interrupted part 4 of 12. The server retained completed chunks; reconnect created a fresh local upload session."])]),
          attachment(h, "video", "upload-reconnect.mp4", "Evidence · 0:24 · 3.8 MB"),
        ]),
        phase(h, "Constraint clarified", "10:59", "1 comment · no structured changes", [
          logComment(h, "human", "10:59", [h.p([], ["The draft must survive retry and cancel. Treat the attachment as part of the comment, not as the owner of its text."])]),
        ]),
        phase(h, "Retry checkpoint ready", "11:14–11:32", "5 changes · 2 commits, attachment, status, revision", [
          logComment(h, "agent", "11:28", [
            h.p([], ["Moved draft state above the upload lifecycle. A reconnect now resumes at the first unconfirmed chunk."]),
            h.pre([], [h.code([], ["8 / 12 chunks confirmed · retrying chunk 9"])]),
          ]),
          h.div([h.Class("artifact-strip")], [
            attachment(h, "image", "reconnect-waterfall.png", "Result · 482 KB"),
            attachment(h, "log", "retry-trace.txt", "Diagnostic · 12 KB"),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function changesChannel(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  const event = (icon: string, action: string, actor: string, time: string, detail?: string) => h.li([], [
    h.span([h.Class("change-icon")], [icon]),
    h.div([], [
      h.p([], [h.strong([], [actor]), ` ${action}`]),
      detail === undefined ? h.empty : h.small([], [detail]),
    ]),
    h.time([], [time]),
  ]);
  return h.div([h.Class("changes-channel")], [
    h.div([h.Class("channel-note")], ["Structured history is complete here, but stays out of the default conversation."]),
    h.ol([], [
      event("◎", "claimed this issue", "claude-code · Mac Studio", "48m", "Assignee: pi/upload-retry-7F2"),
      event("◆", "added reliability", "Dillon Mulroy", "44m"),
      event("↗", "linked blocker #42", "claude-code · Mac Studio", "36m", "Show upload progress in issue comments"),
      event("↥", "attached upload-reconnect.mp4", "claude-code · Mac Studio", "31m"),
      event("✎", "edited the issue body", "Dillon Mulroy", "18m", "Revision 12 · compare changes"),
      event("↥", "attached reconnect-waterfall.png", "claude-code · Mac Studio", "6m"),
    ]),
  ]);
}

function filesChannel(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.div([h.Class("files-channel")], [
    h.header([], [h.div([], [h.h2([], ["3 attachments"]), h.p([], ["Files stay in conversational context and are also collected here."])]), staticButton(h, "button button--quiet", "+ Attach file")]),
    h.div([h.Class("file-gallery")], [
      h.article([], [h.div([h.Class("gallery-preview gallery-preview--diagram")], ["Retry flow"]), attachment(h, "image", "retry-flow.png", "Issue description · 286 KB")]),
      h.article([], [h.div([h.Class("gallery-preview gallery-preview--video")], ["▶ 0:24"]), attachment(h, "video", "upload-reconnect.mp4", "Agent comment · 3.8 MB")]),
      h.article([], [h.div([h.Class("gallery-preview gallery-preview--chart")], ["8/12 → 12/12"]), attachment(h, "image", "reconnect-waterfall.png", "Agent comment · 482 KB")]),
    ]),
  ]);
}

function conversationChannel(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.div([h.Class("conversation-channel")], [
    h.div([h.Class("conversation-day")], [h.span([], ["Today"])]),
    commentCard(h, "agent", "1 hour ago", [
      h.p([], ["I reproduced the restart after interrupting part 4. Completed chunk tokens survive on the server but the browser starts a fresh upload session."]),
      attachment(h, "video", "upload-reconnect.mp4", "0:24 · 3.8 MB"),
    ], "comment-card--flat"),
    commentCard(h, "human", "21 minutes ago", [
      h.p([], ["Please preserve the comment draft on both retry and cancel. The attachment should not own the text around it."]),
    ], "comment-card--flat"),
    commentCard(h, "agent", "6 minutes ago", [
      h.p([], ["Done. Draft state now sits outside the upload lifecycle, and reconnect resumes at chunk 9 of 12."]),
      attachment(h, "image", "reconnect-waterfall.png", "1440 × 900 · 482 KB"),
    ], "comment-card--flat"),
    composer(h, model, "dock"),
  ]);
}

function variantC(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const tab = (value: FocusTab, label: string, count?: string) => actionButton(
    h,
    model.focusTab === value ? "channel-tab is-active" : "channel-tab",
    `${label}${count === undefined ? "" : ` ${count}`}`,
    ChangedFocusTab({ tab: value }),
  );
  const channel = model.focusTab === "conversation"
    ? conversationChannel(h, model)
    : model.focusTab === "changes"
      ? changesChannel(h)
      : filesChannel(h);
  return h.div([h.Class("variant-layout variant-layout--c")], [
    issueHeading(h, "Signal-separated"),
    h.section([h.Class("pinned-brief")], [
      h.header([], [
        h.div([], [h.span([], ["▣"]), h.strong([], ["Issue brief"]), h.small([], ["edited 1h ago"])]),
        actionButton(h, "text-button", model.briefExpanded ? "Hide" : "Show", ToggledBrief()),
      ]),
      model.briefExpanded ? h.div([], [issueMarkdown(h, true), h.a([h.Href("#retry-flow.png")], ["▧ retry-flow.png"]),]) : h.empty,
    ]),
    h.nav([h.Class("channel-tabs"), h.AriaLabel("Issue content")], [
      tab("conversation", "Conversation", "3"),
      tab("changes", "Changes", "6"),
      tab("files", "Files", "3"),
    ]),
    h.section([h.Class("channel-content")], [channel]),
  ]);
}

function detailPanel(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const content = model.variant === "A"
    ? variantA(h, model)
    : model.variant === "B"
      ? variantB(h, model)
      : variantC(h, model);
  return h.main([h.Class("detail-panel")], [
    h.div([h.Class("cache-notice")], [h.span([], ["✓ Ready from this device"]), h.span([], ["Synced just now"])]),
    content,
  ]);
}

function appSpecimen(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.div([h.Class("app-frame")], [
    appHeader(h),
    h.div([h.Class("app-workspace")], [issueNavigation(h), detailPanel(h, model)]),
  ]);
}

function prototypeIntro(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const explanations: Readonly<Record<Variant, string>> = {
    A: "Treat the issue body as the opening post, keep comments in one readable thread, and collapse low-signal structured events into expandable digests.",
    B: "Keep the brief pinned beside a work journal, grouping conversation, files, and mechanics into outcome-based phases rather than a literal event stream.",
    C: "Separate conversation, structured changes, and files into focused channels; preserve full history without mixing every event into the default reading path.",
  };
  return h.header([h.Class("prototype-intro")], [
    h.div([], [h.p([], ["Timeline + contribution · Utility theme"]), h.h1([], [`${model.variant} — ${variantNames[model.variant]}`])]),
    h.p([], [explanations[model.variant]]),
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
  return h.nav([h.Class("prototype-switcher"), h.AriaLabel("Timeline prototypes")], [
    actionButton(h, "switcher-arrow", "←", ChangedVariant({ variant: previous }), "Previous variant"),
    h.div([h.Class("switcher-title")], [h.small([], ["TIMELINE MODEL"]), h.strong([], [`${model.variant} — ${variantNames[model.variant]}`])]),
    h.div([h.Class("variant-options")], order.map((variant) => actionButton(
      h,
      variant === model.variant ? "variant-option is-active" : "variant-option",
      variant,
      ChangedVariant({ variant }),
      variantNames[variant],
    ))),
    actionButton(h, "switcher-arrow", "→", ChangedVariant({ variant: next }), "Next variant"),
  ]);
}

function view(model: PrototypeModel): Html {
  const h = html<PrototypeMessage>();
  return h.div([h.Class(`prototype-root variant-${model.variant.toLowerCase()}`)], [
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

/** Embed the throwaway timeline and contribution prototype. */
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
