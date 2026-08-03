import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Layer, Option, Path } from "effect";
import { Etag, HttpPlatform } from "effect/unstable/http";
import { HttpApiTest } from "effect/unstable/httpapi";
import { IssueId } from "../../domain/issue.ts";
import { ProjectId } from "../../domain/project.ts";
import { WorkspaceId } from "../../domain/workspace.ts";
import { PaginationLimit } from "../../pagination.ts";
import { BookkeeperDatabase } from "./bookkeeper-database.ts";
import {
  type BookkeeperIssue,
  type BookkeeperProject,
  type BookkeeperWorkspace,
  BookkeeperHttpApi,
  RegisterWorkspaceError,
} from "./bookkeeper-http-api.ts";
import { makeBookkeeperHttpHandlersLayer } from "./bookkeeper-server.ts";

const workspaceId = WorkspaceId.make("workspace_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const otherWorkspaceId = WorkspaceId.make("workspace_01ARZ3NDEKTSV4RRFFQ69G5FAW");
const projectId = ProjectId.make("project_01ARZ3NDEKTSV4RRFFQ69G5FAX");
const issueId = IssueId.make("issue_01ARZ3NDEKTSV4RRFFQ69G5FAY");
const createdAt = DateTime.makeUnsafe("2026-08-03T12:00:00.000Z");
const updatedAt = DateTime.makeUnsafe("2026-08-03T12:01:00.000Z");
const deletedAt = DateTime.makeUnsafe("2026-08-03T12:02:00.000Z");
const pageRequest = {
  cursor: Option.none(),
  limit: PaginationLimit.make(10),
};

const workspace: BookkeeperWorkspace = {
  id: workspaceId,
  createdAt,
  updatedAt,
  deletedAt: Option.none(),
};
const project: BookkeeperProject = {
  id: projectId,
  workspaceId,
  createdAt,
  updatedAt,
  deletedAt: Option.none(),
};
const issue: BookkeeperIssue = {
  id: issueId,
  projectId,
  createdAt,
  updatedAt,
  deletedAt: Option.none(),
};

const deletedWorkspace: BookkeeperWorkspace = {
  id: workspace.id,
  createdAt: workspace.createdAt,
  updatedAt: deletedAt,
  deletedAt: Option.some(deletedAt),
};
const deletedProject: BookkeeperProject = {
  id: project.id,
  workspaceId: project.workspaceId,
  createdAt: project.createdAt,
  updatedAt: deletedAt,
  deletedAt: Option.some(deletedAt),
};
const deletedIssue: BookkeeperIssue = {
  id: issue.id,
  projectId: issue.projectId,
  createdAt: issue.createdAt,
  updatedAt: deletedAt,
  deletedAt: Option.some(deletedAt),
};

const bookkeeperDatabaseHttpTest = BookkeeperDatabase.of({
  listWorkspaces: () => Effect.succeed({ items: [workspace], nextCursor: Option.none() }),
  getWorkspace: (id) => Effect.succeed(id === workspaceId ? Option.some(workspace) : Option.none()),
  registerWorkspace: Effect.succeed,
  deleteWorkspace: () => Effect.succeed(deletedWorkspace),
  listProjects: () => Effect.succeed({ items: [project], nextCursor: Option.none() }),
  getProject: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
  registerProject: Effect.succeed,
  deleteProject: () => Effect.succeed(deletedProject),
  listIssues: () => Effect.succeed({ items: [issue], nextCursor: Option.none() }),
  getIssue: (id) => Effect.succeed(id === issueId ? Option.some(issue) : Option.none()),
  registerIssue: Effect.succeed,
  deleteIssue: () => Effect.succeed(deletedIssue),
  getCounts: Effect.succeed({ workspaces: 1, projects: 1, issues: 1 }),
});

const bookkeeperHttpPlatformTestLayer = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("Bookkeeper HTTP test file responses are not supported"),
  fileWebResponse: () => Effect.die("Bookkeeper HTTP test file responses are not supported"),
});
const bookkeeperHttpTestLayer = Layer.mergeAll(
  Etag.layer,
  FileSystem.layerNoop({}),
  bookkeeperHttpPlatformTestLayer,
  Path.layer,
);
const makeBookkeeperHttpTestClient = HttpApiTest.groups(BookkeeperHttpApi, ["bookkeeper"]).pipe(
  Effect.provide(makeBookkeeperHttpHandlersLayer(bookkeeperDatabaseHttpTest)),
);

describe("Bookkeeper HTTP API", () => {
  it.effect(
    "round-trips Workspace, Project, Issue, pagination, tombstone, and count operations",
    () =>
      Effect.gen(function* () {
        const client = yield* makeBookkeeperHttpTestClient;
        const workspaces = yield* client.bookkeeper.listWorkspaces({ query: pageRequest });
        const readWorkspace = yield* client.bookkeeper.getWorkspace({
          params: { workspaceId },
        });
        const registeredWorkspace = yield* client.bookkeeper.registerWorkspace({
          params: { workspaceId },
          payload: workspace,
        });
        const deletedWorkspace = yield* client.bookkeeper.deleteWorkspace({
          params: { workspaceId },
        });
        const projects = yield* client.bookkeeper.listProjects({
          query: { workspaceId, ...pageRequest },
        });
        const readProject = yield* client.bookkeeper.getProject({ params: { projectId } });
        const registeredProject = yield* client.bookkeeper.registerProject({
          params: { projectId },
          payload: project,
        });
        const deletedProject = yield* client.bookkeeper.deleteProject({ params: { projectId } });
        const issues = yield* client.bookkeeper.listIssues({
          query: { projectId, ...pageRequest },
        });
        const readIssue = yield* client.bookkeeper.getIssue({ params: { issueId } });
        const registeredIssue = yield* client.bookkeeper.registerIssue({
          params: { issueId },
          payload: issue,
        });
        const deletedIssue = yield* client.bookkeeper.deleteIssue({ params: { issueId } });
        const counts = yield* client.bookkeeper.getCounts();

        expect(workspaces.items).toEqual([workspace]);
        expect(readWorkspace).toEqual(Option.some(workspace));
        expect(registeredWorkspace).toEqual(workspace);
        expect(Option.isSome(deletedWorkspace.deletedAt)).toBe(true);
        expect(projects.items).toEqual([project]);
        expect(readProject).toEqual(Option.some(project));
        expect(registeredProject).toEqual(project);
        expect(Option.isSome(deletedProject.deletedAt)).toBe(true);
        expect(issues.items).toEqual([issue]);
        expect(readIssue).toEqual(Option.some(issue));
        expect(registeredIssue).toEqual(issue);
        expect(Option.isSome(deletedIssue.deletedAt)).toBe(true);
        expect(counts).toEqual({ workspaces: 1, projects: 1, issues: 1 });
      }).pipe(Effect.provide(bookkeeperHttpTestLayer)),
  );

  it.effect("rejects a PUT whose path and payload identities differ", () =>
    Effect.gen(function* () {
      const client = yield* makeBookkeeperHttpTestClient;
      const error = yield* client.bookkeeper
        .registerWorkspace({
          params: { workspaceId: otherWorkspaceId },
          payload: workspace,
        })
        .pipe(Effect.flip);

      expect(error).toEqual(
        new RegisterWorkspaceError({
          reason: "IdentityMismatch",
          message: "Bookkeeper Workspace path and payload identities must match",
        }),
      );
    }).pipe(Effect.provide(bookkeeperHttpTestLayer)),
  );
});
