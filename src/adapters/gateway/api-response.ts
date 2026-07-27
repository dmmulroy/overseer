import * as Arr from "effect/Array";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Headers from "effect/unstable/http/Headers";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type { RequestId } from "../../domain/actor.ts";
import { ProblemResponse } from "./problem-response.ts";

/** Inputs required to finalize one encoded API response. */
export type ApiResponseOptions = {
  readonly request: HttpServerRequest;
  readonly requestId: RequestId;
  readonly response: HttpServerResponse.HttpServerResponse;
};

type ParsedMediaType = {
  readonly type: string;
  readonly subtype: string;
  readonly parameters: HashMap.HashMap<string, string>;
  readonly quality: number;
};

function parseMediaType(input: string, isAcceptRange = false): Option.Option<ParsedMediaType> {
  const [range = "", ...parameterSegments] = input
    .split(";")
    .map((segment) => segment.trim().toLowerCase());

  const separator = range.indexOf("/");

  if (separator <= 0 || separator === range.length - 1) {
    return Option.none();
  }

  let parameters = HashMap.empty<string, string>();
  let quality = 1;
  let sawQuality = false;

  for (const segment of parameterSegments) {
    const equals = segment.indexOf("=");

    if (isAcceptRange && sawQuality) {
      continue;
    }
    if (equals <= 0 || equals === segment.length - 1) {
      return Option.none();
    }

    const name = segment.slice(0, equals).trim();
    const rawValue = segment.slice(equals + 1).trim();
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;

    if (isAcceptRange && name === "q") {
      quality = Number(value);
      sawQuality = true;
    } else {
      parameters = HashMap.set(parameters, name, value);
    }
  }

  return Option.some({
    type: range.slice(0, separator),
    subtype: range.slice(separator + 1),
    parameters,
    quality,
  });
}

function acceptsContentType(accept: string | undefined, contentType: string): boolean {
  if (accept === undefined || accept.trim().length === 0) {
    return true;
  }
  const offered = parseMediaType(contentType);
  if (Option.isNone(offered)) {
    return false;
  }
  let bestMatch = Option.none<{
    readonly specificity: number;
    readonly parameterCount: number;
    readonly quality: number;
  }>();

  for (const entry of accept.split(",")) {
    const requested = parseMediaType(entry, true);
    if (
      Option.isNone(requested) ||
      (requested.value.type === "*" && requested.value.subtype !== "*")
    ) {
      continue;
    }
    const quality = requested.value.quality;
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
      continue;
    }
    const typeMatches = requested.value.type === "*" || requested.value.type === offered.value.type;

    const exactSubtype = requested.value.subtype === offered.value.subtype;

    const suffixSubtype =
      requested.value.subtype.startsWith("*+") &&
      offered.value.subtype.endsWith(requested.value.subtype.slice(1));

    const subtypeMatches = requested.value.subtype === "*" || exactSubtype || suffixSubtype;

    const parameters = HashMap.toEntries(requested.value.parameters);

    const parametersMatch = Arr.every(parameters, ([name, value]) =>
      Option.contains(HashMap.get(offered.value.parameters, name), value),
    );

    if (!typeMatches || !subtypeMatches || !parametersMatch) {
      continue;
    }

    const candidate = {
      specificity:
        (requested.value.type === "*" ? 0 : 2) + (exactSubtype ? 2 : suffixSubtype ? 1 : 0),
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
export const finalizeApiResponse: (
  options: ApiResponseOptions,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, Crypto.Crypto | ProblemResponse> =
  Effect.fn("Gateway.finalizeApiResponse")(function* (options) {
    const crypto = yield* Crypto.Crypto;
    const problems = yield* ProblemResponse;
    const body = options.response.body;

    if (body._tag !== "Uint8Array") {
      return yield* Effect.die(
        "An ETag-enabled JSON endpoint produced a non-buffered response body",
      );
    }

    const contentType = body.contentType;

    if (!acceptsContentType(options.request.headers.accept, contentType)) {
      return problems.render({
        code: "response_type_not_acceptable",
        detail: "The requested response format is not supported.",
        requestId: options.requestId,
      });
    }
    const digest = yield* Effect.result(crypto.digest("SHA-256", body.body));
    if (Result.isFailure(digest)) {
      return yield* Effect.logError("Gateway response hashing failed").pipe(
        Effect.annotateLogs({
          error_type: digest.failure._tag,
          request_id: options.requestId,
        }),
        Effect.as(
          problems.render({
            code: "internal_error",
            detail: "Overseer could not complete the response.",
            requestId: options.requestId,
          }),
        ),
      );
    }

    const etag = `"${Encoding.encodeBase64Url(digest.success)}"`;

    const pathname = new URL(options.request.url, "https://gateway.invalid").pathname;

    const cacheControl = pathname.startsWith("/api/schemas/sha256-")
      ? "public, max-age=31536000, immutable"
      : "private, no-cache";

    const headers = Headers.setAll(options.response.headers, {
      "cache-control": cacheControl,
      "content-type": contentType,
      etag,
      vary: "Accept",
      "x-request-id": options.requestId,
    });

    const supportsCacheValidation =
      options.request.method === "GET" || options.request.method === "HEAD";

    if (
      supportsCacheValidation &&
      validatorMatches(options.request.headers["if-none-match"], etag)
    ) {
      return HttpServerResponse.empty({
        status: 304,
        headers: Headers.remove(headers, "content-type"),
      });
    }

    return HttpServerResponse.setHeaders(options.response, headers);
  });
