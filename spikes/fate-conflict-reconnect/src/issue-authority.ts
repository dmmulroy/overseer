/** PROTOTYPE: the one authoritative issue store shared by REST and the Fate adapter. */

/** The issue fields exercised by the spike. */
export type IssueSnapshot = Readonly<{
  id: string;
  number: number;
  state: "closed" | "open";
  title: string;
  version: number;
}>;

/** A version-guarded issue edit. */
export type UpdateIssueCommand = Readonly<{
  expectedVersion: number;
  id: string;
  state?: "closed" | "open";
  title?: string;
}>;

/** The authoritative result of an issue edit. */
export type UpdateIssueResult =
  | Readonly<{ _tag: "updated"; issue: IssueSnapshot }>
  | Readonly<{
      _tag: "versionConflict";
      attempted: UpdateIssueCommand;
      current: IssueSnapshot;
    }>;

/** In-memory stand-in for the Project Durable Object's application-owned issue module. */
export class IssueAuthority {
  readonly #issues = new Map<string, IssueSnapshot>();

  /** Seed the authority with one or more issues. */
  constructor(issues: ReadonlyArray<IssueSnapshot>) {
    for (const issue of issues) {
      this.#issues.set(issue.id, issue);
    }
  }

  /** Return one authoritative issue snapshot. */
  get(id: string): IssueSnapshot | undefined {
    return this.#issues.get(id);
  }

  /** Return authoritative issues, optionally filtered by lifecycle state. */
  list(state?: "closed" | "open"): ReadonlyArray<IssueSnapshot> {
    return [...this.#issues.values()]
      .filter((issue) => state === undefined || issue.state === state)
      .sort((left, right) => left.number - right.number);
  }

  /** Apply a version-guarded edit atomically. */
  update(command: UpdateIssueCommand): UpdateIssueResult | undefined {
    const current = this.#issues.get(command.id);
    if (!current) {
      return undefined;
    }

    if (current.version !== command.expectedVersion) {
      return { _tag: "versionConflict", attempted: command, current };
    }

    const issue: IssueSnapshot = {
      ...current,
      state: command.state ?? current.state,
      title: command.title ?? current.title,
      version: current.version + 1,
    };
    this.#issues.set(issue.id, issue);
    return { _tag: "updated", issue };
  }
}
