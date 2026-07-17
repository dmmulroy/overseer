import { Button } from "@foldkit/ui";
import { Match, Schema } from "effect";
import { Runtime, type Command } from "foldkit";
import { html, type Html } from "foldkit/html";
import { m } from "foldkit/message";

// PROTOTYPE — Three materially different issue-finding and navigation
// structures, switchable via ?variant=, on /prototype/issue-discovery.
// All directions use the previously selected Utility visual language.

const VariantSchema = Schema.Union([
  Schema.Literal("A"),
  Schema.Literal("B"),
  Schema.Literal("C"),
]);
const ContextSchema = Schema.Union([
  Schema.Literal("personal-overseer"),
  Schema.Literal("personal-household"),
  Schema.Literal("studio-launchpad"),
]);
const StateFilterSchema = Schema.Union([
  Schema.Literal("open"),
  Schema.Literal("all"),
  Schema.Literal("closed"),
]);
const AssigneeFilterSchema = Schema.Union([
  Schema.Literal("any"),
  Schema.Literal("me"),
  Schema.Literal("unassigned"),
]);
const LabelFilterSchema = Schema.Union([
  Schema.Literal("any"),
  Schema.Literal("frontend"),
  Schema.Literal("reliability"),
  Schema.Literal("api"),
]);
const IssueNumberSchema = Schema.Union([
  Schema.Literal(47),
  Schema.Literal(44),
  Schema.Literal(38),
  Schema.Literal(35),
  Schema.Literal(21),
  Schema.Literal(18),
  Schema.Literal(12),
  Schema.Literal(9),
  Schema.Literal(6),
]);
const TransitionSourceSchema = Schema.Union([
  Schema.Literal("device-cache"),
  Schema.Literal("prefetched"),
  Schema.Literal("network"),
]);

const ChangedVariant = m("ChangedVariant", { variant: VariantSchema });
const ToggledContextMenu = m("ToggledContextMenu");
const ChangedContext = m("ChangedContext", { context: ContextSchema });
const ChangedStateFilter = m("ChangedStateFilter");
const ChangedAssigneeFilter = m("ChangedAssigneeFilter");
const ChangedLabelFilter = m("ChangedLabelFilter");
const ResetFilters = m("ResetFilters");
const WarmedIssue = m("WarmedIssue", { issueNumber: IssueNumberSchema });
const SelectedIssue = m("SelectedIssue", { issueNumber: IssueNumberSchema });
const ReturnedToList = m("ReturnedToList");
const ToggledFilters = m("ToggledFilters");

const PrototypeMessage = Schema.Union([
  ChangedVariant,
  ToggledContextMenu,
  ChangedContext,
  ChangedStateFilter,
  ChangedAssigneeFilter,
  ChangedLabelFilter,
  ResetFilters,
  WarmedIssue,
  SelectedIssue,
  ReturnedToList,
  ToggledFilters,
]);
type PrototypeMessage = typeof PrototypeMessage.Type;

const PrototypeModel = Schema.Struct({
  variant: VariantSchema,
  context: ContextSchema,
  stateFilter: StateFilterSchema,
  assigneeFilter: AssigneeFilterSchema,
  labelFilter: LabelFilterSchema,
  selectedIssue: IssueNumberSchema,
  warmedIssue: Schema.NullOr(IssueNumberSchema),
  transitionSource: TransitionSourceSchema,
  contextMenuOpen: Schema.Boolean,
  mobileDetailOpen: Schema.Boolean,
  filtersExpanded: Schema.Boolean,
});
type PrototypeModel = typeof PrototypeModel.Type;
type Variant = PrototypeModel["variant"];
type ContextId = PrototypeModel["context"];
type IssueNumber = PrototypeModel["selectedIssue"];

type SeedIssue = Readonly<{
  number: IssueNumber;
  context: ContextId;
  title: string;
  state: "open" | "closed";
  assignee: "me" | "agent" | "unassigned";
  assigneeLabel: string;
  labels: ReadonlyArray<"frontend" | "reliability" | "api" | "attachments" | "planning">;
  updated: string;
  comments: number;
  cache: "cached" | "remote";
  summary: string;
}>;

const issueOrder: ReadonlyArray<IssueNumber> = [47, 44, 38, 35, 21, 18, 12, 9, 6];
const issues: Readonly<Record<IssueNumber, SeedIssue>> = {
  47: {
    number: 47,
    context: "personal-overseer",
    title: "Keep issue filters in the URL",
    state: "open",
    assignee: "me",
    assigneeLabel: "You",
    labels: ["frontend"],
    updated: "8m",
    comments: 3,
    cache: "cached",
    summary: "Make state, assignee, and label filters shareable without introducing a query language.",
  },
  44: {
    number: 44,
    context: "personal-overseer",
    title: "Recover project stream after a cursor gap",
    state: "open",
    assignee: "agent",
    assigneeLabel: "claude-code/sync-repair",
    labels: ["reliability", "api"],
    updated: "23m",
    comments: 7,
    cache: "remote",
    summary: "Repair from the retained project change sequence before replacing local state with a snapshot.",
  },
  38: {
    number: 38,
    context: "personal-overseer",
    title: "Add resumable uploads for large attachments",
    state: "open",
    assignee: "unassigned",
    assigneeLabel: "Unassigned",
    labels: ["attachments", "reliability"],
    updated: "1h",
    comments: 12,
    cache: "cached",
    summary: "Continue interrupted multipart uploads while preserving the contributor’s comment draft.",
  },
  35: {
    number: 35,
    context: "personal-overseer",
    title: "Document the Project Durable Object boundary",
    state: "closed",
    assignee: "me",
    assigneeLabel: "You",
    labels: ["planning", "api"],
    updated: "Tue",
    comments: 5,
    cache: "remote",
    summary: "Record the consistency, transaction, and realtime responsibilities owned by each Project.",
  },
  21: {
    number: 21,
    context: "personal-household",
    title: "Replace the hallway smoke detector",
    state: "open",
    assignee: "unassigned",
    assigneeLabel: "Unassigned",
    labels: ["planning"],
    updated: "2d",
    comments: 1,
    cache: "cached",
    summary: "Pick up a sealed ten-year detector and replace the expired unit outside the guest room.",
  },
  18: {
    number: 18,
    context: "personal-household",
    title: "Compare electricity plans before renewal",
    state: "open",
    assignee: "me",
    assigneeLabel: "You",
    labels: ["planning"],
    updated: "4d",
    comments: 4,
    cache: "remote",
    summary: "Compare fixed-rate offers against the current plan before the renewal window closes.",
  },
  12: {
    number: 12,
    context: "studio-launchpad",
    title: "Publish the beta onboarding checklist",
    state: "open",
    assignee: "me",
    assigneeLabel: "You",
    labels: ["frontend", "planning"],
    updated: "14m",
    comments: 8,
    cache: "cached",
    summary: "Give beta teams one concise path from invite acceptance to their first completed setup.",
  },
  9: {
    number: 9,
    context: "studio-launchpad",
    title: "Return field-level errors from token exchange",
    state: "open",
    assignee: "agent",
    assigneeLabel: "codex/auth-errors",
    labels: ["api", "reliability"],
    updated: "41m",
    comments: 6,
    cache: "remote",
    summary: "Preserve actionable OAuth failure details at the API boundary without leaking provider payloads.",
  },
  6: {
    number: 6,
    context: "studio-launchpad",
    title: "Tighten mobile spacing in account setup",
    state: "closed",
    assignee: "unassigned",
    assigneeLabel: "Unassigned",
    labels: ["frontend"],
    updated: "Fri",
    comments: 2,
    cache: "cached",
    summary: "Keep the setup form readable at 320 px without hiding the current step or primary action.",
  },
};

type ContextOption = Readonly<{
  id: ContextId;
  workspace: string;
  project: string;
  shortWorkspace: string;
  issueCount: number;
}>;

const contexts: readonly [ContextOption, ContextOption, ContextOption] = [
  { id: "personal-overseer", workspace: "Personal", project: "Overseer", shortWorkspace: "P", issueCount: 4 },
  { id: "personal-household", workspace: "Personal", project: "Household", shortWorkspace: "P", issueCount: 2 },
  { id: "studio-launchpad", workspace: "Northstar Studio", project: "Launchpad", shortWorkspace: "N", issueCount: 3 },
];

const variantNames: Readonly<Record<Variant, string>> = {
  A: "Navigator",
  B: "Index + inspector",
  C: "Focused route",
};

function variantFromUrl(): Variant {
  const value = new URL(window.location.href).searchParams.get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function writeVariantToUrl(variant: Variant): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/issue-discovery";
  url.searchParams.set("variant", variant);
  window.history.replaceState({}, "", url);
}

function initialModel(): PrototypeModel {
  const variant = variantFromUrl();
  writeVariantToUrl(variant);
  return {
    variant,
    context: "personal-overseer",
    stateFilter: "open",
    assigneeFilter: "any",
    labelFilter: "any",
    selectedIssue: 47,
    warmedIssue: null,
    transitionSource: "device-cache",
    contextMenuOpen: false,
    mobileDetailOpen: false,
    filtersExpanded: false,
  };
}

function firstIssueForContext(context: ContextId): IssueNumber {
  if (context === "personal-household") return 21;
  if (context === "studio-launchpad") return 12;
  return 47;
}

function nextStateFilter(value: PrototypeModel["stateFilter"]): PrototypeModel["stateFilter"] {
  if (value === "open") return "all";
  if (value === "all") return "closed";
  return "open";
}

function nextAssigneeFilter(value: PrototypeModel["assigneeFilter"]): PrototypeModel["assigneeFilter"] {
  if (value === "any") return "me";
  if (value === "me") return "unassigned";
  return "any";
}

function nextLabelFilter(value: PrototypeModel["labelFilter"]): PrototypeModel["labelFilter"] {
  if (value === "any") return "frontend";
  if (value === "frontend") return "reliability";
  if (value === "reliability") return "api";
  return "any";
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
        return [{ ...model, variant, contextMenuOpen: false, mobileDetailOpen: false }, []];
      },
      ToggledContextMenu: () => [{ ...model, contextMenuOpen: !model.contextMenuOpen }, []],
      ChangedContext: ({ context }) => [{
        ...model,
        context,
        selectedIssue: firstIssueForContext(context),
        warmedIssue: null,
        transitionSource: "network",
        contextMenuOpen: false,
        mobileDetailOpen: false,
        stateFilter: "open",
        assigneeFilter: "any",
        labelFilter: "any",
      }, []],
      ChangedStateFilter: () => [{ ...model, stateFilter: nextStateFilter(model.stateFilter) }, []],
      ChangedAssigneeFilter: () => [{ ...model, assigneeFilter: nextAssigneeFilter(model.assigneeFilter) }, []],
      ChangedLabelFilter: () => [{ ...model, labelFilter: nextLabelFilter(model.labelFilter) }, []],
      ResetFilters: () => [{
        ...model,
        stateFilter: "open",
        assigneeFilter: "any",
        labelFilter: "any",
      }, []],
      WarmedIssue: ({ issueNumber }) => [{ ...model, warmedIssue: issueNumber }, []],
      SelectedIssue: ({ issueNumber }) => {
        const issue = issues[issueNumber];
        const transitionSource = model.warmedIssue === issueNumber
          ? "prefetched"
          : issue.cache === "cached" ? "device-cache" : "network";
        return [{ ...model, selectedIssue: issueNumber, transitionSource, mobileDetailOpen: true }, []];
      },
      ReturnedToList: () => [{ ...model, mobileDetailOpen: false }, []],
      ToggledFilters: () => [{ ...model, filtersExpanded: !model.filtersExpanded }, []],
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

function currentContext(model: PrototypeModel) {
  return contexts.find((context) => context.id === model.context) ?? contexts[0];
}

function visibleIssues(model: PrototypeModel): ReadonlyArray<SeedIssue> {
  return issueOrder
    .map((number) => issues[number])
    .filter((issue) => issue.context === model.context)
    .filter((issue) => model.stateFilter === "all" || issue.state === model.stateFilter)
    .filter((issue) => model.assigneeFilter === "any" || issue.assignee === model.assigneeFilter)
    .filter((issue) => model.labelFilter === "any" || issue.labels.includes(model.labelFilter));
}

function contextPicker(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
  compact = false,
): Html {
  const context = currentContext(model);
  return h.div([h.Class(`context-picker${compact ? " context-picker--compact" : ""}`)], [
    button(
      h,
      "context-trigger",
      `${context.shortWorkspace}  ${context.workspace} / ${context.project}  ▾`,
      ToggledContextMenu(),
      "Switch workspace or project",
    ),
    model.contextMenuOpen ? h.div([h.Class("context-menu")], [
      h.small([], ["WORKSPACES & PROJECTS"]),
      ...contexts.map((option) => button(
        h,
        `context-option${option.id === model.context ? " is-active" : ""}`,
        `${option.workspace}  /  ${option.project}    ${option.issueCount}`,
        ChangedContext({ context: option.id }),
      )),
    ]) : h.empty,
  ]);
}

function utilityHeader(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
  contextInHeader: boolean,
): Html {
  return h.header([h.Class("utility-header")], [
    h.div([h.Class("brand")], [h.span([], ["O"]), h.strong([], ["Overseer"])]),
    contextInHeader ? contextPicker(h, model, true) : h.div([h.Class("route-label")], ["Issues"]),
    h.div([h.Class("sync-summary")], [
      h.span([], ["●"]),
      h.strong([], ["12 ready offline"]),
      h.small([], ["synced 18s ago"]),
    ]),
    h.span([h.Class("avatar")], ["DM"]),
  ]);
}

function filterControls(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
  className = "filter-controls",
): Html {
  const stateLabels = { open: "Open", all: "Any state", closed: "Closed" } as const;
  const assigneeLabels = { any: "Anyone", me: "You", unassigned: "Unassigned" } as const;
  const labelLabels = { any: "Any label", frontend: "frontend", reliability: "reliability", api: "api" } as const;
  const isFiltered = model.stateFilter !== "open" || model.assigneeFilter !== "any" || model.labelFilter !== "any";
  return h.div([h.Class(className)], [
    h.small([h.Class("filter-prefix")], ["FILTER"]),
    button(h, "filter-chip", `State: ${stateLabels[model.stateFilter]}  ▾`, ChangedStateFilter()),
    button(h, "filter-chip", `Assignee: ${assigneeLabels[model.assigneeFilter]}  ▾`, ChangedAssigneeFilter()),
    button(h, "filter-chip", `Label: ${labelLabels[model.labelFilter]}  ▾`, ChangedLabelFilter()),
    isFiltered ? button(h, "clear-filter", "Reset", ResetFilters()) : h.empty,
  ]);
}

function cacheBadge(
  h: ReturnType<typeof html<PrototypeMessage>>,
  issue: SeedIssue,
  warmed: boolean,
): Html {
  if (warmed) return h.span([h.Class("cache-badge cache-badge--warm")], ["↗ prefetched"]);
  if (issue.cache === "cached") return h.span([h.Class("cache-badge")], ["✓ cached"]);
  return h.span([h.Class("cache-badge cache-badge--muted")], ["on demand"]);
}

function issueRow(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
  issue: SeedIssue,
  shape: "card" | "table" | "focus",
): Html {
  const selected = model.selectedIssue === issue.number;
  const warmed = model.warmedIssue === issue.number;
  return h.button([
    h.Class(`issue-row issue-row--${shape}${selected ? " is-selected" : ""}`),
    h.Type("button"),
    h.OnClick(SelectedIssue({ issueNumber: issue.number })),
    h.OnMouseEnter(WarmedIssue({ issueNumber: issue.number })),
    h.OnFocus(WarmedIssue({ issueNumber: issue.number })),
    h.Title(`Open #${issue.number}; hover or focus prefetched this issue`),
  ], [
    h.span([h.Class(`state-mark state-mark--${issue.state}`)], [issue.state === "open" ? "○" : "✓"]),
    h.span([h.Class("issue-identity")], [
      h.strong([], [issue.title]),
      h.span([h.Class("issue-meta-mobile")], [`#${issue.number} · ${issue.assigneeLabel}`]),
    ]),
    h.span([h.Class("issue-number")], [`#${issue.number}`]),
    h.span([h.Class("issue-labels")], issue.labels.slice(0, 2).map((label) => h.i([], [label]))),
    h.span([h.Class("issue-assignee")], [issue.assigneeLabel]),
    h.span([h.Class("issue-comments")], [`◌ ${issue.comments}`]),
    h.time([], [issue.updated]),
    cacheBadge(h, issue, warmed),
  ]);
}

function emptyIssues(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.div([h.Class("empty-issues")], [
    h.strong([], ["No issues match"]),
    h.p([], ["Change one of the structured filters—nothing is hidden behind query syntax."]),
    button(h, "button button--quiet", "Reset filters", ResetFilters()),
  ]);
}

function prefetchNotice(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  if (model.warmedIssue === null) {
    return h.div([h.Class("prefetch-notice")], ["Move across a row to prefetch its detail"]);
  }
  const issue = issues[model.warmedIssue];
  return h.div([h.Class("prefetch-notice is-warm")], [
    h.span([], ["↗"]),
    h.strong([], [`#${issue.number} prefetched`]),
    h.span([], ["Detail is ready before selection"]),
  ]);
}

function detailPanel(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
  className = "issue-detail",
): Html {
  const issue = issues[model.selectedIssue];
  const sourceCopy = {
    "device-cache": ["Ready from this device", "Opened immediately from the local read-through cache"],
    prefetched: ["Opened from prefetch", "The row was warmed before selection · 0 ms transition"],
    network: ["Fetched on demand", "Stored locally for the next visit"],
  } as const;
  const source = sourceCopy[model.transitionSource];
  return h.article([h.Class(className)], [
    h.header([h.Class("detail-status")], [
      h.span([], [model.transitionSource === "network" ? "↓" : "✓"]),
      h.div([], [h.strong([], [source[0]]), h.small([], [source[1]])]),
    ]),
    h.div([h.Class("detail-body")], [
      button(h, "back-button", "← Issues", ReturnedToList()),
      h.div([h.Class("detail-kicker")], [
        h.span([h.Class(`state-pill state-pill--${issue.state}`)], [issue.state]),
        h.span([], [`${currentContext(model).project} #${issue.number}`]),
        h.time([], [`updated ${issue.updated} ago`]),
      ]),
      h.h1([], [issue.title]),
      h.p([h.Class("detail-summary")], [issue.summary]),
      h.div([h.Class("detail-facts")], [
        h.div([], [h.small([], ["ASSIGNEE"]), h.strong([], [issue.assigneeLabel])]),
        h.div([], [h.small([], ["LABELS"]), h.strong([], [issue.labels.join(" · ")])]),
        h.div([], [h.small([], ["TIMELINE"]), h.strong([], [`${issue.comments} comments`])]),
      ]),
      h.section([h.Class("detail-preview")], [
        h.h2([], ["Latest activity"]),
        h.p([], ["claude-code/sync-repair commented 23 minutes ago"]),
        h.blockquote([], ["I’ve reproduced the reconnect path and am checking the retained cursor before applying the repair batch."]),
      ]),
      h.footer([h.Class("detail-actions")], [
        h.span([], ["Full issue route keeps list filters in the URL"]),
        h.button([h.Class("button button--primary"), h.Type("button")], ["Open full issue  →"]),
      ]),
    ]),
  ]);
}

function projectRail(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  return h.aside([h.Class("project-rail")], [
    h.header([], [h.small([], ["WORKSPACES"]), h.button([h.Type("button")], ["+"])]),
    h.div([h.Class("workspace-group")], [
      h.strong([], ["P  Personal"]),
      ...contexts.filter((context) => context.workspace === "Personal").map((context) => button(
        h,
        `project-link${context.id === model.context ? " is-active" : ""}`,
        `${context.project}  ${context.issueCount}`,
        ChangedContext({ context: context.id }),
      )),
    ]),
    h.div([h.Class("workspace-group")], [
      h.strong([], ["N  Northstar Studio"]),
      ...contexts.filter((context) => context.workspace === "Northstar Studio").map((context) => button(
        h,
        `project-link${context.id === model.context ? " is-active" : ""}`,
        `${context.project}  ${context.issueCount}`,
        ChangedContext({ context: context.id }),
      )),
    ]),
    h.footer([], [h.span([], ["●"]), " All changes synced"]),
  ]);
}

function variantNavigator(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const context = currentContext(model);
  const filtered = visibleIssues(model);
  return h.div([h.Class(`app-shell variant-a${model.mobileDetailOpen ? " mobile-detail-open" : ""}`)], [
    utilityHeader(h, model, false),
    h.div([h.Class("navigator-layout")], [
      projectRail(h, model),
      h.main([h.Class("issue-pane")], [
        h.div([h.Class("mobile-context-picker")], [contextPicker(h, model)]),
        h.header([h.Class("pane-heading")], [
          h.div([], [h.small([], [context.workspace]), h.h1([], [context.project]), h.p([], [`${context.issueCount} issues · project activity live`])]),
          h.button([h.Class("new-issue"), h.Type("button")], ["+ New"]),
        ]),
        filterControls(h, model),
        h.div([h.Class("result-summary")], [
          h.strong([], [`${filtered.length} ${filtered.length === 1 ? "issue" : "issues"}`]),
          h.span([], ["Updated"]),
        ]),
        h.div([h.Class("card-list")], filtered.length === 0
          ? [emptyIssues(h)]
          : filtered.map((issue) => issueRow(h, model, issue, "card"))),
        prefetchNotice(h, model),
      ]),
      detailPanel(h, model),
    ]),
  ]);
}

function tableHeading(h: ReturnType<typeof html<PrototypeMessage>>): Html {
  return h.div([h.Class("table-heading")], [
    h.span([], ["STATUS"]),
    h.span([], ["ISSUE"]),
    h.span([], ["ID"]),
    h.span([], ["LABELS"]),
    h.span([], ["ASSIGNEE"]),
    h.span([], ["ACTIVITY"]),
  ]);
}

function variantIndex(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const context = currentContext(model);
  const filtered = visibleIssues(model);
  return h.div([h.Class(`app-shell variant-b${model.mobileDetailOpen ? " mobile-detail-open" : ""}`)], [
    utilityHeader(h, model, true),
    h.main([h.Class("index-page")], [
      h.header([h.Class("index-heading")], [
        h.div([], [h.p([], [`${context.workspace} / ${context.project}`]), h.h1([], ["Issues"])]),
        h.div([h.Class("index-actions")], [
          h.span([], ["Updated just now"]),
          h.button([h.Class("button button--primary"), h.Type("button")], ["New issue"]),
        ]),
      ]),
      h.section([h.Class("index-filter-bar")], [
        filterControls(h, model),
        h.strong([], [`${filtered.length} results`]),
      ]),
      h.div([h.Class("index-layout")], [
        h.section([h.Class("issue-index")], [
          tableHeading(h),
          h.div([h.Class("table-list")], filtered.length === 0
            ? [emptyIssues(h)]
            : filtered.map((issue) => issueRow(h, model, issue, "table"))),
          prefetchNotice(h, model),
        ]),
        detailPanel(h, model, "issue-inspector"),
      ]),
    ]),
  ]);
}

function variantFocused(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const context = currentContext(model);
  const filtered = visibleIssues(model);
  return h.div([h.Class(`app-shell variant-c${model.mobileDetailOpen ? " is-on-detail" : ""}`)], [
    utilityHeader(h, model, false),
    h.main([h.Class("focused-page")], [
      h.header([h.Class("focused-context")], [
        contextPicker(h, model),
        h.button([h.Class("icon-new"), h.Type("button")], ["+"]),
      ]),
      model.mobileDetailOpen
        ? detailPanel(h, model, "focused-detail")
        : h.section([h.Class("focused-list")], [
          h.header([h.Class("focused-heading")], [
            h.div([], [h.p([], [context.workspace]), h.h1([], [`${context.project} issues`])]),
            button(
              h,
              `filter-toggle${model.filtersExpanded ? " is-active" : ""}`,
              model.filtersExpanded ? "Hide filters" : "Filter",
              ToggledFilters(),
            ),
          ]),
          model.filtersExpanded ? filterControls(h, model, "focus-filters") : h.div([h.Class("filter-summary")], [
            h.span([], [`State: ${model.stateFilter}`]),
            h.span([], [`${filtered.length} results`]),
          ]),
          h.div([h.Class("focus-rows")], filtered.length === 0
            ? [emptyIssues(h)]
            : filtered.map((issue) => issueRow(h, model, issue, "focus"))),
          prefetchNotice(h, model),
          h.footer([h.Class("focused-footer")], ["Selection opens one focused route. Browser Back returns to these filters."]),
        ]),
    ]),
  ]);
}

function prototypeIntro(
  h: ReturnType<typeof html<PrototypeMessage>>,
  model: PrototypeModel,
): Html {
  const descriptions: Readonly<Record<Variant, string>> = {
    A: "Persistent workspace rail, issue queue, and ready detail make context and selection continuously visible.",
    B: "A dense project index keeps comparison primary and opens the current issue in a compact inspector.",
    C: "One calm surface at a time: choose context, narrow the list, then navigate into a focused issue route.",
  };
  return h.header([h.Class("prototype-intro")], [
    h.div([], [h.p([], ["ISSUE DISCOVERY / UTILITY THEME"]), h.h1([], [`${model.variant} — ${variantNames[model.variant]}`])]),
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
  return h.nav([h.Class("prototype-switcher"), h.AriaLabel("Prototype directions")], [
    button(h, "switcher-arrow", "←", ChangedVariant({ variant: previous }), "Previous direction"),
    h.div([h.Class("switcher-title")], [h.small([], ["DIRECTION"]), h.strong([], [`${model.variant} — ${variantNames[model.variant]}`])]),
    h.div([h.Class("variant-options")], order.map((variant) => button(
      h,
      variant === model.variant ? "variant-option is-active" : "variant-option",
      variant,
      ChangedVariant({ variant }),
      variantNames[variant],
    ))),
    button(h, "switcher-arrow", "→", ChangedVariant({ variant: next }), "Next direction"),
  ]);
}

function view(model: PrototypeModel): Html {
  const h = html<PrototypeMessage>();
  const specimen = model.variant === "A"
    ? variantNavigator(h, model)
    : model.variant === "B" ? variantIndex(h, model) : variantFocused(h, model);
  return h.div([h.Class("prototype-root")], [
    h.div([h.Class("prototype-canvas")], [prototypeIntro(h, model), specimen]),
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

/** Embed the throwaway issue discovery and navigation prototype. */
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
