import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import { Atom } from "effect/unstable/reactivity";
import {
  invalidateBrowserIssueListPages,
  issueQuery,
  issueTimelineQuery,
  OverseerHttpClient,
} from "../adapters/web-client/api-resources.ts";
import type { IssueResponse } from "../contract/http-api.ts";
import type { IssueId } from "../domain/entity-id.ts";
import { IdempotencyKey } from "../domain/idempotency.ts";

/** Named target state action issued from the focused browser route. */
export type BrowserIssueStateAction = "close" | "reopen";

/** Deterministically project an Issue while its target-state command is pending. */
export function optimisticIssueState(
  issue: IssueResponse,
  action: BrowserIssueStateAction,
): IssueResponse {
  const { close: _close, reopen: _reopen, ...stableLinks } = issue.links;
  const state = action === "close" ? "closed" : "open";
  return {
    ...issue,
    state,
    links: {
      ...stableLinks,
      [state === "closed" ? "reopen" : "close"]: {
        href: `/api/issues/${issue.id}/${state === "closed" ? "reopen" : "close"}`,
        method: "POST",
      },
    },
  };
}

/** Effect-owned preflight, write, returned-data installation, and convergence command. */
export const issueSteeringCommand = Atom.family((issueId: IssueId) =>
  OverseerHttpClient.runtime.fn<BrowserIssueStateAction>()(
    Effect.fn("Browser.issueSteeringCommand")(function* (action, get) {
      const client = yield* OverseerHttpClient;
      // A direct authenticated read is the pre-write validation. It is intentionally stronger
      // than the five-second grace when command state does not expose the cache validation time.
      yield* client.issues.readIssue({
        params: { issue_id: issueId },
        headers: {},
      });
      const now = yield* Clock.currentTimeMillis;
      const entropy = Math.abs(yield* Random.nextInt);
      const request = {
        params: { issue_id: issueId },
        headers: {
          "content-type": "application/json",
          "idempotency-key": IdempotencyKey.make(`browser-issue-state-${now}-${entropy}`),
        },
        payload: {},
      };
      const issue = yield* action === "close"
        ? client.issues.closeIssue(request)
        : client.issues.reopenIssue(request);
      // The command result is the rendered canonical value before conditional convergence starts.
      invalidateBrowserIssueListPages();
      get.refresh(issueQuery(issueId));
      get.refresh(issueTimelineQuery(issueId));
      return issue;
    }),
  ),
);
