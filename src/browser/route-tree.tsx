import {
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AppShell } from "./shell/app-shell.tsx";
import { WorkspaceId } from "../domain/entity-id.ts";

const rootRoute = createRootRoute({
  component: AppShell,
  validateSearch: (search: Record<string, unknown>) => ({
    workspace_id: Option.getOrUndefined(
      Schema.decodeUnknownOption(WorkspaceId)(search.workspace_id),
    ),
  }),
});

/** Browser router owning Overseer's URL-backed context. */
export const router = createRouter({ routeTree: rootRoute });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
