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
import {
  issueSteeringLayer as sqliteSteeringStateLayer,
  layer as sqliteStateLayer,
} from "../../src/adapters/project-sqlite/project-sqlite-state.ts";
import { layer as ulidGeneratorLayer } from "../../src/application/ulid-generator.ts";
import {
  IssueSteeringService,
  layer as issueSteeringLayer,
} from "../../src/application/issues/issue-steering.ts";
import {
  type IssueCursorInvalid,
  IssueDiscoveryService,
  type IssueNotFound,
  type TimelineCursorInvalid,
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
  IssueTimelinePageRpcResult,
  ListIssuesRpcInput,
  ListIssuesRpcResult,
  ReadIssueTimelineRpcInput,
  SteerIssueStateRpcInput,
  SteerIssueStateRpcResult,
  ProjectRecordCorrupt,
  ProjectStateUnavailable,
} from "../../src/application/project/project-rpc.ts";
import type { IssueId, TimelineEventId } from "../../src/domain/entity-id.ts";
import { Issue, IssueTimelineEvent, type IssueNumber } from "../../src/domain/issue.ts";

function exposePersistence<A>(
  effect: Effect.Effect<A, ProjectIdempotencyKeyReused | ProjectPersistenceError>,
): Effect.Effect<A, ProjectIdempotencyKeyReused | ProjectRecordCorrupt | ProjectStateUnavailable>;
function exposePersistence<A>(
  effect: Effect.Effect<A, IssueNotFound | ProjectPersistenceError>,
): Effect.Effect<A, IssueNotFound | ProjectRecordCorrupt | ProjectStateUnavailable>;
function exposePersistence<A>(
  effect: Effect.Effect<A, IssueNotFound | ProjectIdempotencyKeyReused | ProjectPersistenceError>,
): Effect.Effect<
  A,
  IssueNotFound | ProjectIdempotencyKeyReused | ProjectRecordCorrupt | ProjectStateUnavailable
>;
function exposePersistence<A>(
  effect: Effect.Effect<A, IssueCursorInvalid | ProjectPersistenceError>,
): Effect.Effect<A, IssueCursorInvalid | ProjectRecordCorrupt | ProjectStateUnavailable>;
function exposePersistence<A>(
  effect: Effect.Effect<A, TimelineCursorInvalid | IssueNotFound | ProjectPersistenceError>,
): Effect.Effect<
  A,
  TimelineCursorInvalid | IssueNotFound | ProjectRecordCorrupt | ProjectStateUnavailable
>;
function exposePersistence<A>(
  effect: Effect.Effect<
    A,
    | IssueCursorInvalid
    | TimelineCursorInvalid
    | IssueNotFound
    | ProjectIdempotencyKeyReused
    | ProjectPersistenceError
  >,
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
  readonly #ready: Promise<{
    readonly issues: IssueDiscoveryService["Service"];
    readonly steering: IssueSteeringService["Service"];
  }>;
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
    const SteeringStateLive = sqliteSteeringStateLayer.pipe(Layer.provide(SqlLive));
    const SteeringLive = issueSteeringLayer.pipe(
      Layer.provide([SteeringStateLive, ulidGeneratorLayer]),
      Layer.provide(BrowserCrypto.layer),
    );
    const runtime = ManagedRuntime.make(Layer.mergeAll(DiscoveryLive, SteeringLive, MigrationLive));
    this.#run = (effect) =>
      runtime.runPromise(Effect.result(effect)).then((result) => {
        if (Result.isFailure(result)) throw result.failure;
        return result.success;
      });
    this.#ready = ctx.blockConcurrencyWhile(() =>
      runtime.runPromise(
        Effect.all({ issues: IssueDiscoveryService, steering: IssueSteeringService }),
      ),
    );
  }

  /** Create one Issue through the operation-specific seam. */
  async createIssue(
    input: typeof CreateIssueRpcInput.Encoded,
  ): Promise<typeof CreateIssueRpcResult.Encoded> {
    const { issues } = await this.#ready;
    const decoded = Schema.decodeUnknownSync(CreateIssueRpcInput)(input);
    return Schema.encodeSync(CreateIssueRpcResult)(
      await this.#run(exposePersistence(issues.createIssue(decoded))),
    );
  }
  /** Close one Issue through its named target-state action. */
  async closeIssue(
    input: typeof SteerIssueStateRpcInput.Encoded,
  ): Promise<typeof SteerIssueStateRpcResult.Encoded> {
    const { steering } = await this.#ready;
    const decoded = Schema.decodeUnknownSync(SteerIssueStateRpcInput)(input);
    return Schema.encodeSync(SteerIssueStateRpcResult)(
      await this.#run(exposePersistence(steering.closeIssue(decoded))),
    );
  }
  /** Reopen one Issue through its named target-state action. */
  async reopenIssue(
    input: typeof SteerIssueStateRpcInput.Encoded,
  ): Promise<typeof SteerIssueStateRpcResult.Encoded> {
    const { steering } = await this.#ready;
    const decoded = Schema.decodeUnknownSync(SteerIssueStateRpcInput)(input);
    return Schema.encodeSync(SteerIssueStateRpcResult)(
      await this.#run(exposePersistence(steering.reopenIssue(decoded))),
    );
  }
  /** List one exact filtered and ordered Project Issue page. */
  async listIssues(
    input: typeof ListIssuesRpcInput.Encoded,
  ): Promise<typeof ListIssuesRpcResult.Encoded> {
    const { issues } = await this.#ready;
    const decoded = Schema.decodeUnknownSync(ListIssuesRpcInput)(input);
    return Schema.encodeSync(ListIssuesRpcResult)(
      await this.#run(exposePersistence(issues.listIssues(decoded))),
    );
  }
  /** Read one Issue by canonical identity. */
  async readIssue(issueId: IssueId): Promise<typeof Issue.Encoded> {
    const { issues } = await this.#ready;
    return Schema.encodeSync(Issue)(await this.#run(exposePersistence(issues.readIssue(issueId))));
  }
  /** Read one Issue by its immutable Project-local number. */
  async readIssueByNumber(number: IssueNumber): Promise<typeof Issue.Encoded> {
    const { issues } = await this.#ready;
    return Schema.encodeSync(Issue)(
      await this.#run(exposePersistence(issues.readIssueByNumber(number))),
    );
  }
  /** Read one Issue's immutable text Revisions. */
  async readIssueRevisions(issueId: IssueId): Promise<typeof IssueRevisionsRpcResult.Encoded> {
    const { issues } = await this.#ready;
    return Schema.encodeSync(IssueRevisionsRpcResult)(
      await this.#run(exposePersistence(issues.readIssueRevisions(issueId))),
    );
  }
  /** Read one keyset page from an Issue's structured Timeline. */
  async readIssueTimeline(
    input: typeof ReadIssueTimelineRpcInput.Encoded,
  ): Promise<typeof IssueTimelinePageRpcResult.Encoded> {
    const { issues } = await this.#ready;
    const decoded = Schema.decodeUnknownSync(ReadIssueTimelineRpcInput)(input);
    return Schema.encodeSync(IssueTimelinePageRpcResult)(
      await this.#run(exposePersistence(issues.readIssueTimeline(decoded))),
    );
  }
  /** Read one immutable Event through its owning Issue. */
  async readTimelineEvent(
    issueId: IssueId,
    eventId: TimelineEventId,
  ): Promise<typeof IssueTimelineEvent.Encoded> {
    const { issues } = await this.#ready;
    return Schema.encodeSync(IssueTimelineEvent)(
      await this.#run(exposePersistence(issues.readTimelineEvent(issueId, eventId))),
    );
  }
  /** Read one Issue's current reciprocal references. */
  async readIssueReferences(issueId: IssueId): Promise<typeof IssueReferencesRpcResult.Encoded> {
    const { issues } = await this.#ready;
    return Schema.encodeSync(IssueReferencesRpcResult)(
      await this.#run(exposePersistence(issues.readIssueReferences(issueId))),
    );
  }
}
