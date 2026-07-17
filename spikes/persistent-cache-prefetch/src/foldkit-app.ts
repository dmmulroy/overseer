import { Button } from "@foldkit/ui";
import { Effect, Match, Option, Schema } from "effect";
import { Command, Runtime } from "foldkit";
import { html, type Html } from "foldkit/html";
import { m } from "foldkit/message";
import {
  type IssueSnapshot as IssueSnapshotValue,
  IssueSnapshot,
} from "./project-data";
import type { NavigationResult, ProjectSync } from "./project-sync";

const IntentIssue = m("IntentIssue", { issueNumber: Schema.Number });
const NavigateIssue = m("NavigateIssue", { issueNumber: Schema.Number });
const IntentReady = m("IntentReady", { issueNumber: Schema.Number });
const NavigationReady = m("NavigationReady", {
  snapshot: IssueSnapshot,
  source: Schema.String,
  durationMs: Schema.Number,
});
const ReadFailed = m("ReadFailed", { message: Schema.String });

const ProjectMessage = Schema.Union([
  IntentIssue,
  NavigateIssue,
  IntentReady,
  NavigationReady,
  ReadFailed,
]);
type ProjectMessage = typeof ProjectMessage.Type;

const ProjectModel = Schema.Struct({
  selected: Schema.Option(IssueSnapshot),
  status: Schema.String,
  lastSource: Schema.String,
  lastDurationMs: Schema.Number,
});
type ProjectModel = typeof ProjectModel.Type;

function readFailure(
  result: Extract<NavigationResult, { _tag: "NavigationFailed" }>,
): ReturnType<typeof ReadFailed> {
  return ReadFailed({ message: result.error.message });
}

function makeCommands(sync: ProjectSync) {
  const IntentRead = Command.define(
    "IntentRead",
    { issueNumber: Schema.Number },
    IntentReady,
    ReadFailed,
  )(({ issueNumber }) => Effect.promise(async () => {
    const result = await sync.intent(issueNumber);
    return result._tag === "NavigationReady"
      ? IntentReady({ issueNumber })
      : readFailure(result);
  }));

  const NavigateRead = Command.define(
    "NavigateRead",
    { issueNumber: Schema.Number },
    NavigationReady,
    ReadFailed,
  )(({ issueNumber }) => Effect.promise(async () => {
    const result = await sync.navigate(issueNumber);
    return result._tag === "NavigationReady"
      ? NavigationReady({
        snapshot: result.snapshot,
        source: result.source,
        durationMs: result.durationMs,
      })
      : readFailure(result);
  }));
  return { IntentRead, NavigateRead };
}

function projectView(model: ProjectModel): Html {
  const h = html<ProjectMessage>();
  const issueRows = Array.from({ length: 240 }, (_, index) => {
    const issueNumber = index + 1;
    return Button.view<ProjectMessage>({
      onClick: NavigateIssue({ issueNumber }),
      toView: (attributes) => h.button([
        ...attributes.button,
        h.Class("issue-row"),
        h.DataAttribute("issue-number", String(issueNumber)),
        h.OnFocus(IntentIssue({ issueNumber })),
        h.OnPointerDown(() => Option.some(IntentIssue({ issueNumber }))),
      ], [
        h.span([h.Class("issue-number")], [`#${issueNumber}`]),
        h.span([], [`Seeded Issue ${issueNumber}`]),
      ]),
    });
  });
  const selected = Option.match(model.selected, {
    onNone: () => h.article([
      h.Class("issue-detail"),
      h.DataAttribute("selected-issue", "none"),
    ], [
      h.h2([], ["Choose an Issue"]),
      h.p([], ["Cached detail replaces this stable panel without layout shift."]),
    ]),
    onSome: (snapshot: IssueSnapshotValue) => h.article([
      h.Class("issue-detail"),
      h.DataAttribute("selected-issue", String(snapshot.issueNumber)),
    ], [
      h.h2([], [`#${snapshot.issueNumber} ${snapshot.title}`]),
      h.p([], [snapshot.body]),
    ]),
  });
  return h.main([h.Class("shell")], [
    h.header([h.Class("app-header")], [
      h.h1([], ["Overseer persistent-cache spike"]),
      h.p([], [`${model.status}; source=${model.lastSource}; read=${model.lastDurationMs.toFixed(2)}ms`]),
    ]),
    h.div([h.Class("workspace")], [
      h.nav([
        h.Class("issue-list"),
        h.AriaLabel("Seeded Project Issues"),
      ], issueRows),
      selected,
    ]),
  ]);
}

/** Embed the throwaway Foldkit client around the application-owned sync interface. */
export function embedFoldkitClient(container: HTMLElement, sync: ProjectSync): Readonly<{
  dispose: () => void;
}> {
  const commands = makeCommands(sync);
  const program = Runtime.makeElement({
    Model: ProjectModel,
    init: () => [{
      selected: Option.none(),
      status: "ready",
      lastSource: "none",
      lastDurationMs: 0,
    }, []],
    update: (model: ProjectModel, message: ProjectMessage) => Match.value(message).pipe(
      Match.withReturnType<readonly [ProjectModel, ReadonlyArray<Command.Command<ProjectMessage>>]>(),
      Match.tagsExhaustive({
        IntentIssue: ({ issueNumber }) => [
          { ...model, status: `intent #${issueNumber}` },
          [commands.IntentRead({ issueNumber })],
        ],
        NavigateIssue: ({ issueNumber }) => [
          { ...model, status: `navigating #${issueNumber}` },
          [commands.NavigateRead({ issueNumber })],
        ],
        IntentReady: ({ issueNumber }) => [
          { ...model, status: `prefetched #${issueNumber}` },
          [],
        ],
        NavigationReady: ({ snapshot, source, durationMs }) => [
          {
            ...model,
            selected: Option.some(snapshot),
            status: `showing #${snapshot.issueNumber}`,
            lastSource: source,
            lastDurationMs: durationMs,
          },
          [],
        ],
        ReadFailed: ({ message: failureMessage }) => [
          { ...model, status: failureMessage },
          [],
        ],
      }),
    ),
    view: projectView,
    container,
    crash: {
      report: ({ error }) => console.error("Foldkit runtime crash", error),
    },
    devTools: false,
    slow: false,
  });
  const handle = Runtime.embed(program);
  return { dispose: handle.dispose };
}
