/** Options for one private, strongly validated JSON representation. */
export type ConditionalJsonOptions = {
  readonly body: string;
  readonly contentType: string;
  readonly ifNoneMatch: string | null;
  readonly method: "GET" | "HEAD";
  readonly requestId: string;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Return a GET, HEAD, or conditional 304 response with a strong ETag. */
export async function conditionalJsonResponse(
  options: ConditionalJsonOptions,
): Promise<Response> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(options.body),
  );
  const etag = `"${base64Url(new Uint8Array(digest))}"`;
  const headers = new Headers({
    "cache-control": "private, no-cache",
    "content-type": options.contentType,
    etag,
    vary: "Accept",
    "x-request-id": options.requestId,
  });
  if (options.ifNoneMatch === etag) {
    headers.delete("content-type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(options.method === "HEAD" ? null : options.body, {
    status: 200,
    headers,
  });
}
