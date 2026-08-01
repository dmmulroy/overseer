import type { IssueId, LabelId, ProjectId, WorkspaceId } from "../domain/entity-id.ts";
import type { Assignee, IssueNumber } from "../domain/issue.ts";
import type {
  IssueAssigneeStatusFilter,
  IssueBlockingStatusFilter,
  IssueCursor,
  IssueLabelMatchFilter,
  IssueLifecycleFilter,
  IssuePageLimit,
  IssueSort,
  IssueSortDirection,
  IssueStateFilter,
} from "../domain/pagination.ts";

/** Parsed browser search state that preserves one exact Project Issue list context. */
export type IssueListSearch = {
  readonly workspace_id: WorkspaceId | undefined;
  readonly project_id: ProjectId | undefined;
  readonly state: IssueStateFilter | undefined;
  readonly lifecycle: IssueLifecycleFilter | undefined;
  readonly assignee: Assignee | undefined;
  readonly assignee_status: IssueAssigneeStatusFilter | undefined;
  readonly label_id: LabelId | ReadonlyArray<LabelId> | undefined;
  readonly label_match: IssueLabelMatchFilter | undefined;
  readonly parent: "root" | IssueId | undefined;
  readonly blocking_status: IssueBlockingStatusFilter | undefined;
  readonly number: IssueNumber | undefined;
  readonly sort: IssueSort | undefined;
  readonly direction: IssueSortDirection | undefined;
  readonly cursor: IssueCursor | undefined;
  readonly limit: IssuePageLimit | undefined;
};

/** Fill omitted browser search fields without changing any supplied Issue list context. */
export function completeIssueListSearch(search: Partial<IssueListSearch>): IssueListSearch {
  return {
    workspace_id: search.workspace_id,
    project_id: search.project_id,
    state: search.state,
    lifecycle: search.lifecycle,
    assignee: search.assignee,
    assignee_status: search.assignee_status,
    label_id: search.label_id,
    label_match: search.label_match,
    parent: search.parent,
    blocking_status: search.blocking_status,
    number: search.number,
    sort: search.sort,
    direction: search.direction,
    cursor: search.cursor,
    limit: search.limit,
  };
}
