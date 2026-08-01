import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { IssueId, LabelId, ProjectId, WorkspaceId } from "../domain/entity-id.ts";
import { Assignee, IssueNumber, IssueNumberFromString } from "../domain/issue.ts";
import {
  IssueAssigneeStatusFilter,
  IssueBlockingStatusFilter,
  IssueCursor,
  IssueLabelMatchFilter,
  IssueLifecycleFilter,
  IssuePageLimit,
  IssuePageLimitFromString,
  IssueSort,
  IssueSortDirection,
  IssueStateFilter,
} from "../domain/pagination.ts";
import { completeIssueListSearch } from "./issue-list-search.ts";

function parsedSearchValue<A>(schema: Schema.Decoder<A>, value: unknown): A | undefined {
  return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value));
}

const rootRoute = createRootRoute({
  component: lazyRouteComponent(() => import("./shell/app-shell.tsx"), "AppShell"),
  validateSearch: (search: Record<string, unknown>) => {
    const workspaceId = parsedSearchValue(WorkspaceId, search.workspace_id);
    const projectId = parsedSearchValue(ProjectId, search.project_id);
    const state = parsedSearchValue(IssueStateFilter, search.state);
    const lifecycle = parsedSearchValue(IssueLifecycleFilter, search.lifecycle);
    const assignee = parsedSearchValue(Assignee, search.assignee);
    const assigneeStatus = parsedSearchValue(IssueAssigneeStatusFilter, search.assignee_status);
    const labelId = parsedSearchValue(
      Schema.Union([LabelId, Schema.Array(LabelId)]),
      search.label_id,
    );
    const labelMatch = parsedSearchValue(IssueLabelMatchFilter, search.label_match);
    const parent = parsedSearchValue(
      Schema.Union([Schema.Literal("root"), IssueId]),
      search.parent,
    );
    const blockingStatus = parsedSearchValue(IssueBlockingStatusFilter, search.blocking_status);
    const number = parsedSearchValue(
      Schema.Union([IssueNumber, IssueNumberFromString]),
      search.number,
    );
    const sort = parsedSearchValue(IssueSort, search.sort);
    const direction = parsedSearchValue(IssueSortDirection, search.direction);
    const cursor = parsedSearchValue(IssueCursor, search.cursor);
    const limit = parsedSearchValue(
      Schema.Union([IssuePageLimit, IssuePageLimitFromString]),
      search.limit,
    );
    return completeIssueListSearch({
      workspace_id: workspaceId,
      project_id: projectId,
      state,
      lifecycle,
      assignee,
      assignee_status: assigneeStatus,
      label_id: labelId,
      label_match: labelMatch,
      parent,
      blocking_status: blockingStatus,
      number,
      sort,
      direction,
      cursor,
      limit,
    });
  },
});

const focusedIssueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/issues/$issueId",
});

/** Browser router owning Overseer's URL-backed context and canonical focused Issue route. */
export const router = createRouter({ routeTree: rootRoute.addChildren([focusedIssueRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
