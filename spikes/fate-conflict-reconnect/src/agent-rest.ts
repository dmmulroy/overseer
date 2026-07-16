import type { IssueSnapshot, UpdateIssueCommand } from "./issue-authority.js";
import { IssueAuthority } from "./issue-authority.js";

const json = (body: unknown, init: ResponseInit = {}): Response =>
  Response.json(body, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

const parseExpectedVersion = (request: Request): number | undefined => {
  const value = request.headers.get("if-match");
  const match = value?.match(/^"v(\d+)"$/);
  if (!match) {
    return undefined;
  }

  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : undefined;
};

const parseUpdate = async (
  request: Request,
  id: string,
): Promise<UpdateIssueCommand | undefined> => {
  const expectedVersion = parseExpectedVersion(request);
  if (expectedVersion === undefined) {
    return undefined;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return undefined;
  }

  if (!body || typeof body !== "object") {
    return undefined;
  }

  const title = "title" in body ? body.title : undefined;
  const state = "state" in body ? body.state : undefined;
  if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
    return undefined;
  }
  if (state !== undefined && state !== "open" && state !== "closed") {
    return undefined;
  }
  if (title === undefined && state === undefined) {
    return undefined;
  }

  return {
    expectedVersion,
    id,
    ...(state === undefined ? {} : { state }),
    ...(title === undefined ? {} : { title: title.trim() }),
  };
};

/** The Fetch-compatible agent-facing REST adapter used by the spike. */
export type AgentRestApi = Readonly<{
  fetch(request: Request): Promise<Response>;
}>;

/** Create the REST adapter over the application-owned issue authority. */
export const createAgentRestApi = (authority: IssueAuthority): AgentRestApi => ({
  async fetch(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/issues(?:\/([^/]+))?$/);
    if (!match || match[1] !== "prj_overseer") {
      return json({ error: { code: "not_found", message: "Resource not found." } }, { status: 404 });
    }

    const issueId = match[2];
    if (request.method === "GET" && issueId === undefined) {
      const state = url.searchParams.get("state");
      if (state !== null && state !== "open" && state !== "closed") {
        return json(
          { error: { code: "invalid_request", message: "state must be open or closed." } },
          { status: 400 },
        );
      }

      return json({ items: authority.list(state ?? undefined) });
    }

    if (request.method === "GET" && issueId !== undefined) {
      const issue = authority.get(issueId);
      return issue
        ? json({ issue }, { headers: { etag: `"v${issue.version}"` } })
        : json({ error: { code: "not_found", message: "Issue not found." } }, { status: 404 });
    }

    if (request.method === "PATCH" && issueId !== undefined) {
      const command = await parseUpdate(request, issueId);
      if (!command) {
        return json(
          {
            error: {
              code: "invalid_request",
              message: "A valid If-Match version and title or state are required.",
            },
          },
          { status: 400 },
        );
      }

      const result = authority.update(command);
      if (!result) {
        return json({ error: { code: "not_found", message: "Issue not found." } }, { status: 404 });
      }
      if (result._tag === "versionConflict") {
        return json(
          {
            error: {
              actualVersion: result.current.version,
              attempted: result.attempted,
              code: "version_conflict",
              current: result.current,
              expectedVersion: result.attempted.expectedVersion,
              message: "The issue changed after it was loaded.",
            },
          },
          { status: 409 },
        );
      }

      return json(
        { issue: result.issue },
        { headers: { etag: `"v${result.issue.version}"` } },
      );
    }

    return json(
      { error: { code: "method_not_allowed", message: "Method not allowed." } },
      { status: 405 },
    );
  },
});

/** Read one issue through the public REST contract (used by the scenario's other actor). */
export const getIssueThroughRest = async (
  api: AgentRestApi,
  id: string,
): Promise<IssueSnapshot> => {
  const response = await api.fetch(
    new Request(`https://overseer.test/api/projects/prj_overseer/issues/${id}`),
  );
  const body: unknown = await response.json();
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    !("issue" in body) ||
    !body.issue ||
    typeof body.issue !== "object"
  ) {
    throw new Error("PROTOTYPE defect: expected the seeded issue through REST.");
  }

  // SAFETY: this helper is only used after the scenario has seeded the exact IssueSnapshot shape.
  return body.issue as IssueSnapshot;
};
