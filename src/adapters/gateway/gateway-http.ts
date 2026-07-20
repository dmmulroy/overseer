import * as Arr from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import {
  DiscoveryMediaTypes,
  DiscoveryPaths,
} from "../../contract/http-api.ts";
import type { RequestId } from "../../domain/actor.ts";
import { openApiDocument } from "../../contract/openapi.ts";
import { discoveryDocument, schemaIndex } from "../../contract/representations.ts";
import { conditionalJsonResponse } from "./conditional-response.ts";
import { problemResponse } from "./problem-response.ts";

/** Parsed context established before public HTTP protocol handling. */
export type AuthenticatedRequestContext = {
  readonly requestId: RequestId;
};

const readablePaths: ReadonlySet<string> = new Set([
  DiscoveryPaths.root,
  DiscoveryPaths.schemas,
  DiscoveryPaths.openapi,
]);

type ParsedMediaType = {
  readonly type: string;
  readonly subtype: string;
  readonly parameters: HashMap.HashMap<string, string>;
};

function parseMediaType(input: string): ParsedMediaType | null {
  const [range = "", ...parameterSegments] = input
    .split(";")
    .map((segment) => segment.trim().toLowerCase());
  const separator = range.indexOf("/");
  if (separator <= 0 || separator === range.length - 1) {
    return null;
  }
  let parameters = HashMap.empty<string, string>();
  for (const segment of parameterSegments) {
    const equals = segment.indexOf("=");
    if (equals <= 0 || equals === segment.length - 1) {
      return null;
    }
    const name = segment.slice(0, equals).trim();
    const rawValue = segment.slice(equals + 1).trim();
    const value = rawValue.startsWith("\"") && rawValue.endsWith("\"")
      ? rawValue.slice(1, -1)
      : rawValue;
    parameters = HashMap.set(parameters, name, value);
  }
  return {
    type: range.slice(0, separator),
    subtype: range.slice(separator + 1),
    parameters,
  };
}

function acceptsRepresentation(
  accept: string | null,
  representation: string,
): boolean {
  if (accept === null || accept.trim().length === 0) {
    return true;
  }
  const offered = parseMediaType(representation);
  if (offered === null) {
    return false;
  }
  let bestMatch:
    | { readonly specificity: number; readonly parameterCount: number; readonly quality: number }
    | null = null;
  for (const entry of accept.split(",")) {
    const requested = parseMediaType(entry);
    if (requested === null || (requested.type === "*" && requested.subtype !== "*")) {
      continue;
    }
    const quality = Number(
      Option.getOrElse(HashMap.get(requested.parameters, "q"), () => "1"),
    );
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
      continue;
    }
    const typeMatches = requested.type === "*" || requested.type === offered.type;
    const exactSubtype = requested.subtype === offered.subtype;
    const suffixSubtype = requested.subtype.startsWith("*+") &&
      offered.subtype.endsWith(requested.subtype.slice(1));
    const subtypeMatches = requested.subtype === "*" || exactSubtype || suffixSubtype;
    const parameters = HashMap.toEntries(HashMap.remove(requested.parameters, "q"));
    const parametersMatch = Arr.every(parameters, ([name, value]) =>
      Option.contains(HashMap.get(offered.parameters, name), value)
    );
    if (!typeMatches || !subtypeMatches || !parametersMatch) {
      continue;
    }
    const candidate = {
      specificity: (requested.type === "*" ? 0 : 2) +
        (exactSubtype ? 2 : suffixSubtype ? 1 : 0),
      parameterCount: parameters.length,
      quality,
    };
    if (
      bestMatch === null ||
      candidate.specificity > bestMatch.specificity ||
      (candidate.specificity === bestMatch.specificity &&
        (candidate.parameterCount > bestMatch.parameterCount ||
          (candidate.parameterCount === bestMatch.parameterCount &&
            candidate.quality > bestMatch.quality)))
    ) {
      bestMatch = candidate;
    }
  }
  return bestMatch !== null && bestMatch.quality > 0;
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
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problemResponse({
      code: "method_not_allowed",
      detail: "This resource supports only GET and HEAD.",
      headers: { allow: "GET, HEAD" },
      requestId: context.requestId,
    });
  }
  const contentType = url.pathname === DiscoveryPaths.openapi
    ? DiscoveryMediaTypes.openapi
    : DiscoveryMediaTypes.json;
  if (!acceptsRepresentation(request.headers.get("accept"), contentType)) {
    return problemResponse({
      code: "representation_not_acceptable",
      detail: "The requested resource is available only as JSON.",
      requestId: context.requestId,
    });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const representation = url.pathname === DiscoveryPaths.root
      ? {
          body: JSON.stringify(discoveryDocument()),
          contentType: DiscoveryMediaTypes.json,
        }
      : url.pathname === DiscoveryPaths.schemas
        ? {
            body: JSON.stringify(schemaIndex()),
            contentType: DiscoveryMediaTypes.json,
          }
        : url.pathname === DiscoveryPaths.openapi
          ? {
              body: JSON.stringify(openApiDocument()),
              contentType: DiscoveryMediaTypes.openapi,
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
  });
}
