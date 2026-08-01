import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createIssueMutation,
  makeIssueListQuery,
  type BrowserIssueListQuery,
} from "../../../adapters/web-client/api-resources.ts";
import type {
  IssueCollection,
  ProjectResponse,
  WorkspaceResponse,
} from "../../../contract/http-api.ts";
import { LabelId, type ProjectId } from "../../../domain/entity-id.ts";
import { IdempotencyKey } from "../../../domain/idempotency.ts";
import { Assignee, IssueBody, IssueTitle } from "../../../domain/issue.ts";
import { IssueCursor, IssuePageLimit } from "../../../domain/pagination.ts";
import { Button } from "../../../ui/primitives/button.tsx";
import { completeIssueListSearch, type IssueListSearch } from "../../issue-list-search.ts";

function Eyebrow(props: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
      {props.children}
    </p>
  );
}

type MutableIssueListQuery = {
  -readonly [Key in keyof BrowserIssueListQuery]?: BrowserIssueListQuery[Key];
};

function browserIssueListQuery(
  search: IssueListSearch,
  labelIds: ReadonlyArray<LabelId>,
): BrowserIssueListQuery {
  const query: MutableIssueListQuery = {};
  if (search.state !== undefined) query.state = search.state;
  if (search.lifecycle !== undefined) query.lifecycle = search.lifecycle;
  if (search.assignee !== undefined) query.assignee = search.assignee;
  if (search.assignee_status !== undefined) query.assignee_status = search.assignee_status;
  if (labelIds.length > 0) query.label_id = labelIds;
  if (search.label_match !== undefined) query.label_match = search.label_match;
  if (search.parent !== undefined) query.parent = search.parent;
  if (search.blocking_status !== undefined) query.blocking_status = search.blocking_status;
  if (search.number !== undefined) query.number = search.number;
  if (search.sort !== undefined) query.sort = search.sort;
  if (search.direction !== undefined) query.direction = search.direction;
  if (search.cursor !== undefined) query.cursor = search.cursor;
  if (search.limit !== undefined) query.limit = search.limit;
  return query;
}

function CreateIssueForm(props: { readonly projectId: ProjectId }): React.JSX.Element {
  const command = useAtomValue(createIssueMutation);
  const createIssue = useAtomSet(createIssueMutation);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const created = AsyncResult.value(command);

  useEffect(() => {
    if (Option.isNone(created)) return;
    void navigate({
      to: "/issues/$issueId",
      params: { issueId: created.value.id },
      search: (previous) => completeIssueListSearch(previous),
    });
  }, [created, navigate]);

  return (
    <form
      className="mt-8 grid gap-3 border-t pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        const parsedTitle = Schema.decodeUnknownOption(IssueTitle)(title);
        const parsedBody =
          body.length === 0
            ? Option.none<IssueBody>()
            : Schema.decodeUnknownOption(IssueBody)(body);
        if (Option.isNone(parsedTitle) || (body.length > 0 && Option.isNone(parsedBody))) return;
        createIssue({
          params: { project_id: props.projectId },
          headers: {
            "content-type": "application/json",
            "idempotency-key": IdempotencyKey.make(`browser-issue-${crypto.randomUUID()}`),
          },
          payload: {
            title: parsedTitle.value,
            body: Option.getOrUndefined(parsedBody),
          },
        });
      }}
    >
      <Eyebrow>Create Issue</Eyebrow>
      <label className="grid gap-1.5 text-sm">
        <span>Title</span>
        <input
          className="h-8 rounded-md border bg-surface-raised px-2"
          name="title"
          onChange={(event) => setTitle(event.currentTarget.value)}
          required
          value={title}
        />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span>Body (Markdown, optional)</span>
        <textarea
          className="min-h-24 rounded-md border bg-surface-raised p-2"
          name="body"
          onChange={(event) => setBody(event.currentTarget.value)}
          value={body}
        />
      </label>
      <Button disabled={command.waiting} type="submit">
        {command.waiting ? "Creating…" : "Create Issue"}
      </Button>
      {AsyncResult.isFailure(command) ? (
        <p className="text-sm text-destructive" role="alert">
          The Issue could not be created. Review the fields and try again.
        </p>
      ) : null}
    </form>
  );
}

/** Render one dense URL-owned Project Issue page with discrete filters and pagination. */
export function ProjectIssueList(props: {
  readonly project: ProjectResponse;
  readonly refreshProjects: () => void;
  readonly workspace: WorkspaceResponse;
}): React.JSX.Element {
  const navigate = useNavigate({ from: "/" });
  const search = useSearch({ from: "__root__" });
  const labelIds =
    search.label_id === undefined
      ? []
      : Array.isArray(search.label_id)
        ? search.label_id
        : [search.label_id];
  const query = useMemo<BrowserIssueListQuery>(
    () => browserIssueListQuery(search, labelIds),
    [
      search.assignee,
      search.assignee_status,
      search.blocking_status,
      search.cursor,
      search.direction,
      search.label_match,
      search.lifecycle,
      search.limit,
      search.number,
      search.parent,
      search.sort,
      search.state,
      labelIds.join(","),
    ],
  );
  const [assigneeFilter, setAssigneeFilter] = useState(query.assignee ?? "");
  const [labelFilter, setLabelFilter] = useState(labelIds[0] ?? "");
  useEffect(() => setAssigneeFilter(query.assignee ?? ""), [query.assignee]);
  useEffect(() => setLabelFilter(labelIds[0] ?? ""), [labelIds.join(",")]);
  const pageAtom = useMemo(
    () => makeIssueListQuery(props.project.id, query),
    [props.project.id, query],
  );
  const pageState = useAtomValue(pageAtom);
  const refresh = useAtomRefresh(pageAtom);
  const collection = Option.filter(
    AsyncResult.value(pageState),
    (value): value is IssueCollection => value !== undefined,
  );
  const setFilter = useCallback(
    (
      change:
        | { readonly state: "open" | "closed" | "all" }
        | { readonly assignee_status: "assigned" | "unassigned" | "any" }
        | { readonly blocking_status: "blocked" | "unblocked" | "any" },
    ) => {
      void navigate({
        to: "/",
        search: (previous) =>
          completeIssueListSearch({ ...previous, ...change, cursor: undefined }),
      });
    },
    [navigate],
  );
  const setExactAssignee = useCallback(
    (value: string) => {
      const assignee = Schema.decodeUnknownOption(Assignee)(value);
      if (value.length > 0 && Option.isNone(assignee)) return;
      void navigate({
        to: "/",
        search: (previous) =>
          completeIssueListSearch({
            ...previous,
            assignee: Option.getOrUndefined(assignee),
            assignee_status: Option.isSome(assignee) ? "assigned" : "any",
            cursor: undefined,
          }),
      });
    },
    [navigate],
  );
  const setLabel = useCallback(
    (value: string) => {
      const labelId = Schema.decodeUnknownOption(LabelId)(value);
      if (value.length > 0 && Option.isNone(labelId)) return;
      void navigate({
        to: "/",
        search: (previous) =>
          completeIssueListSearch({
            ...previous,
            label_id: Option.getOrUndefined(labelId),
            label_match: Option.isSome(labelId) ? "any" : undefined,
            cursor: undefined,
          }),
      });
    },
    [navigate],
  );
  const followPage = useCallback(
    (href: string) => {
      const cursor = Schema.decodeUnknownOption(IssueCursor)(
        new URL(href, window.location.origin).searchParams.get("cursor"),
      );
      if (Option.isNone(cursor)) return;
      void navigate({
        to: "/",
        search: (previous) =>
          completeIssueListSearch({
            ...previous,
            state: query.state ?? "open",
            lifecycle: query.lifecycle ?? "live",
            assignee_status: query.assignee_status ?? "any",
            blocking_status: query.blocking_status ?? "any",
            sort: query.sort ?? "updated_at",
            direction: query.direction ?? "desc",
            limit: query.limit ?? IssuePageLimit.make(50),
            cursor: cursor.value,
          }),
      });
    },
    [navigate, query],
  );

  return (
    <section className="issue-list-route w-full max-w-5xl self-start rounded-md border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>{props.workspace.name} Workspace</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight">{props.project.name} Issues</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Structured filters and the exact page are preserved in this URL.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={refresh} size="sm" variant="outline">
            Refresh Issues
          </Button>
          <Button onClick={props.refreshProjects} size="sm" variant="outline">
            Refresh Projects
          </Button>
        </div>
      </div>

      <div
        className="mt-5 grid grid-cols-2 gap-2 border-y py-4 sm:grid-cols-4"
        aria-label="Issue filters"
      >
        <label className="grid gap-1 text-xs text-muted-foreground">
          <span>State</span>
          <select
            aria-label="Filter by Issue state"
            className="h-8 rounded-md border bg-surface-raised px-2 text-foreground"
            value={query.state ?? "open"}
            onChange={(event) => {
              const state = event.currentTarget.value;
              if (state === "open" || state === "closed" || state === "all") setFilter({ state });
            }}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          <span>Assignee</span>
          <select
            aria-label="Filter by Assignee"
            className="h-8 rounded-md border bg-surface-raised px-2 text-foreground"
            value={query.assignee_status ?? "any"}
            onChange={(event) => {
              const assigneeStatus = event.currentTarget.value;
              if (
                assigneeStatus === "assigned" ||
                assigneeStatus === "unassigned" ||
                assigneeStatus === "any"
              ) {
                setFilter({ assignee_status: assigneeStatus });
              }
            }}
          >
            <option value="any">Any</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <form
          className="grid gap-1 text-xs text-muted-foreground"
          onSubmit={(event) => {
            event.preventDefault();
            setExactAssignee(assigneeFilter);
          }}
        >
          <label className="grid gap-1">
            <span>Exact Assignee</span>
            <input
              aria-label="Filter by exact Assignee"
              className="h-8 rounded-md border bg-surface-raised px-2 text-foreground"
              onChange={(event) => setAssigneeFilter(event.currentTarget.value)}
              placeholder="Assignee claim"
              value={assigneeFilter}
            />
          </label>
          <Button size="sm" type="submit" variant="outline">
            Apply Assignee
          </Button>
        </form>
        <form
          className="grid gap-1 text-xs text-muted-foreground"
          onSubmit={(event) => {
            event.preventDefault();
            setLabel(labelFilter);
          }}
        >
          <label className="grid gap-1">
            <span>Label</span>
            <input
              aria-label="Filter by Label ID"
              className="h-8 rounded-md border bg-surface-raised px-2 text-foreground"
              onChange={(event) => setLabelFilter(event.currentTarget.value)}
              placeholder="label_…"
              value={labelFilter}
            />
          </label>
          <Button size="sm" type="submit" variant="outline">
            Apply Label
          </Button>
        </form>
        <label className="grid gap-1 text-xs text-muted-foreground">
          <span>Readiness</span>
          <select
            aria-label="Filter by Readiness"
            className="h-8 rounded-md border bg-surface-raised px-2 text-foreground"
            value={query.blocking_status ?? "any"}
            onChange={(event) => {
              const blockingStatus = event.currentTarget.value;
              if (
                blockingStatus === "blocked" ||
                blockingStatus === "unblocked" ||
                blockingStatus === "any"
              ) {
                setFilter({ blocking_status: blockingStatus });
              }
            }}
          >
            <option value="any">Any</option>
            <option value="unblocked">Unblocked</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
      </div>

      {Option.isNone(collection) ? (
        pageState._tag === "Failure" ? (
          <div className="py-10 text-center" role="alert">
            <p className="font-semibold">Issue list unavailable</p>
            <Button className="mt-3" onClick={refresh} size="sm">
              Retry Issues
            </Button>
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground" role="status">
            Loading Issues…
          </div>
        )
      ) : collection.value.items.length === 0 ? (
        <div className="py-10 text-center">
          <p className="font-semibold">No Issues match these filters</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Change a discrete filter. There is no hidden query language.
          </p>
        </div>
      ) : (
        <ol className="divide-y" aria-label="Issues">
          {collection.value.items.map((issue) => (
            <li key={issue.id}>
              <Link
                className="grid min-h-14 grid-cols-[auto_1fr_auto] items-center gap-3 px-1 py-2 hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2"
                to="/issues/$issueId"
                params={{ issueId: issue.id }}
                search={(previous) => completeIssueListSearch(previous)}
              >
                <span className="size-2 rounded-full bg-foreground" aria-label={issue.state} />
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{issue.title}</strong>
                  <span className="text-xs text-muted-foreground">
                    #{issue.number} · {issue.assignee ?? "Unassigned"}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {issue.blocking_status === "blocked" ? "Blocked" : "Unblocked"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {Option.isSome(collection) ? (
        <nav className="mt-4 flex justify-between gap-3" aria-label="Issue pages">
          <Button
            disabled={collection.value.links.previous === undefined}
            onClick={() => {
              const href = collection.value.links.previous?.href;
              if (href !== undefined) followPage(href);
            }}
            size="sm"
            variant="outline"
          >
            Previous
          </Button>
          <Button
            disabled={collection.value.links.next === undefined}
            onClick={() => {
              const href = collection.value.links.next?.href;
              if (href !== undefined) followPage(href);
            }}
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </nav>
      ) : null}

      <CreateIssueForm projectId={props.project.id} />
    </section>
  );
}
