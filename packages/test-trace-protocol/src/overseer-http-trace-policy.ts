import type { OtlpTraceData } from "./otlp-trace-data.ts";

const overseerRequestTraceHeaderNames = new Set([
  "cf-access-authenticated-user-email",
  "cf-access-client-id",
  "content-type",
]);
const overseerResponseTraceHeaderNames = new Set([
  "x-overseer-request-id",
  "cf-ray",
  "content-type",
  "retry-after",
]);

const privateHttpTraceAttributeNames = new Set([
  "client.address",
  "url.query",
  "user_agent.original",
]);

/** Allows only approved correlation and protocol headers in Overseer HTTP trace attributes. */
export const includeOverseerHttpTraceHeader = (
  headerName: string,
  phase: "request" | "response",
): boolean => {
  const normalizedName = headerName.toLowerCase();
  return phase === "request"
    ? overseerRequestTraceHeaderNames.has(normalizedName)
    : overseerResponseTraceHeaderNames.has(normalizedName);
};

const includeOverseerHttpTraceAttribute = (attributeName: string): boolean => {
  if (privateHttpTraceAttributeNames.has(attributeName)) return false;

  const requestHeaderPrefix = "http.request.header.";
  if (attributeName.startsWith(requestHeaderPrefix)) {
    return includeOverseerHttpTraceHeader(
      attributeName.slice(requestHeaderPrefix.length),
      "request",
    );
  }

  const responseHeaderPrefix = "http.response.header.";
  if (attributeName.startsWith(responseHeaderPrefix)) {
    return includeOverseerHttpTraceHeader(
      attributeName.slice(responseHeaderPrefix.length),
      "response",
    );
  }

  return true;
};

const sanitizeUrlFullAttribute = (
  attribute: OtlpTraceData["resourceSpans"][number]["scopeSpans"][number]["spans"][number]["attributes"][number],
): typeof attribute => {
  const value = attribute.value.stringValue;
  if (value === undefined || value === null) return attribute;

  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return { ...attribute, value: { stringValue: url.href } };
  } catch {
    return { ...attribute, value: { stringValue: "REDACTED" } };
  }
};

/** Removes unapproved HTTP metadata from parsed OTLP trace data before TTC persistence. */
export const sanitizeOverseerOtlpHttpTraceData = (traceData: OtlpTraceData): OtlpTraceData => ({
  resourceSpans: traceData.resourceSpans.map((resourceSpan) => ({
    ...resourceSpan,
    scopeSpans: resourceSpan.scopeSpans.map((scopeSpan) => ({
      ...scopeSpan,
      spans: scopeSpan.spans.map((span) => ({
        ...span,
        attributes: span.attributes
          .filter((attribute) => includeOverseerHttpTraceAttribute(attribute.key))
          .map((attribute) =>
            attribute.key === "url.full" ? sanitizeUrlFullAttribute(attribute) : attribute,
          ),
      })),
    })),
  })),
});
