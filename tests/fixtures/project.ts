/// <reference types="@cloudflare/workers-types" />

import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { DurableObject } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { layer as migrationLayer } from "../../src/adapters/project-sqlite/project-migrations.ts";
import { layer as sqliteStateLayer } from "../../src/adapters/project-sqlite/project-sqlite-state.ts";
import { layer as ulidGeneratorLayer } from "../../src/application/ulid-generator.ts";
import {
  IssueDiscoveryService,
  type IssueNotFound,
  layer as issueDiscoveryLayer,
  type ProjectIdempotencyKeyReused,
  ProjectPersistenceUnavailable,
  ProjectStoredRecordCorrupt,
  type ProjectPersistenceError,
} from "../../src/application/issues/issue-discovery.ts";
import {
  CreateIssueRpcInput,
  CreateIssueRpcResult,
  IssueReferencesRpcResult,
  IssueRevisionsRpcResult,
  IssueTimelineRpcResult,
  ProjectRecordCorrupt,
  ProjectStateUnavailable,
} from "../../src/application/project/project-rpc.ts";
import type { IssueId } from "../../src/domain/entity-id.ts";
import { Issue, type IssueNumber } from "../../src/domain/issue.ts";

function exposePersistence<A>(
  effect: Effect.Effect<A, ProjectIdempotencyKeyReused | ProjectPersistenceError>,
): Effect.Effect<A, ProjectIdempotencyKeyReused | ProjectRecordCorrupt | ProjectStateUnavailable>;
function exposePersistence<A>(
  effect: Effect.Effect<A, IssueNotFound | ProjectPersistenceError>,
): Effect.Effect<A, IssueNotFound | ProjectRecordCorrupt | ProjectStateUnavailable>;
function exposePersistence<A>(
  effect: Effect.Effect<A, IssueNotFound | ProjectIdempotencyKeyReused | ProjectPersistenceError>,
) {
  return effect.pipe(
    Effect.catchTag("ProjectStoredRecordCorrupt", (_error: ProjectStoredRecordCorrupt) =>
      Effect.fail(new ProjectRecordCorrupt()),
    ),
    Effect.catchTag("ProjectPersistenceUnavailable", (_error: ProjectPersistenceUnavailable) =>
      Effect.fail(new ProjectStateUnavailable()),
    ),
  );
}

/** Representative SQLite Project Durable Object used by fast Gateway tests. */
export class TestProject extends DurableObject<Readonly<Record<never, never>>> {
  readonly #ready: Promise<IssueDiscoveryService["Service"]>;
  readonly #run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

  constructor(ctx: DurableObjectState, env: Readonly<Record<never, never>>) {
    super(ctx, env);
    const SqlLive = SqliteClient.layer({ storage: ctx.storage });
    const StateLive = sqliteStateLayer.pipe(Layer.provide(SqlLive));
    const MigrationLive = migrationLayer.pipe(Layer.provide(SqlLive));
    const DiscoveryLive = issueDiscoveryLayer.pipe(
      Layer.provide([StateLive, ulidGeneratorLayer]),
      Layer.provide(BrowserCrypto.layer),
    );
    const runtime = ManagedRuntime.make(Layer.merge(DiscoveryLive, MigrationLive));
    this.#run = (effect) =>
      runtime.runPromise(Effect.result(effect)).then((result) => {
        if (Result.isFailure(result)) throw result.failure;
        return result.success;
      });
    this.#ready = ctx.blockConcurrencyWhile(() => runtime.runPromise(IssueDiscoveryService));
  }

  /** Create one Issue through the operation-specific seam. */
  async createIssue(
    input: typeof CreateIssueRpcInput.Encoded,
  ): Promise<typeof CreateIssueRpcResult.Encoded> {
    const issues = await this.#ready;
    const decoded = Schema.decodeUnknownSync(CreateIssueRpcInput)(input);
    const result = await this.#run(exposePersistence(issues.createIssue(decoded)));
    return Schema.encodeSync(CreateIssueRpcResult)(result);
  }
  /** Read one Issue by canonical identity. */
  async readIssue(issueId: IssueId): Promise<typeof Issue.Encoded> {
    const issues = await this.#ready;
    const issue = await this.#run(exposePersistence(issues.readIssue(issueId)));
    return Schema.encodeSync(Issue)(issue);
  }
  /** Read one Issue by its immutable Project-local number. */
  async readIssueByNumber(number: IssueNumber): Promise<typeof Issue.Encoded> {
    const issues = await this.#ready;
    const issue = await this.#run(exposePersistence(issues.readIssueByNumber(number)));
    return Schema.encodeSync(Issue)(issue);
  }
  /** Read one Issue's immutable text Revisions. */
  async readIssueRevisions(issueId: IssueId): Promise<typeof IssueRevisionsRpcResult.Encoded> {
    const issues = await this.#ready;
    const revisions = await this.#run(exposePersistence(issues.readIssueRevisions(issueId)));
    return Schema.encodeSync(IssueRevisionsRpcResult)(revisions);
  }
  /** Read one Issue's structured Timeline. */
  async readIssueTimeline(issueId: IssueId): Promise<typeof IssueTimelineRpcResult.Encoded> {
    const issues = await this.#ready;
    const timeline = await this.#run(exposePersistence(issues.readIssueTimeline(issueId)));
    return Schema.encodeSync(IssueTimelineRpcResult)(timeline);
  }
  /** Read one Issue's current reciprocal references. */
  async readIssueReferences(issueId: IssueId): Promise<typeof IssueReferencesRpcResult.Encoded> {
    const issues = await this.#ready;
    const references = await this.#run(exposePersistence(issues.readIssueReferences(issueId)));
    return Schema.encodeSync(IssueReferencesRpcResult)(references);
  }
}
