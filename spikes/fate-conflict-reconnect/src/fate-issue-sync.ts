import {
  clientRoot,
  ConnectionTag,
  createClient,
  mutation,
  toEntityId,
  view,
  type ConnectionMetadata,
  type Transport,
} from "@nkzw/fate";
import type { AgentRestApi } from "./agent-rest.js";
import type { IssueSnapshot } from "./issue-authority.js";

/** Fate's normalized form of an Issue; `__typename` never enters the REST contract. */
type FateIssue = {
  __typename: "Issue";
  id: string;
  number: number;
  state: "closed" | "open";
  title: string;
  version: number;
};

type UpdateIssueInput = Readonly<{
  expectedVersion: number;
  id: string;
  state?: "closed" | "open";
  title?: string;
}>;

type IssueMutationTransport = {
  "issue.update": { input: UpdateIssueInput; output: FateIssue };
};

const IssueView = view<FateIssue>()({
  id: true,
  number: true,
  state: true,
  title: true,
  version: true,
});

const IssueConnectionView = {
  items: { cursor: true, node: IssueView },
  pagination: { hasNext: true, hasPrevious: true },
} as const;

const roots = {
  issue: clientRoot("Issue"),
  issues: clientRoot("Issue"),
};
const mutations = {
  "issue.update": mutation<FateIssue, UpdateIssueInput, FateIssue>("Issue"),
};

const toFateIssue = (issue: IssueSnapshot): FateIssue => ({ __typename: "Issue", ...issue });

const isIssueSnapshot = (input: unknown): input is IssueSnapshot => {
  if (!input || typeof input !== "object") {
    return false;
  }

  return (
    "id" in input &&
    typeof input.id === "string" &&
    "number" in input &&
    typeof input.number === "number" &&
    "state" in input &&
    (input.state === "open" || input.state === "closed") &&
    "title" in input &&
    typeof input.title === "string" &&
    "version" in input &&
    typeof input.version === "number"
  );
};

const readJson = async (response: Response): Promise<unknown> => response.json();

const readIssueResponse = async (response: Response): Promise<IssueSnapshot> => {
  const body = await readJson(response);
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    !("issue" in body) ||
    !isIssueSnapshot(body.issue)
  ) {
    throw new Error(`Fate REST adapter expected an issue response (${response.status}).`);
  }
  return body.issue;
};

const readIssueListResponse = async (response: Response): Promise<ReadonlyArray<IssueSnapshot>> => {
  const body = await readJson(response);
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    !("items" in body) ||
    !Array.isArray(body.items) ||
    !body.items.every(isIssueSnapshot)
  ) {
    throw new Error(`Fate REST adapter expected an issue-list response (${response.status}).`);
  }
  return body.items;
};

/** Structured conflict preserved from the public REST response. */
export class VersionConflict extends Error {
  /** tRPC-compatible status metadata used by Fate to classify this as a call-site error. */
  readonly data = { code: "CONFLICT" } as const;

  /** Construct an actionable version conflict. */
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
    readonly attempted: UpdateIssueInput,
    readonly current: IssueSnapshot,
  ) {
    super("The issue changed after it was loaded.");
    this.name = "VersionConflict";
  }
}

const readConflict = async (response: Response): Promise<VersionConflict> => {
  const body = await readJson(response);
  const error =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? body.error
      : undefined;
  if (
    response.status !== 409 ||
    !error ||
    !("code" in error) ||
    error.code !== "version_conflict" ||
    !("expectedVersion" in error) ||
    typeof error.expectedVersion !== "number" ||
    !("actualVersion" in error) ||
    typeof error.actualVersion !== "number" ||
    !("attempted" in error) ||
    !error.attempted ||
    typeof error.attempted !== "object" ||
    !("id" in error.attempted) ||
    typeof error.attempted.id !== "string" ||
    !("expectedVersion" in error.attempted) ||
    typeof error.attempted.expectedVersion !== "number" ||
    !("current" in error) ||
    !isIssueSnapshot(error.current)
  ) {
    throw new Error("Fate REST adapter expected an actionable version-conflict response.");
  }

  const attemptedBody = error.attempted;
  const attemptedId = attemptedBody.id;
  const attemptedExpectedVersion = attemptedBody.expectedVersion;
  if (typeof attemptedId !== "string" || typeof attemptedExpectedVersion !== "number") {
    throw new Error("Fate REST adapter received an invalid attempted edit.");
  }
  const attemptedState = "state" in attemptedBody ? attemptedBody.state : undefined;
  const attemptedTitle = "title" in attemptedBody ? attemptedBody.title : undefined;
  const attempted: UpdateIssueInput = {
    expectedVersion: attemptedExpectedVersion,
    id: attemptedId,
    ...(attemptedState === "open" || attemptedState === "closed"
      ? { state: attemptedState }
      : {}),
    ...(typeof attemptedTitle === "string" ? { title: attemptedTitle } : {}),
  };
  return new VersionConflict(
    error.expectedVersion,
    error.actualVersion,
    attempted,
    error.current,
  );
};

class ReconnectRepairs {
  readonly #repairs = new Set<() => Promise<void> | void>();
  #disconnected = false;

  disconnect(): void {
    this.#disconnected = true;
  }

  register(repair: () => Promise<void> | void): () => void {
    this.#repairs.add(repair);
    return () => this.#repairs.delete(repair);
  }

  async reconnect(): Promise<void> {
    if (!this.#disconnected) {
      return;
    }
    this.#disconnected = false;
    await Promise.all([...this.#repairs].map((repair) => repair()));
  }
}

class RestBackedFateTransport implements Transport<IssueMutationTransport> {
  readonly #pending = new Set<Promise<unknown>>();

  constructor(
    private readonly api: AgentRestApi,
    private readonly repairs: ReconnectRepairs,
  ) {}

  async fetchById(
    type: string,
    ids: Array<string | number>,
    _select: Iterable<string>,
    _args?: Record<string, unknown>,
  ): Promise<Array<unknown>> {
    if (type !== "Issue") {
      throw new Error(`Unsupported Fate entity type: ${type}`);
    }

    return Promise.all(
      ids.map(async (id) => {
        const response = await this.api.fetch(
          new Request(`https://overseer.test/api/projects/prj_overseer/issues/${String(id)}`),
        );
        return toFateIssue(await readIssueResponse(response));
      }),
    );
  }

  async fetchList(
    procedure: string,
    _select: Iterable<string>,
    args?: Record<string, unknown>,
  ) {
    if (procedure !== "issues") {
      throw new Error(`Unsupported Fate list: ${procedure}`);
    }

    const state = args?.state;
    if (state !== undefined && state !== "open" && state !== "closed") {
      throw new Error("Unsupported issue-list state filter.");
    }
    const url = new URL("https://overseer.test/api/projects/prj_overseer/issues");
    if (state) {
      url.searchParams.set("state", state);
    }
    const issues = await readIssueListResponse(await this.api.fetch(new Request(url)));
    return {
      items: issues.map((issue) => ({ cursor: String(issue.number), node: toFateIssue(issue) })),
      pagination: { hasNext: false, hasPrevious: false },
    };
  }

  async mutate<K extends "issue.update">(
    procedure: K,
    input: IssueMutationTransport[K]["input"],
    _select: Set<string>,
  ): Promise<IssueMutationTransport[K]["output"]> {
    if (procedure !== "issue.update") {
      throw new Error(`Unsupported Fate mutation: ${procedure}`);
    }

    const response = await this.api.fetch(
      new Request(`https://overseer.test/api/projects/prj_overseer/issues/${input.id}`, {
        body: JSON.stringify({ state: input.state, title: input.title }),
        headers: {
          "content-type": "application/json",
          "if-match": `"v${input.expectedVersion}"`,
        },
        method: "PATCH",
      }),
    );
    if (response.status === 409) {
      throw await readConflict(response);
    }
    return toFateIssue(await readIssueResponse(response));
  }

  subscribeById(
    type: string,
    id: string | number,
    _select: Iterable<string>,
    _args: Record<string, unknown> | undefined,
    handlers: {
      onData(record: unknown, select?: ReadonlyArray<string>): void;
      onDelete?(id?: string | number): void;
      onError?(error: unknown): void;
    },
  ): () => void {
    return this.repairs.register(async () => {
      try {
        const [issue] = await this.fetchById(type, [id], []);
        handlers.onData(issue);
      } catch (error) {
        handlers.onError?.(error);
      }
    });
  }

  subscribeConnection(
    _procedure: string,
    _type: string,
    _args: Record<string, unknown> | undefined,
    _select: Iterable<string>,
    _selectionArgs: Record<string, unknown> | undefined,
    handlers: {
      onError?(error: unknown): void;
      onEvent(event: { type: "invalidate" }): void;
    },
  ): () => void {
    return this.repairs.register(() => {
      handlers.onEvent({ type: "invalidate" });
    });
  }

  track<T>(operation: Promise<T>): Promise<T> {
    this.#pending.add(operation);
    return operation.finally(() => this.#pending.delete(operation));
  }

  async settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    while (this.#pending.size > 0) {
      await Promise.all(this.#pending);
    }
  }
}

/** Conflict result exposed by the application-owned client interface. */
export type EditIssueResult =
  | Readonly<{ _tag: "updated"; issue: IssueSnapshot }>
  | Readonly<{
      _tag: "versionConflict";
      actualVersion: number;
      attempted: UpdateIssueInput;
      current: IssueSnapshot;
      expectedVersion: number;
    }>;

/** Small application-owned sync interface hiding all Fate types from feature code. */
export class FateIssueSync {
  readonly #client;
  readonly #repairs = new ReconnectRepairs();
  readonly #transport: RestBackedFateTransport;
  readonly #disposers: Array<() => void> = [];

  /** Create the removable Fate adapter over the public REST contract. */
  constructor(api: AgentRestApi) {
    this.#transport = new RestBackedFateTransport(api, this.#repairs);
    const transport: Transport<IssueMutationTransport> = {
      fetchById: (...args) => this.#transport.track(this.#transport.fetchById(...args)),
      fetchList: (...args) => this.#transport.track(this.#transport.fetchList(...args)),
      mutate: (...args) => this.#transport.track(this.#transport.mutate(...args)),
      subscribeById: (...args) => this.#transport.subscribeById(...args),
      subscribeConnection: (...args) => this.#transport.subscribeConnection(...args),
    };
    this.#client = createClient<[typeof roots, typeof mutations]>({
      mutations,
      roots,
      transport,
      types: [{ type: "Issue" }],
    });
  }

  /** Load and retain the minimal open-issue list and issue detail flow. */
  async load(id: string): Promise<void> {
    const request = {
      issue: { id, view: IssueView },
      issues: { args: { state: "open" }, list: IssueConnectionView },
    } as const;
    const result = await this.#client.request(request, { mode: "network-only" });
    this.#disposers.push(this.#client.subscribeLiveView(IssueView, result.issue));

    // SAFETY: Fate attaches this metadata to every root connection at runtime but omits it
    // from ConnectionRef's public TypeScript shape.
    const connection = result.issues as typeof result.issues & {
      readonly [ConnectionTag]: ConnectionMetadata;
    };
    this.#disposers.push(
      this.#client.subscribeLiveListView(IssueView, connection[ConnectionTag]),
    );
  }

  /** Return the currently rendered detail snapshot from Fate's normalized cache. */
  detail(id: string): IssueSnapshot {
    const record = this.#client.store.read(toEntityId("Issue", id));
    if (!isIssueSnapshot(record)) {
      throw new Error("PROTOTYPE defect: issue detail was not loaded.");
    }
    return {
      id: record.id,
      number: record.number,
      state: record.state,
      title: record.title,
      version: record.version,
    };
  }

  /** Return IDs currently rendered by the open-issue list. */
  openIssueIds(): ReadonlyArray<string> {
    const result = this.#client.getRequestResult({
      issues: { args: { state: "open" }, list: IssueConnectionView },
    });
    return result.issues.items.map(({ node }) => String(node.id));
  }

  /** Edit through Fate optimism while preserving REST's actionable conflict contract. */
  async editTitle(
    input: UpdateIssueInput & Readonly<{ title: string }>,
  ): Promise<EditIssueResult> {
    const outcome = await this.#client.mutations.issue.update({
      input,
      optimistic: { title: input.title },
      view: IssueView,
    });
    if (!outcome.error) {
      const issue = outcome.result;
      return {
        _tag: "updated",
        issue: {
          id: issue.id,
          number: issue.number,
          state: issue.state,
          title: issue.title,
          version: issue.version,
        },
      };
    }
    if (!(outcome.error instanceof VersionConflict)) {
      throw outcome.error;
    }

    // Fate rolls back the optimistic overlay. Then an authoritative REST read updates the
    // normalized cache; feature code still receives both attempted and current values.
    await this.#client.request(
      { issue: { id: input.id, view: IssueView } },
      { mode: "network-only" },
    );
    return {
      _tag: "versionConflict",
      actualVersion: outcome.error.actualVersion,
      attempted: outcome.error.attempted,
      current: outcome.error.current,
      expectedVersion: outcome.error.expectedVersion,
    };
  }

  /** Mark the application-owned realtime connection disconnected. */
  disconnect(): void {
    this.#repairs.disconnect();
  }

  /** Reconnect and authoritatively repair every active Fate detail and list query. */
  async reconnect(): Promise<void> {
    await this.#repairs.reconnect();
    await this.#transport.settle();
  }

  /** Dispose the spike's live subscriptions. */
  dispose(): void {
    for (const dispose of this.#disposers.splice(0)) {
      dispose();
    }
  }
}
