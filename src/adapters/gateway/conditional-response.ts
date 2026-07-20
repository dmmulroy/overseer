import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Headers from "effect/unstable/http/Headers";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type { RequestId } from "../../domain/actor.ts";
import type { ProblemResponder } from "./problem-response.ts";

/** Inputs required to negotiate and conditionally project one encoded JSON response. */
export type ConditionalResponseOptions = {
  readonly request: HttpServerRequest;
  readonly requestId: RequestId;
  readonly response: HttpServerResponse.HttpServerResponse;
  readonly respond: ProblemResponder;
};

type ParsedMediaType = {
  readonly type: string;
  readonly subtype: string;
  readonly parameters: HashMap.HashMap<string, string>;
};

function parseMediaType(input: string): Option.Option<ParsedMediaType> {
  const [range = "", ...parameterSegments] = input
    .split(";")
    .map((segment) => segment.trim().toLowerCase());
  const separator = range.indexOf("/");

  if (separator <= 0 || separator === range.length - 1) {
    return Option.none();
  }

  let parameters = HashMap.empty<string, string>();

  for (const segment of parameterSegments) {
    const equals = segment.indexOf("=");

    if (equals <= 0 || equals === segment.length - 1) {
      return Option.none();
    }

    const name = segment.slice(0, equals).trim();
    const rawValue = segment.slice(equals + 1).trim();
    const value = rawValue.startsWith("\"") && rawValue.endsWith("\"")
      ? rawValue.slice(1, -1)
      : rawValue;

    parameters = HashMap.set(parameters, name, value);
  }

  return Option.some({
    type: range.slice(0, separator),
    subtype: range.slice(separator + 1),
    parameters,
  });
}

function acceptsRepresentation(
  accept: string | undefined,
  representation: string,
): boolean {
  if (accept === undefined || accept.trim().length === 0) {
    return true;
  }
  const offered = parseMediaType(representation);
  if (Option.isNone(offered)) {
    return false;
  }
  let bestMatch = Option.none<{
    readonly specificity: number;
    readonly parameterCount: number;
    readonly quality: number;
  }>();
  for (const entry of accept.split(",")) {
    const requested = parseMediaType(entry);
    if (
      Option.isNone(requested) ||
      (requested.value.type === "*" && requested.value.subtype !== "*")
    ) {
      continue;
    }
    const quality = Number(
      Option.getOrElse(HashMap.get(requested.value.parameters, "q"), () => "1"),
    );
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
      continue;
    }
    const typeMatches = requested.value.type === "*" ||
      requested.value.type === offered.value.type;
    const exactSubtype = requested.value.subtype === offered.value.subtype;
    const suffixSubtype = requested.value.subtype.startsWith("*+") &&
      offered.value.subtype.endsWith(requested.value.subtype.slice(1));
    const subtypeMatches = requested.value.subtype === "*" ||
      exactSubtype ||
      suffixSubtype;
    const parameters = HashMap.toEntries(
      HashMap.remove(requested.value.parameters, "q"),
    );
    const parametersMatch = Arr.every(parameters, ([name, value]) =>
      Option.contains(HashMap.get(offered.value.parameters, name), value)
    );
    if (!typeMatches || !subtypeMatches || !parametersMatch) {
      continue;
    }
    const candidate = {
      specificity: (requested.value.type === "*" ? 0 : 2) +
        (exactSubtype ? 2 : suffixSubtype ? 1 : 0),
      parameterCount: parameters.length,
      quality,
    };
    if (
      Option.isNone(bestMatch) ||
      candidate.specificity > bestMatch.value.specificity ||
      (candidate.specificity === bestMatch.value.specificity &&
        (candidate.parameterCount > bestMatch.value.parameterCount ||
          (candidate.parameterCount === bestMatch.value.parameterCount &&
            candidate.quality > bestMatch.value.quality)))
    ) {
      bestMatch = Option.some(candidate);
    }
  }
  return Option.isSome(bestMatch) && bestMatch.value.quality > 0;
}

function validatorMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  return ifNoneMatch.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value.replace(/^W\//, "") === etag;
  });
}

/** Apply media negotiation, strong ETag validation, and common response headers. */
export const applyConditionalResponse: (
  options: ConditionalResponseOptions,
) => Effect.Effect<HttpServerResponse.HttpServerResponse> =
  Effect.fn("Gateway.applyConditionalResponse")(function* (options) {
    const body = options.response.body;
    if (body._tag !== "Uint8Array") {
      return yield* Effect.die(
        "A conditional JSON endpoint produced a non-buffered response body",
      );
    }
    const contentType = body.contentType;

    if (!acceptsRepresentation(options.request.headers.accept, contentType)) {
      return HttpServerResponse.fromWeb(options.respond({
        code: "representation_not_acceptable",
        detail: "The requested resource is not available in an acceptable representation.",
        requestId: options.requestId,
      }));
    }
    const bodyBytes = new Uint8Array(body.body.byteLength);
    bodyBytes.set(body.body);

    const digest = yield* Effect.promise(() =>
      crypto.subtle.digest("SHA-256", bodyBytes)
    );
    const etag = `"${Encoding.encodeBase64Url(new Uint8Array(digest))}"`;
    const headers = Headers.setAll(options.response.headers, {
      "cache-control": "private, no-cache",
      "content-type": contentType,
      etag,
      vary: "Accept",
      "x-request-id": options.requestId,
    });

    if (validatorMatches(options.request.headers["if-none-match"], etag)) {
      return HttpServerResponse.empty({
        status: 304,
        headers: Headers.remove(headers, "content-type"),
      });
    }

    return HttpServerResponse.setHeaders(options.response, headers);
  });
