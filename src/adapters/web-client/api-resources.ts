import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClientError, type HttpClientResponse } from "effect/unstable/http";
import { AsyncResult, Atom, AtomHttpApi } from "effect/unstable/reactivity";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  DiscoveryDocument,
  DiscoveryPaths,
  IssueCollection,
  Link,
  OverseerApi,
  ProblemDocument,
  ProjectCollection,
  ProjectResponse,
  WorkspaceCollection,
  WorkspaceResponse,
} from "../../contract/http-api.ts";
import {
  ProjectCursor,
  type ProjectCursor as ProjectCursorType,
  type ProjectPageLimit,
  ProjectPageLimitFromString,
  WorkspaceCursor,
  type WorkspaceCursor as WorkspaceCursorType,
  type WorkspacePageLimit,
  WorkspacePageLimitFromString,
} from "../../domain/pagination.ts";
import type { IssueId, LabelId, ProjectId } from "../../domain/entity-id.ts";
import type { Assignee, IssueNumber } from "../../domain/issue.ts";
import type {
  IssueAssigneeStatusFilter,
  IssueBlockingStatusFilter,
  IssueCursor,
  IssueLabelMatchFilter,
  IssueLifecycleFilter,
  IssuePageLimit,
  IssueSort,
  IssueSortDirection,
  IssueStateFilter,
} from "../../domain/pagination.ts";

/** Generated browser client and Atom runtime for Overseer's HTTP contract. */
export class OverseerHttpClient extends AtomHttpApi.Service<OverseerHttpClient>()(
  "@overseer/browser/OverseerHttpClient",
  {
    api: OverseerApi,
    httpClient: FetchHttpClient.layer,
  },
) {}

/** Expected failure classifications for browser resource refreshes. */
export const BrowserReadFailureReason = Schema.Literals([
  "transport",
  "status",
  "decode",
  "pagination",
  "not-modified-without-cache",
]);

/** Expected failure classifications for browser resource refreshes. */
export type BrowserReadFailureReason = typeof BrowserReadFailureReason.Type;

/** A browser resource refresh failed at the HTTP boundary. */
export class BrowserResourceReadFailed extends Schema.TaggedErrorClass<BrowserResourceReadFailed>()(
  "BrowserResourceReadFailed",
  {
    operation: Schema.Literals(["discovery", "workspaces", "projects", "issues"]),
    reason: BrowserReadFailureReason,
    message: Schema.String,
    retryable: Schema.Boolean,
    retryAfterMilliseconds: Schema.Number,
    status: Schema.optional(Schema.Number),
    cause: Schema.Defect(),
  },
) {}

/** Browser-owned discovery data retained with its exact HTTP validator. */
export type DiscoveryResource = {
  readonly data: DiscoveryDocument;
  readonly etag: string;
  readonly validatedAt: number;
};

/** Complete Workspace data assembled for browser navigation, not an HTTP page. */
export type BrowserWorkspaceCollection = {
  readonly items: ReadonlyArray<WorkspaceResponse>;
  readonly links: Readonly<Record<string, Link>>;
};

/** Browser-owned complete Workspace data and the latest page validation time. */
export type WorkspaceResource = {
  readonly collection: BrowserWorkspaceCollection;
  readonly validatedAt: number;
};

/** Complete Project data assembled for browser navigation, not an HTTP page. */
export type BrowserProjectCollection = {
  readonly items: ReadonlyArray<ProjectResponse>;
  readonly links: Readonly<Record<string, Link>>;
};

/** Browser-owned complete Project data and the latest page validation time. */
export type ProjectResource = {
  readonly collection: BrowserProjectCollection;
  readonly validatedAt: number;
};

/** Parsed navigation for one exact Workspace collection page. */
export type WorkspacePageNavigation = {
  readonly exactUrl: string;
  readonly cursor: WorkspaceCursorType;
  readonly limit: WorkspacePageLimit;
};

type CacheEntry<A> = {
  readonly data: A;
  readonly etag: string;
  readonly validatedAt: number;
};

type WorkspacePageQuery = {
  readonly cursor?: WorkspaceCursorType;
  readonly limit?: WorkspacePageLimit;
};

type CachedWorkspacePage = CacheEntry<WorkspaceCollection>;
type CachedProjectPage = CacheEntry<ProjectCollection>;

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);

function browserOrigin(): string {
  return globalThis.location?.origin ?? "https://overseer.invalid";
}

function retryAfterMilliseconds(header: string | undefined, now: number): number {
  if (header === undefined) return 0;
  const deltaSeconds = Number(header);
  if (Number.isFinite(deltaSeconds) && deltaSeconds >= 0) {
    return deltaSeconds * 1_000;
  }
  return Option.match(DateTime.make(header), {
    onNone: () => 0,
    onSome: (retryAt) => Math.max(0, DateTime.toEpochMillis(retryAt) - now),
  });
}

/** Return the retry delay for a zero-based failure count, honoring longer server advice. */
export function browserResourceRetryDelay(
  failureCount: number,
  advisedMilliseconds: number,
): number {
  const policyMilliseconds =
    failureCount === 0 ? 5_000 : failureCount === 1 ? 15_000 : failureCount === 2 ? 30_000 : 60_000;
  return Math.max(policyMilliseconds, advisedMilliseconds);
}

type BrowserResourceRetryState = {
  failureCount: number;
  timeout: ReturnType<typeof setTimeout> | undefined;
};

function withBrowserResourceRetry<A>(
  source: Atom.Atom<AsyncResult.AsyncResult<A, BrowserResourceReadFailed>>,
): Atom.Atom<AsyncResult.AsyncResult<A, BrowserResourceReadFailed>> {
  const retryStates = new WeakMap<AtomRegistry.AtomRegistry, BrowserResourceRetryState>();

  return Atom.readable(
    (get) => {
      const retryState = retryStates.get(get.registry) ?? {
        failureCount: 0,
        timeout: undefined,
      };
      retryStates.set(get.registry, retryState);
      if (retryState.timeout !== undefined) clearTimeout(retryState.timeout);
      retryState.timeout = undefined;
      const result = get(source);
      if (result._tag === "Success") {
        retryState.failureCount = 0;
      } else if (result._tag === "Failure" && !result.waiting) {
        const failure = Cause.findErrorOption(result.cause);
        if (Option.isSome(failure) && failure.value.retryable) {
          const delay = browserResourceRetryDelay(
            retryState.failureCount,
            failure.value.retryAfterMilliseconds,
          );
          retryState.failureCount += 1;
          // Atom's dynamic refresh boundary is callback-based. Mirror Atom.withRefresh so the
          // failure stays observable while the registry lifetime owns cancellation.
          retryState.timeout = setTimeout(() => get.refresh(source), delay);
        }
      }
      get.addFinalizer(() => {
        if (retryState.timeout !== undefined) clearTimeout(retryState.timeout);
        retryStates.delete(get.registry);
      });
      return result;
    },
    (refresh) => refresh(source),
  );
}

function readFailure(options: {
  readonly operation: "discovery" | "workspaces" | "projects" | "issues";
  readonly reason: BrowserReadFailureReason;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMilliseconds?: number;
  readonly status?: number;
  readonly cause: unknown;
}): BrowserResourceReadFailed {
  const input = {
    operation: options.operation,
    reason: options.reason,
    message: options.message,
    retryable: options.retryable,
    retryAfterMilliseconds: options.retryAfterMilliseconds ?? 0,
    cause: options.cause,
  };
  return options.status === undefined
    ? new BrowserResourceReadFailed(input)
    : new BrowserResourceReadFailed({ ...input, status: options.status });
}

function transportFailure(
  operation: "discovery" | "workspaces" | "projects" | "issues",
  cause: HttpClientError.HttpClientError,
): BrowserResourceReadFailed {
  return readFailure({
    operation,
    reason: "transport",
    message: `Browser ${operation} transport failed`,
    retryable: true,
    cause,
  });
}

const EntityTag = Schema.String.check(Schema.isPattern(/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/));

function decodeModified<A>(options: {
  readonly operation: "discovery" | "workspaces" | "projects" | "issues";
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly schema: Schema.ConstraintDecoder<A, never>;
  readonly now: number;
}): Effect.Effect<CacheEntry<A>, BrowserResourceReadFailed> {
  const etag = options.response.headers.etag;
  return Effect.gen(function* () {
    const parsedEtag = yield* Schema.decodeUnknownEffect(EntityTag)(etag).pipe(
      Effect.mapError((cause) =>
        readFailure({
          operation: options.operation,
          reason: "decode",
          message: `Browser ${options.operation} response ETag was invalid`,
          retryable: false,
          cause,
        }),
      ),
    );
    const json = yield* options.response.json.pipe(
      Effect.mapError((cause) =>
        readFailure({
          operation: options.operation,
          reason: "decode",
          message: `Browser ${options.operation} response body could not be read`,
          retryable: false,
          cause,
        }),
      ),
    );
    const data = yield* Schema.decodeUnknownEffect(options.schema)(json).pipe(
      Effect.mapError((cause) =>
        readFailure({
          operation: options.operation,
          reason: "decode",
          message: `Browser ${options.operation} response data was invalid`,
          retryable: false,
          cause,
        }),
      ),
    );
    return { data, etag: parsedEtag, validatedAt: options.now };
  });
}

function classifyStatus(
  operation: "discovery" | "workspaces" | "projects" | "issues",
  response: HttpClientResponse.HttpClientResponse,
  now: number,
): Effect.Effect<never, BrowserResourceReadFailed> {
  const statusRetryable = retryableStatuses.has(response.status);
  const advisedMilliseconds = retryAfterMilliseconds(response.headers["retry-after"], now);
  return response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ProblemDocument)),
    Effect.matchEffect({
      onFailure: (cause) =>
        Effect.fail(
          readFailure({
            operation,
            reason: "status",
            message: `Browser ${operation} request returned HTTP ${response.status}`,
            retryable: statusRetryable,
            retryAfterMilliseconds: advisedMilliseconds,
            status: response.status,
            cause,
          }),
        ),
      onSuccess: (problem) =>
        Effect.fail(
          readFailure({
            operation,
            reason: "status",
            message: `Browser ${operation} request returned ${problem.code}`,
            retryable: problem.retryable,
            retryAfterMilliseconds: advisedMilliseconds,
            status: response.status,
            cause: problem,
          }),
        ),
    }),
  );
}

/** Parse and constrain a Workspace next link to the current origin and list endpoint. */
export const parseWorkspacePageNavigation = Effect.fn("Browser.parseWorkspacePageNavigation")(
  function* (
    href: string,
    origin: string,
  ): Effect.fn.Return<WorkspacePageNavigation, BrowserResourceReadFailed> {
    const url = yield* Effect.try({
      try: () => new URL(href, origin),
      catch: (cause) =>
        readFailure({
          operation: "workspaces",
          reason: "pagination",
          message: "Browser Workspace pagination link was invalid",
          retryable: false,
          cause,
        }),
    });
    if (
      url.origin !== origin ||
      url.pathname !== DiscoveryPaths.workspaces ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      return yield* Effect.fail(
        readFailure({
          operation: "workspaces",
          reason: "pagination",
          message: "Browser Workspace pagination link changed origin or path",
          retryable: false,
          cause: href,
        }),
      );
    }
    const keys = Array.from(url.searchParams.keys());
    if (
      keys.some((key) => key !== "cursor" && key !== "limit") ||
      url.searchParams.getAll("cursor").length !== 1 ||
      url.searchParams.getAll("limit").length !== 1
    ) {
      return yield* Effect.fail(
        readFailure({
          operation: "workspaces",
          reason: "pagination",
          message: "Browser Workspace pagination link had unexpected query parameters",
          retryable: false,
          cause: href,
        }),
      );
    }
    const parsed = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        cursor: WorkspaceCursor,
        limit: WorkspacePageLimitFromString,
      }),
    )({
      cursor: url.searchParams.get("cursor"),
      limit: url.searchParams.get("limit"),
    }).pipe(
      Effect.mapError((cause) =>
        readFailure({
          operation: "workspaces",
          reason: "pagination",
          message: "Browser Workspace pagination query was invalid",
          retryable: false,
          cause,
        }),
      ),
    );
    url.search = new URLSearchParams({
      cursor: parsed.cursor,
      limit: String(parsed.limit),
    }).toString();
    return {
      exactUrl: url.href,
      cursor: parsed.cursor,
      limit: parsed.limit,
    };
  },
);

let retainedDiscovery: Option.Option<DiscoveryResource> = Option.none();

const readDiscovery = OverseerHttpClient.use((client) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const response = yield* client.discovery
      .discover({
        headers: Option.match(retainedDiscovery, {
          onNone: () => ({}),
          onSome: (resource) => ({ "if-none-match": resource.etag }),
        }),
        responseMode: "response-only",
      })
      .pipe(
        Effect.mapError((cause) =>
          HttpClientError.isHttpClientError(cause)
            ? transportFailure("discovery", cause)
            : readFailure({
                operation: "discovery",
                reason: "status",
                message: "Browser discovery client returned a typed API failure",
                retryable: cause.retryable,
                cause,
              }),
        ),
      );
    if (response.status === 304) {
      if (Option.isNone(retainedDiscovery)) {
        return yield* Effect.fail(
          readFailure({
            operation: "discovery",
            reason: "not-modified-without-cache",
            message: "Browser discovery received 304 without cached data",
            retryable: false,
            cause: response,
          }),
        );
      }
      const validated = { ...retainedDiscovery.value, validatedAt: now };
      retainedDiscovery = Option.some(validated);
      return validated;
    }
    if (response.status !== 200) return yield* classifyStatus("discovery", response, now);
    const resource = yield* decodeModified({
      operation: "discovery",
      response,
      schema: DiscoveryDocument,
      now,
    });
    retainedDiscovery = Option.some(resource);
    return resource;
  }),
);

/** Cached API discovery query with cancellation-safe retry and ETag validation. */
export const discoveryQuery = OverseerHttpClient.runtime.atom(readDiscovery).pipe(
  Atom.swr({
    staleTime: "5 seconds",
    revalidateOnFocus: true,
    focusSignal: Atom.windowFocusSignal,
  }),
  Atom.withRefresh("5 minutes"),
  withBrowserResourceRetry,
  Atom.setIdleTTL("5 minutes"),
);

let retainedWorkspacePages = new Map<string, CachedWorkspacePage>();

const readWorkspacePage = Effect.fn("Browser.readWorkspacePage")(function* (
  exactUrl: string,
  query: WorkspacePageQuery,
  previousPages: ReadonlyMap<string, CachedWorkspacePage>,
  validatedPages: Map<string, CachedWorkspacePage>,
): Effect.fn.Return<CachedWorkspacePage, BrowserResourceReadFailed, OverseerHttpClient> {
  const client = yield* OverseerHttpClient;
  const previous = previousPages.get(exactUrl);
  const now = yield* Clock.currentTimeMillis;
  const response = yield* client.workspaces
    .listWorkspaces({
      headers: previous === undefined ? {} : { "if-none-match": previous.etag },
      query,
      responseMode: "response-only",
    })
    .pipe(
      Effect.mapError((cause) =>
        HttpClientError.isHttpClientError(cause)
          ? transportFailure("workspaces", cause)
          : readFailure({
              operation: "workspaces",
              reason: "status",
              message: "Browser Workspace client returned a typed API failure",
              retryable: cause.retryable,
              cause,
            }),
      ),
    );
  if (response.status === 304) {
    if (previous === undefined) {
      return yield* Effect.fail(
        readFailure({
          operation: "workspaces",
          reason: "not-modified-without-cache",
          message: "Browser Workspace page received 304 without cached data",
          retryable: false,
          cause: response,
        }),
      );
    }
    const validated = { ...previous, validatedAt: now };
    validatedPages.set(exactUrl, validated);
    return validated;
  }
  if (response.status !== 200) return yield* classifyStatus("workspaces", response, now);
  const page = yield* decodeModified({
    operation: "workspaces",
    response,
    schema: WorkspaceCollection,
    now,
  });
  validatedPages.set(exactUrl, page);
  return page;
});

const readWorkspaceCollection = Effect.gen(function* () {
  const origin = browserOrigin();
  const previousPages = retainedWorkspacePages;
  const validatedPages = new Map<string, CachedWorkspacePage>();
  const items: Array<WorkspaceResponse> = [];
  let links: Readonly<Record<string, Link>> = {};
  let query: WorkspacePageQuery = {};
  let exactUrl = new URL(DiscoveryPaths.workspaces, origin).href;
  let latestValidation = 0;
  const seenCursors = new Set<WorkspaceCursorType>();

  while (true) {
    const page = yield* readWorkspacePage(exactUrl, query, previousPages, validatedPages);
    items.push(...page.data.items);
    latestValidation = Math.max(latestValidation, page.validatedAt);
    if (items.length === page.data.items.length) {
      const { next: _next, ...stableLinks } = page.data.links;
      links = stableLinks;
    }
    const next = page.data.links.next;
    if (next === undefined) {
      retainedWorkspacePages = validatedPages;
      return {
        collection: { items, links },
        validatedAt: latestValidation,
      } satisfies WorkspaceResource;
    }
    const navigation = yield* parseWorkspacePageNavigation(next.href, origin);
    if (seenCursors.has(navigation.cursor)) {
      return yield* Effect.fail(
        readFailure({
          operation: "workspaces",
          reason: "pagination",
          message: "Browser Workspace pagination repeated a cursor",
          retryable: false,
          cause: navigation.cursor,
        }),
      );
    }
    seenCursors.add(navigation.cursor);
    exactUrl = navigation.exactUrl;
    query = { cursor: navigation.cursor, limit: navigation.limit };
  }
});

/** Complete Workspace collection query with per-page ETag cache validation. */
export const workspaceQuery = OverseerHttpClient.runtime.atom(readWorkspaceCollection).pipe(
  Atom.swr({
    staleTime: "5 seconds",
    revalidateOnFocus: true,
    focusSignal: Atom.windowFocusSignal,
  }),
  Atom.withRefresh("30 seconds"),
  withBrowserResourceRetry,
  Atom.setIdleTTL("5 minutes"),
);

/** Parse and constrain a Project next link to the current origin and top-level collection. */
export const parseProjectPageNavigation = Effect.fn("Browser.parseProjectPageNavigation")(
  function* (
    href: string,
    origin: string,
  ): Effect.fn.Return<
    {
      readonly exactUrl: string;
      readonly cursor: ProjectCursorType;
      readonly limit: ProjectPageLimit;
    },
    BrowserResourceReadFailed
  > {
    const url = yield* Effect.try({
      try: () => new URL(href, origin),
      catch: (cause) =>
        readFailure({
          operation: "projects",
          reason: "pagination",
          message: "Browser Project pagination link was invalid",
          retryable: false,
          cause,
        }),
    });
    if (
      url.origin !== origin ||
      url.pathname !== DiscoveryPaths.projects ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      return yield* Effect.fail(
        readFailure({
          operation: "projects",
          reason: "pagination",
          message: "Browser Project pagination link changed origin or path",
          retryable: false,
          cause: href,
        }),
      );
    }
    const keys = Array.from(url.searchParams.keys());
    if (
      keys.some((key) => key !== "cursor" && key !== "limit") ||
      url.searchParams.getAll("cursor").length !== 1 ||
      url.searchParams.getAll("limit").length !== 1
    ) {
      return yield* Effect.fail(
        readFailure({
          operation: "projects",
          reason: "pagination",
          message: "Browser Project pagination link had unexpected query parameters",
          retryable: false,
          cause: href,
        }),
      );
    }
    const parsed = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ cursor: ProjectCursor, limit: ProjectPageLimitFromString }),
    )({ cursor: url.searchParams.get("cursor"), limit: url.searchParams.get("limit") }).pipe(
      Effect.mapError((cause) =>
        readFailure({
          operation: "projects",
          reason: "pagination",
          message: "Browser Project pagination query was invalid",
          retryable: false,
          cause,
        }),
      ),
    );
    url.search = new URLSearchParams({
      cursor: parsed.cursor,
      limit: String(parsed.limit),
    }).toString();
    return { exactUrl: url.href, cursor: parsed.cursor, limit: parsed.limit };
  },
);

let retainedProjectPages = new Map<string, CachedProjectPage>();

const readProjectPage = Effect.fn("Browser.readProjectPage")(function* (
  exactUrl: string,
  query: { readonly cursor?: ProjectCursorType; readonly limit?: ProjectPageLimit },
  previousPages: ReadonlyMap<string, CachedProjectPage>,
  validatedPages: Map<string, CachedProjectPage>,
): Effect.fn.Return<CachedProjectPage, BrowserResourceReadFailed, OverseerHttpClient> {
  const client = yield* OverseerHttpClient;
  const previous = previousPages.get(exactUrl);
  const now = yield* Clock.currentTimeMillis;
  const response = yield* client.projects
    .listProjects({
      headers: previous === undefined ? {} : { "if-none-match": previous.etag },
      query,
      responseMode: "response-only",
    })
    .pipe(
      Effect.mapError((cause) =>
        HttpClientError.isHttpClientError(cause)
          ? transportFailure("projects", cause)
          : readFailure({
              operation: "projects",
              reason: "status",
              message: "Browser Project client returned a typed API failure",
              retryable: cause.retryable,
              cause,
            }),
      ),
    );
  if (response.status === 304) {
    if (previous === undefined)
      return yield* Effect.fail(
        readFailure({
          operation: "projects",
          reason: "not-modified-without-cache",
          message: "Browser Project page received 304 without cached data",
          retryable: false,
          cause: response,
        }),
      );
    const validated = { ...previous, validatedAt: now };
    validatedPages.set(exactUrl, validated);
    return validated;
  }
  if (response.status !== 200) return yield* classifyStatus("projects", response, now);
  const page = yield* decodeModified({
    operation: "projects",
    response,
    schema: ProjectCollection,
    now,
  });
  validatedPages.set(exactUrl, page);
  return page;
});

const readProjectCollection = Effect.gen(function* () {
  const origin = browserOrigin();
  const previousPages = retainedProjectPages;
  const validatedPages = new Map<string, CachedProjectPage>();
  const items: Array<ProjectResponse> = [];
  let links: Readonly<Record<string, Link>> = {};
  let query: { readonly cursor?: ProjectCursorType; readonly limit?: ProjectPageLimit } = {};
  let exactUrl = new URL(DiscoveryPaths.projects, origin).href;
  let latestValidation = 0;
  const seenCursors = new Set<ProjectCursorType>();
  while (true) {
    const page = yield* readProjectPage(exactUrl, query, previousPages, validatedPages);
    items.push(...page.data.items);
    latestValidation = Math.max(latestValidation, page.validatedAt);
    if (items.length === page.data.items.length) {
      const { next: _next, ...stableLinks } = page.data.links;
      links = stableLinks;
    }
    const next = page.data.links.next;
    if (next === undefined) {
      retainedProjectPages = validatedPages;
      return {
        collection: { items, links },
        validatedAt: latestValidation,
      } satisfies ProjectResource;
    }
    const navigation = yield* parseProjectPageNavigation(next.href, origin);
    if (seenCursors.has(navigation.cursor))
      return yield* Effect.fail(
        readFailure({
          operation: "projects",
          reason: "pagination",
          message: "Browser Project pagination repeated a cursor",
          retryable: false,
          cause: navigation.cursor,
        }),
      );
    seenCursors.add(navigation.cursor);
    exactUrl = navigation.exactUrl;
    query = { cursor: navigation.cursor, limit: navigation.limit };
  }
});

/** Exact URL-owned filters selecting one rendered Project Issue page. */
export type BrowserIssueListQuery = {
  readonly state?: IssueStateFilter;
  readonly lifecycle?: IssueLifecycleFilter;
  readonly assignee?: Assignee;
  readonly assignee_status?: IssueAssigneeStatusFilter;
  readonly label_id?: LabelId | ReadonlyArray<LabelId>;
  readonly label_match?: IssueLabelMatchFilter;
  readonly parent?: "root" | IssueId;
  readonly blocking_status?: IssueBlockingStatusFilter;
  readonly number?: IssueNumber;
  readonly sort?: IssueSort;
  readonly direction?: IssueSortDirection;
  readonly cursor?: IssueCursor;
  readonly limit?: IssuePageLimit;
};

function issueListSearchParameters(query: BrowserIssueListQuery): URLSearchParams {
  const singletonParameters: ReadonlyArray<readonly [string, string | number | undefined]> = [
    ["state", query.state],
    ["lifecycle", query.lifecycle],
    ["assignee", query.assignee],
    ["assignee_status", query.assignee_status],
    ["label_match", query.label_match],
    ["parent", query.parent],
    ["blocking_status", query.blocking_status],
    ["number", query.number],
    ["sort", query.sort],
    ["direction", query.direction],
    ["cursor", query.cursor],
    ["limit", query.limit],
  ];
  const parameters = new URLSearchParams();
  for (const [name, value] of singletonParameters) {
    if (value !== undefined) parameters.set(name, String(value));
  }

  const labelIds =
    typeof query.label_id === "string"
      ? [query.label_id]
      : query.label_id === undefined
        ? []
        : query.label_id;
  for (const labelId of labelIds) parameters.append("label_id", labelId);
  return parameters;
}

function issueListExactUrl(projectId: ProjectId, query: BrowserIssueListQuery): string {
  const url = new URL(`/api/projects/${projectId}/issues`, browserOrigin());
  url.search = issueListSearchParameters(query).toString();
  return url.href;
}

const retainedIssuePages = new Map<string, CacheEntry<IssueCollection>>();

const readIssuePage = Effect.fn("Browser.readIssuePage")(function* (
  projectId: ProjectId,
  query: BrowserIssueListQuery,
): Effect.fn.Return<CacheEntry<IssueCollection>, BrowserResourceReadFailed, OverseerHttpClient> {
  const client = yield* OverseerHttpClient;
  const exactUrl = issueListExactUrl(projectId, query);
  const previous = retainedIssuePages.get(exactUrl);
  const now = yield* Clock.currentTimeMillis;
  const response = yield* client.issues
    .listIssues({
      params: { project_id: projectId },
      query,
      headers: previous === undefined ? {} : { "if-none-match": previous.etag },
      responseMode: "response-only",
    })
    .pipe(
      Effect.mapError((cause) =>
        HttpClientError.isHttpClientError(cause)
          ? transportFailure("issues", cause)
          : readFailure({
              operation: "issues",
              reason: "status",
              message: "Browser Issue client returned a typed API failure",
              retryable: cause.retryable,
              cause,
            }),
      ),
    );
  if (response.status === 304) {
    if (previous === undefined)
      return yield* Effect.fail(
        readFailure({
          operation: "issues",
          reason: "not-modified-without-cache",
          message: "Browser Issue page received 304 without cached data",
          retryable: false,
          cause: response,
        }),
      );
    const validated = { ...previous, validatedAt: now };
    retainedIssuePages.set(exactUrl, validated);
    return validated;
  }
  if (response.status !== 200) return yield* classifyStatus("issues", response, now);
  const page = yield* decodeModified({
    operation: "issues",
    response,
    schema: IssueCollection,
    now,
  });
  retainedIssuePages.set(exactUrl, page);
  return page;
});

/** Build one conditionally validated Project Issue page with a 30-second visible-route cadence. */
export function makeIssueListQuery(
  projectId: ProjectId,
  query: BrowserIssueListQuery,
): Atom.Atom<AsyncResult.AsyncResult<IssueCollection, BrowserResourceReadFailed>> {
  return OverseerHttpClient.runtime
    .atom(readIssuePage(projectId, query).pipe(Effect.map((page) => page.data)))
    .pipe(
      Atom.swr({
        staleTime: "5 seconds",
        revalidateOnFocus: true,
        focusSignal: Atom.windowFocusSignal,
      }),
      Atom.withRefresh("30 seconds"),
      withBrowserResourceRetry,
      Atom.setIdleTTL("5 minutes"),
    );
}

/** Create-Issue command backed by the generated HTTP contract client. */
export const createIssueMutation = OverseerHttpClient.mutation("issues", "createIssue");

/** Canonical Issue query family with focused-route polling. */
export const issueQuery = Atom.family((issueId: IssueId) =>
  OverseerHttpClient.query("issues", "readIssue", {
    params: { issue_id: issueId },
    headers: {},
  }).pipe(
    Atom.swr({
      staleTime: "5 seconds",
      revalidateOnFocus: true,
      focusSignal: Atom.windowFocusSignal,
    }),
    Atom.withRefresh("15 seconds"),
    Atom.setIdleTTL("5 minutes"),
  ),
);

/** Complete Project collection query with per-page ETag cache validation. */
export const projectQuery = OverseerHttpClient.runtime.atom(readProjectCollection).pipe(
  Atom.swr({
    staleTime: "5 seconds",
    revalidateOnFocus: true,
    focusSignal: Atom.windowFocusSignal,
  }),
  Atom.withRefresh("30 seconds"),
  withBrowserResourceRetry,
  Atom.setIdleTTL("5 minutes"),
);
