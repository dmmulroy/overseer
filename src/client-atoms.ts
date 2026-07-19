import { Clock, Data, Effect, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomHttpApi from "effect/unstable/reactivity/AtomHttpApi";
import { FetchHttpClient } from "effect/unstable/http";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import type { Issue, IssueCollection } from "./api";
import { OverseerApi } from "./api";

/** A successfully decoded representation plus its explicit conditional-read metadata. */
export interface Validated<A> {
  readonly representation: A;
  readonly etag: string;
  readonly validatedAt: number;
  readonly validation: "200" | "304";
}

/** An impossible or undeclared response at the generated-client adapter seam. */
export class ClientContractError extends Data.TaggedError("ClientContractError")<{
  readonly message: string;
}> {}

/** One key naming a canonical Issue query in Effect reactivity. */
export const issueReactivityKey = (issueId: string): string => `issue:${issueId}`;

/** One key naming an exact Project Issue-list query in Effect reactivity. */
export const issueListReactivityKey = (projectId: string): string =>
  `project:${projectId}:issues:state=open:sort=updated_at:direction=desc`;

/** Generated Effect HTTP client and Atom runtime for the Overseer declaration. */
export const OverseerApiClient = AtomHttpApi.Service<"OverseerApiClient">()(
  "OverseerApiClient",
  {
    api: OverseerApi,
    httpClient: FetchHttpClient.layer,
    baseUrl: typeof window === "undefined" ? "http://127.0.0.1:5173" : window.location.origin,
  },
);

const previousValue = <A>(
  get: Atom.AtomContext,
): Validated<A> | undefined => {
  const priorResult = Option.getOrUndefined(
    get.self<AsyncResult.AsyncResult<Validated<A>, unknown>>(),
  );
  return priorResult === undefined
    ? undefined
    : Option.getOrUndefined(AsyncResult.value(priorResult));
};

const requireEtag = (headers: Readonly<Record<string, string>>): Effect.Effect<string, ClientContractError> => {
  const etag = headers.etag;
  return etag === undefined
    ? Effect.fail(new ClientContractError({ message: "A successful read omitted its ETag." }))
    : Effect.succeed(etag);
};

const foregroundPollSignal = Atom.family((milliseconds: number) =>
  Atom.readable((get) => {
    const current = Option.getOrElse(get.self<number>(), () => 0);
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const schedule = (): void => {
      if (document.visibilityState !== "visible") return;
      timeout = setTimeout(() => get.setSelf(current + 1), milliseconds);
    };
    const wake = (): void => {
      if (document.visibilityState === "visible") get.setSelf(current + 1);
    };

    schedule();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    get.addFinalizer(() => {
      if (timeout !== undefined) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    });
    return current;
  }),
);

const routeQueryPolicy = <A extends Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>>(
  atom: A,
  pollMilliseconds: number,
) =>
  atom.pipe(
    Atom.swr({
      staleTime: "5 seconds",
      revalidateOnMount: true,
      revalidateOnFocus: true,
    }),
    Atom.makeRefreshOnSignal(foregroundPollSignal(pollMilliseconds)),
    Atom.setIdleTTL("10 minutes"),
  );

const makeIssueQuery = (issueId: string) => {
  const query = OverseerApiClient.runtime.atom((get) => {
    const previous = previousValue<Issue>(get);
    return Effect.gen(function* () {
      const client = yield* OverseerApiClient;
      const [representation, response] = yield* client.issues.get({
        params: { issueId },
        headers: previous === undefined ? {} : { "if-none-match": previous.etag },
        responseMode: "decoded-and-response",
      });
      const etag = yield* requireEtag(response.headers);
      const validatedAt = yield* Clock.currentTimeMillis;
      if (response.status === 304) {
        return previous === undefined
          ? yield* new ClientContractError({
              message: "A 304 response arrived before any Issue representation was cached.",
            })
          : { ...previous, etag, validatedAt, validation: "304" as const };
      }
      return representation === undefined
        ? yield* new ClientContractError({
            message: "A 200 Issue response omitted its representation.",
          })
        : { representation, etag, validatedAt, validation: "200" as const };
    });
  });

  return routeQueryPolicy(
    OverseerApiClient.runtime.factory.withReactivity([issueReactivityKey(issueId)])(query),
    15_000,
  );
};

const makeIssueListQuery = (projectId: string) => {
  const query = OverseerApiClient.runtime.atom((get) => {
    const previous = previousValue<IssueCollection>(get);
    return Effect.gen(function* () {
      const client = yield* OverseerApiClient;
      const [representation, response] = yield* client.issues.list({
        params: { projectId },
        headers: previous === undefined ? {} : { "if-none-match": previous.etag },
        responseMode: "decoded-and-response",
      });
      const etag = yield* requireEtag(response.headers);
      const validatedAt = yield* Clock.currentTimeMillis;
      if (response.status === 304) {
        return previous === undefined
          ? yield* new ClientContractError({
              message: "A 304 response arrived before any Issue-list representation was cached.",
            })
          : { ...previous, etag, validatedAt, validation: "304" as const };
      }
      return representation === undefined
        ? yield* new ClientContractError({
            message: "A 200 Issue-list response omitted its representation.",
          })
        : { representation, etag, validatedAt, validation: "200" as const };
    });
  });

  return routeQueryPolicy(
    OverseerApiClient.runtime.factory.withReactivity([issueListReactivityKey(projectId)])(query),
    30_000,
  );
};

/** Route-mounted, memory-only conditional Issue queries. */
export const issueAtom = Atom.family(makeIssueQuery);

/** Route-mounted, memory-only conditional Project Issue-list queries. */
export const issueListAtom = Atom.family(makeIssueListQuery);

/** Shared optimistic Issue projection used by every Issue mutation. */
export const optimisticIssueAtom = Atom.family((issueId: string) =>
  Atom.optimistic(issueAtom(issueId)),
);

type UpdateTitleInput = {
  readonly projectId: string;
  readonly issueId: string;
  readonly title: string;
};

type SetStateInput = {
  readonly projectId: string;
  readonly issueId: string;
  readonly state: "open" | "closed";
};

/** Failure-lab actions exposed by the prototype-only server. */
export type ControlAction =
  | "external-change"
  | "fail-next-read"
  | "fail-next-write"
  | "slow-next-read"
  | "reset";

/** Effect-native command atom for the prototype-only failure lab. */
export const controlAtom = Atom.fn<ControlAction>()((action) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/prototype/control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      catch: (cause) => new ClientContractError({ message: String(cause) }),
    });
    if (!response.ok) {
      return yield* new ClientContractError({
        message: `Failure-lab control returned ${response.status}`,
      });
    }
  }),
);

const requireFreshIssue = (
  input: { readonly issueId: string },
  get: Atom.FnContext,
): Effect.Effect<Validated<Issue>, unknown> =>
  Effect.gen(function* () {
    const query = issueAtom(input.issueId);
    let current = yield* get.result(query, { suspendOnWaiting: true });
    const now = yield* Clock.currentTimeMillis;
    if (now - current.validatedAt <= 5_000) return current;
    get.refresh(query);
    current = yield* get.result(query, { suspendOnWaiting: true });
    return current;
  });

const updateTitleCommand = OverseerApiClient.runtime.fn<UpdateTitleInput>()((input, get) =>
  Effect.gen(function* () {
    yield* requireFreshIssue(input, get);
    const client = yield* OverseerApiClient;
    return yield* client.issues.update({
      params: { issueId: input.issueId },
      payload: { title: input.title },
    });
  }).pipe(
    Reactivity.mutation([
      issueReactivityKey(input.issueId),
      issueListReactivityKey(input.projectId),
    ]),
  ),
);

const setStateCommand = OverseerApiClient.runtime.fn<SetStateInput>()((input, get) =>
  Effect.gen(function* () {
    yield* requireFreshIssue(input, get);
    const client = yield* OverseerApiClient;
    const request = {
      params: { issueId: input.issueId },
      headers: { "idempotency-key": crypto.randomUUID() },
    };
    return yield* input.state === "closed"
      ? client.issues.close(request)
      : client.issues.reopen(request);
  }).pipe(
    Reactivity.mutation([
      issueReactivityKey(input.issueId),
      issueListReactivityKey(input.projectId),
    ]),
  ),
);

/** Native optimistic title command; failed writes roll back while the local draft remains. */
export const updateTitleAtom = Atom.family((issueId: string) =>
  optimisticIssueAtom(issueId).pipe(
    Atom.optimisticFn({
      reducer: (current, input: UpdateTitleInput) =>
        AsyncResult.map(current, (validated) => ({
          ...validated,
          representation: { ...validated.representation, title: input.title },
        })),
      fn: updateTitleCommand,
    }),
  ),
);

/** Native optimistic lifecycle command with generated close/reopen calls underneath. */
export const setIssueStateAtom = Atom.family((issueId: string) =>
  optimisticIssueAtom(issueId).pipe(
    Atom.optimisticFn({
      reducer: (current, input: SetStateInput) =>
        AsyncResult.map(current, (validated) => ({
          ...validated,
          representation: { ...validated.representation, state: input.state },
        })),
      fn: setStateCommand,
    }),
  ),
);
