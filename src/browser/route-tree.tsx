import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ProjectId, WorkspaceId } from "../domain/entity-id.ts";

const rootRoute = createRootRoute({
  component: lazyRouteComponent(() => import("./shell/app-shell.tsx"), "AppShell"),
  validateSearch: (search: Record<string, unknown>) => ({
    workspace_id: Option.getOrUndefined(
      Schema.decodeUnknownOption(WorkspaceId)(search.workspace_id),
    ),
    project_id: Option.getOrUndefined(Schema.decodeUnknownOption(ProjectId)(search.project_id)),
  }),
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
