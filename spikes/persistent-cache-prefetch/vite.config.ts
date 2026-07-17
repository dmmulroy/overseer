import type { IncomingMessage, ServerResponse } from "node:http";
import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import {
  makeIssueSnapshot,
  makeTimelinePage,
  PROJECT_ISSUE_COUNT,
} from "./src/project-data";

function sendJson(response: ServerResponse, value: unknown): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

function seededProjectApi(): Plugin {
  return {
    name: "seeded-project-api",
    configureServer(server) {
      server.middlewares.use(async (
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void,
      ) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        const match = /^\/api\/issues\/(\d+)$/.exec(url.pathname);
        if (match === null) {
          next();
          return;
        }
        const issueNumber = Number(match[1]);
        if (!Number.isInteger(issueNumber) || issueNumber < 1 || issueNumber > PROJECT_ISSUE_COUNT) {
          response.statusCode = 404;
          response.end();
          return;
        }
        const delay = Math.max(0, Math.min(2_000, Number(url.searchParams.get("delay") ?? "0")));
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (request.destroyed) {
          return;
        }
        sendJson(response, {
          snapshot: makeIssueSnapshot(issueNumber),
          timeline: makeTimelinePage(issueNumber),
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [foldkit(), seededProjectApi()],
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
  },
});
