/** Stable RFC 9457 fields returned for an expected Gateway failure. */
export type Problem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly request_id: string;
  readonly retryable: boolean;
};

/** Input for one safe expected-problem projection. */
export type ProblemInput = {
  readonly code: string;
  readonly detail: string;
  readonly requestId: string;
  readonly retryable?: boolean;
  readonly status: number;
  readonly title: string;
  readonly headers?: Readonly<Record<string, string>>;
};

/** Render an expected failure as an RFC 9457 problem. */
export function problemResponse(input: ProblemInput): Response {
  const problem: Problem = {
    type: `https://overseer.dev/problems/${input.code}`,
    title: input.title,
    status: input.status,
    detail: input.detail,
    code: input.code,
    request_id: input.requestId,
    retryable: input.retryable ?? false,
  };
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/problem+json",
      "x-request-id": input.requestId,
      ...input.headers,
    },
  });
}

/** Render a safe authentication problem. */
export function authenticationProblem(requestId: string): Response {
  return problemResponse({
    code: "authentication_required",
    detail: "A valid Cloudflare Access assertion is required.",
    requestId,
    status: 401,
    title: "Authentication required",
    headers: { "www-authenticate": "Cloudflare-Access" },
  });
}
