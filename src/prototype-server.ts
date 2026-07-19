import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";

interface ServerIssue {
  readonly id: string;
  readonly project_id: string;
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly current_title_revision: number;
  readonly updated_at: string;
}

type ControlAction =
  | "external-change"
  | "fail-next-read"
  | "fail-next-write"
  | "slow-next-read"
  | "reset";

const isControlAction = (input: unknown): input is ControlAction =>
  input === "external-change" ||
  input === "fail-next-read" ||
  input === "fail-next-write" ||
  input === "slow-next-read" ||
  input === "reset";

const initialIssues = (): ReadonlyArray<ServerIssue> => [
  {
    id: "issue_01",
    project_id: "project_01",
    number: 39,
    title: "Prototype the Effect HTTP → Atom → React → TanStack client pipeline",
    state: "open",
    current_title_revision: 4,
    updated_at: new Date().toISOString(),
  },
  {
    id: "issue_02",
    project_id: "project_01",
    number: 44,
    title: "Prototype mutation and recovery under simple REST",
    state: "open",
    current_title_revision: 2,
    updated_at: new Date().toISOString(),
  },
];

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Array<Buffer> = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void => {
  response.writeHead(status, {
    "cache-control": "private, no-cache",
    "content-type": status >= 400 ? "application/problem+json" : "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
};

const sendProblem = (response: ServerResponse, detail: string): void => {
  sendJson(response, 503, {
    type: "/api/problems/service_unavailable",
    title: "Service unavailable",
    status: 503,
    code: "service_unavailable",
    detail,
    request_id: `request_${Date.now()}`,
    retryable: true,
  });
};

/** Create the controllable in-memory HTTP server used only by this prototype. */
export const makePrototypeServer = (): Connect.NextHandleFunction => {
  let issues = initialIssues();
  let listVersion = 1;
  let failNextRead = false;
  let failNextWrite = false;
  let slowNextRead = false;

  const updateIssue = (id: string, change: (issue: ServerIssue) => ServerIssue): ServerIssue | undefined => {
    let updated: ServerIssue | undefined;
    issues = issues.map((issue) => {
      if (issue.id !== id) return issue;
      updated = change(issue);
      return updated;
    });
    if (updated !== undefined) listVersion += 1;
    return updated;
  };

  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://prototype.local");
    const isRead = request.method === "GET" && url.pathname.startsWith("/api/");
    const isWrite = request.method === "PATCH" || request.method === "POST";

    if (url.pathname === "/prototype/control" && request.method === "POST") {
      const input = await readJson(request);
      if (typeof input !== "object" || input === null || !("action" in input)) {
        sendJson(response, 400, { message: "Missing action" });
        return;
      }
      const action = input.action;
      if (!isControlAction(action)) {
        sendJson(response, 400, { message: "Unknown action" });
        return;
      }
      if (action === "external-change") {
        updateIssue("issue_01", (issue) => ({
          ...issue,
          title: `${issue.title.replace(/ · external change \d+$/, "")} · external change ${issue.current_title_revision + 1}`,
          current_title_revision: issue.current_title_revision + 1,
          updated_at: new Date().toISOString(),
        }));
      } else if (action === "fail-next-read") {
        failNextRead = true;
      } else if (action === "fail-next-write") {
        failNextWrite = true;
      } else if (action === "slow-next-read") {
        slowNextRead = true;
      } else if (action === "reset") {
        issues = initialIssues();
        listVersion += 1;
        failNextRead = false;
        failNextWrite = false;
        slowNextRead = false;
      }
      sendJson(response, 200, { action, listVersion });
      return;
    }

    if (isRead && slowNextRead) {
      slowNextRead = false;
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
    if (isRead && failNextRead) {
      failNextRead = false;
      sendProblem(response, "The failure lab rejected the next read.");
      return;
    }
    if (isWrite && failNextWrite && url.pathname.startsWith("/api/")) {
      failNextWrite = false;
      sendProblem(response, "The failure lab rejected the next mutation.");
      return;
    }

    const listMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/issues$/);
    if (request.method === "GET" && listMatch !== null) {
      const projectId = listMatch[1];
      const etag = `"issues-${listVersion}"`;
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { etag, "cache-control": "private, no-cache" });
        response.end();
        return;
      }
      sendJson(
        response,
        200,
        {
          items: issues.filter((issue) => issue.project_id === projectId),
          links: { self: { href: url.pathname } },
        },
        { etag },
      );
      return;
    }

    const issueMatch = url.pathname.match(/^\/api\/issues\/([^/]+)$/);
    if (request.method === "GET" && issueMatch !== null) {
      const issue = issues.find((candidate) => candidate.id === issueMatch[1]);
      if (issue === undefined) {
        sendJson(response, 404, { message: "Not found" });
        return;
      }
      const etag = `"${issue.id}-${issue.current_title_revision}-${issue.state}"`;
      if (request.headers["if-none-match"] === etag) {
        response.writeHead(304, { etag, "cache-control": "private, no-cache" });
        response.end();
        return;
      }
      sendJson(response, 200, issue, { etag });
      return;
    }

    if (request.method === "PATCH" && issueMatch !== null) {
      const input = await readJson(request);
      if (typeof input !== "object" || input === null || !("title" in input) || typeof input.title !== "string") {
        sendJson(response, 422, { message: "Invalid title" });
        return;
      }
      const title = input.title;
      const issue = updateIssue(issueMatch[1] ?? "", (current) => ({
        ...current,
        title,
        current_title_revision: current.current_title_revision + 1,
        updated_at: new Date().toISOString(),
      }));
      if (issue === undefined) {
        sendJson(response, 404, { message: "Not found" });
        return;
      }
      sendJson(response, 200, issue, {
        etag: `"${issue.id}-${issue.current_title_revision}-${issue.state}"`,
      });
      return;
    }

    const actionMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/(close|reopen)$/);
    if (request.method === "POST" && actionMatch !== null) {
      const issueId = actionMatch[1] ?? "";
      const state = actionMatch[2] === "close" ? "closed" : "open";
      const issue = updateIssue(issueId, (current) => ({
        ...current,
        state,
        updated_at: new Date().toISOString(),
      }));
      if (issue === undefined) {
        sendJson(response, 404, { message: "Not found" });
        return;
      }
      sendJson(response, 200, issue, {
        etag: `"${issue.id}-${issue.current_title_revision}-${issue.state}"`,
      });
      return;
    }

    next();
  };
};
