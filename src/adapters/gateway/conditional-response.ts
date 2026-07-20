import * as Encoding from "effect/Encoding";
import type { RequestId } from "../../domain/actor.ts";

/** Options for one private, strongly validated JSON representation. */
export type ConditionalJsonOptions = {
  readonly body: string;
  readonly contentType: string;
  readonly ifNoneMatch: string | null;
  readonly method: "GET" | "HEAD";
  readonly requestId: RequestId;
};

function validatorMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) {
    return false;
  }
  return ifNoneMatch.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value.replace(/^W\//, "") === etag;
  });
}

/** Return a GET, HEAD, or conditional 304 response with a strong ETag. */
export async function conditionalJsonResponse(
  options: ConditionalJsonOptions,
): Promise<Response> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(options.body),
  );
  const etag = `"${Encoding.encodeBase64Url(new Uint8Array(digest))}"`;
  const headers = new Headers({
    "cache-control": "private, no-cache",
    "content-type": options.contentType,
    etag,
    vary: "Accept",
    "x-request-id": options.requestId,
  });
  if (validatorMatches(options.ifNoneMatch, etag)) {
    headers.delete("content-type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(options.method === "HEAD" ? null : options.body, {
    status: 200,
    headers,
  });
}
