import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClientError,
} from "effect/unstable/http";
import {
  AsyncResult,
  Atom,
  AtomHttpApi,
} from "effect/unstable/reactivity";
import {
  OverseerApi,
  type WorkspaceCollection,
} from "../../contract/http-api.ts";

/** Generated browser client and Atom runtime for Overseer's HTTP contract. */
export class OverseerHttpClient extends AtomHttpApi.Service<OverseerHttpClient>()(
  "@overseer/browser/OverseerHttpClient",
  {
    api: OverseerApi,
    httpClient: FetchHttpClient.layer,
  },
) {}

/** A conditional Workspace collection read failed at the browser boundary. */
export class WorkspaceReadFailed extends Schema.TaggedErrorClass<WorkspaceReadFailed>()(
  "WorkspaceReadFailed",
  {
    message: Schema.String,
    retryAfterMilliseconds: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  /** Construct a classified browser Workspace-read failure. */
  constructor(cause: unknown, now: number) {
    const header = HttpClientError.isHttpClientError(cause)
      ? cause.response?.headers["retry-after"]
      : undefined;
    const deltaSeconds = Number(header);
    const retryAt = header === undefined ? Number.NaN : Date.parse(header);
    const retryAfterMilliseconds = Number.isFinite(deltaSeconds)
      ? deltaSeconds * 1_000
      : Number.isFinite(retryAt)
      ? Math.max(0, retryAt - now)
      : 0;
    super({
      message: "The Workspace collection could not be refreshed",
      retryAfterMilliseconds,
      cause,
    });
  }
}

/** One parsed Workspace collection observation and its strong validator. */
export type WorkspaceResource = {
  readonly collection: WorkspaceCollection;
  readonly etag: Option.Option<string>;
  readonly validatedAt: number;
};

/** Generated API discovery query owned by the application Atom registry. */
export const discoveryQuery = OverseerHttpClient.query("discovery", "discover", {
  headers: {},
  timeToLive: "5 minutes",
}).pipe(
  Atom.swr({
    staleTime: "5 seconds",
    revalidateOnFocus: true,
    focusSignal: Atom.windowFocusSignal,
  }),
);

function previousWorkspaceResource(
  get: Atom.AtomContext,
): Option.Option<WorkspaceResource> {
  return Option.flatMap(
    get.self<AsyncResult.AsyncResult<WorkspaceResource, WorkspaceReadFailed>>(),
    AsyncResult.value,
  );
}

/** Conditional Workspace collection query with stale-while-revalidate behavior. */
const workspaceRequestQuery = OverseerHttpClient.runtime.atom((get) => {
  const previous = previousWorkspaceResource(get);
  const previousValue = Option.getOrUndefined(previous);
  return OverseerHttpClient.use((client) =>
    client.workspaces.listWorkspaces({
      headers: previousValue === undefined || Option.isNone(previousValue.etag)
        ? {}
        : { "if-none-match": previousValue.etag.value },
      query: {},
      responseMode: "decoded-and-response",
    }).pipe(
      Effect.flatMap(([collection, response]) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((validatedAt) => ({
            collection,
            etag: Option.fromNullishOr(response.headers.etag),
            validatedAt,
          } satisfies WorkspaceResource)),
        )
      ),
      Effect.catch((cause) =>
        HttpClientError.isHttpClientError(cause) &&
          cause.response?.status === 304 &&
          previousValue !== undefined
          ? Clock.currentTimeMillis.pipe(
              Effect.map((validatedAt) => ({ ...previousValue, validatedAt })),
            )
          : Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) => Effect.fail(new WorkspaceReadFailed(cause, now))),
            )
      ),
    )
  );
}).pipe(
  Atom.swr({
    staleTime: "5 seconds",
    revalidateOnFocus: true,
    focusSignal: Atom.windowFocusSignal,
  }),
  Atom.setIdleTTL("5 minutes"),
);

const workspaceRetryDelays = [5_000, 15_000, 30_000] as const;

/** Workspace collection query with visible stale data and bounded retry backoff. */
export const workspaceQuery = Atom.readable((get) => {
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const clearRetry = () => {
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
  };
  const scheduleRetry = (
    state: AsyncResult.AsyncResult<WorkspaceResource, WorkspaceReadFailed>,
  ) => {
    clearRetry();
    if (!AsyncResult.isFailure(state) || state.waiting) {
      if (AsyncResult.isSuccess(state)) failures = 0;
      return;
    }
    const error = Cause.findErrorOption(state.cause);
    const retryAfter = Option.isSome(error) && error.value instanceof WorkspaceReadFailed
      ? error.value.retryAfterMilliseconds
      : 0;
    const delay = Math.max(
      workspaceRetryDelays[failures] ?? 60_000,
      retryAfter,
    );
    failures += 1;
    retry = setTimeout(() => get.refresh(workspaceRequestQuery), delay);
  };

  const initial = get.once(workspaceRequestQuery);
  scheduleRetry(initial);
  get.subscribe(workspaceRequestQuery, (state) => {
    scheduleRetry(state);
    get.setSelf(state);
  });
  get.addFinalizer(clearRetry);
  return initial;
}, (refresh) => refresh(workspaceRequestQuery)).pipe(
  Atom.setIdleTTL("5 minutes"),
);
