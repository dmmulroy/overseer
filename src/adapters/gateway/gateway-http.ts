import type { AuthenticatedPrincipal } from "../../domain/actor.ts";
import type { AgentSession } from "./request-context.ts";
import { openApiDocument } from "../../contract/openapi.ts";
import { discoveryDocument, schemaIndex } from "../../contract/representations.ts";
import { conditionalJsonResponse } from "./conditional-response.ts";
import { problemResponse } from "./problem-response.ts";

/** Parsed context established before public HTTP protocol handling. */
export type AuthenticatedRequestContext = {
  readonly principal: AuthenticatedPrincipal;
  readonly requestId: string;
  readonly agentSession: AgentSession | null;
};

const readablePaths = new Set(["/api", "/api/schemas", "/api/openapi.json"]);

function acceptsJson(accept: string | null): boolean {
  if (accept === null || accept.trim().length === 0) {
    return true;
  }
  return accept.split(",").some((entry) => {
    const mediaType = entry.split(";", 1)[0]?.trim().toLowerCase();
    return mediaType === "*/*" ||
      mediaType === "application/*" ||
      mediaType === "application/json" ||
      mediaType === "application/vnd.oai.openapi+json" ||
      mediaType?.endsWith("+json") === true;
  });
}

/** Handle one authenticated API request. */
export async function handleApiRequest(
  request: Request,
  context: AuthenticatedRequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (!readablePaths.has(url.pathname)) {
    return problemResponse({
      code: "resource_not_found",
      detail: "The requested API resource does not exist.",
      requestId: context.requestId,
      status: 404,
      title: "Resource not found",
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problemResponse({
      code: "method_not_allowed",
      detail: "This resource supports only GET and HEAD.",
      headers: { allow: "GET, HEAD" },
      requestId: context.requestId,
      status: 405,
      title: "Method not allowed",
    });
  }
  if (!acceptsJson(request.headers.get("accept"))) {
    return problemResponse({
      code: "representation_not_acceptable",
      detail: "The requested resource is available only as JSON.",
      requestId: context.requestId,
      status: 406,
      title: "Representation not acceptable",
    });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const representation = url.pathname === "/api"
      ? { body: JSON.stringify(discoveryDocument()), contentType: "application/json" }
      : url.pathname === "/api/schemas"
        ? { body: JSON.stringify(schemaIndex()), contentType: "application/json" }
        : url.pathname === "/api/openapi.json"
          ? {
              body: JSON.stringify(openApiDocument()),
              contentType: "application/vnd.oai.openapi+json;version=3.1",
            }
          : null;
    if (representation !== null) {
      return conditionalJsonResponse({
        ...representation,
        ifNoneMatch: request.headers.get("if-none-match"),
        method: request.method,
        requestId: context.requestId,
      });
    }
  }

  return problemResponse({
    code: "resource_not_found",
    detail: "The requested API resource does not exist.",
    requestId: context.requestId,
    status: 404,
    title: "Resource not found",
  });
}
