import { Layer } from "effect";
import { HttpClient, HttpMiddleware } from "effect/unstable/http";

const routeParameterByCollection = new Map([
  ["workspaces", ":workspaceId"],
  ["projects", ":projectId"],
  ["issues", ":issueId"],
]);

const normalizeOverseerHttpRoute = (url: string): string => {
  const segments = new URL(url, "http://overseer.internal").pathname.split("/");

  for (let index = 1; index < segments.length; index += 1) {
    const collection = segments[index - 1];
    if (collection === undefined) continue;

    const routeParameter = routeParameterByCollection.get(collection);
    if (routeParameter !== undefined && segments[index] !== "") {
      segments[index] = routeParameter;
    }
  }

  return segments.join("/");
};

/** Adds normalized Overseer routes to Effect HTTP client and server span names. */
export const overseerHttpSpanNameLayer = Layer.mergeAll(
  Layer.succeed(
    HttpClient.SpanNameGenerator,
    (request) => `http.client ${request.method} ${normalizeOverseerHttpRoute(request.url)}`,
  ),
  Layer.succeed(
    HttpMiddleware.SpanNameGenerator,
    (request) => `http.server ${request.method} ${normalizeOverseerHttpRoute(request.url)}`,
  ),
);
