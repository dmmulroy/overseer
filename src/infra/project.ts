import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { layer as migrationLayer } from "../adapters/project-sqlite/project-migrations.ts";
import { layer as sqliteStateLayer } from "../adapters/project-sqlite/project-sqlite-state.ts";
import { layer as ulidGeneratorLayer } from "../application/ulid-generator.ts";
import {
  IssueDiscoveryService,
  type IssueNotFound,
  layer as issueDiscoveryLayer,
  type ProjectIdempotencyKeyReused,
  ProjectPersistenceUnavailable,
  ProjectStoredRecordCorrupt,
  type ProjectPersistenceError,
} from "../application/issues/issue-discovery.ts";
import {
  type CreateIssueRpcInput,
  ProjectRecordCorrupt,
  ProjectStateUnavailable,
} from "../application/project/project-rpc.ts";
import type { IssueId } from "../domain/entity-id.ts";
import type { IssueNumber } from "../domain/issue.ts";
import { ProjectObject } from "./project-resource.ts";

function exposeProjectPersistenceFailure<A>(
  operation: string,
  effect: Effect.Effect<A, ProjectIdempotencyKeyReused | ProjectPersistenceError>,
): Effect.Effect<A, ProjectIdempotencyKeyReused | ProjectRecordCorrupt | ProjectStateUnavailable>;
function exposeProjectPersistenceFailure<A>(
  operation: string,
  effect: Effect.Effect<A, IssueNotFound | ProjectPersistenceError>,
): Effect.Effect<A, IssueNotFound | ProjectRecordCorrupt | ProjectStateUnavailable>;
function exposeProjectPersistenceFailure<A>(
  operation: string,
  effect: Effect.Effect<A, IssueNotFound | ProjectIdempotencyKeyReused | ProjectPersistenceError>,
): Effect.Effect<
  A,
  IssueNotFound | ProjectIdempotencyKeyReused | ProjectRecordCorrupt | ProjectStateUnavailable
> {
  return effect.pipe(
    Effect.catchTag("ProjectStoredRecordCorrupt", (error: ProjectStoredRecordCorrupt) =>
      Effect.logError(error.message).pipe(
        Effect.annotateLogs({ error_type: error._tag, operation, record_type: error.recordType }),
        Effect.andThen(Effect.fail(new ProjectRecordCorrupt())),
      ),
    ),
    Effect.catchTag("ProjectPersistenceUnavailable", (error: ProjectPersistenceUnavailable) =>
      Effect.logError(error.message).pipe(
        Effect.annotateLogs({
          error_type: error._tag,
          operation,
          persistence_operation: error.operation,
        }),
        Effect.andThen(Effect.fail(new ProjectStateUnavailable())),
      ),
    ),
  );
}

/** Alchemy V2 implementation layer for the SQLite-backed Project object. */
const ProjectObjectLive = ProjectObject.make<never>(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      const sql = yield* Effect.scoped(
        SqliteClient.make({ storage: state.raw.storage }).pipe(Effect.provide(Reactivity.layer)),
      );
      const SqlLive = Layer.succeed(SqlClient.SqlClient, sql);
      const MigrationLive = migrationLayer.pipe(Layer.provide(SqlLive));
      const StateLive = sqliteStateLayer.pipe(Layer.provide(SqlLive));
      const DiscoveryLive = issueDiscoveryLayer.pipe(
        Layer.provide([StateLive, ulidGeneratorLayer]),
        Layer.provide(BrowserCrypto.layer),
      );
      const issues = yield* IssueDiscoveryService.pipe(
        Effect.provide([DiscoveryLive, MigrationLive]),
        Effect.catchTag("ProjectMigrationFailed", (error) =>
          Effect.logError(error.message).pipe(
            Effect.andThen(Effect.die(new Error("Project initialization failed"))),
          ),
        ),
      );
      return {
        createIssue: (input: CreateIssueRpcInput) =>
          exposeProjectPersistenceFailure("createIssue", issues.createIssue(input)),
        readIssue: (issueId: IssueId) =>
          exposeProjectPersistenceFailure("readIssue", issues.readIssue(issueId)),
        readIssueByNumber: (number: IssueNumber) =>
          exposeProjectPersistenceFailure("readIssueByNumber", issues.readIssueByNumber(number)),
        readIssueRevisions: (issueId: IssueId) =>
          exposeProjectPersistenceFailure("readIssueRevisions", issues.readIssueRevisions(issueId)),
        readIssueTimeline: (issueId: IssueId) =>
          exposeProjectPersistenceFailure("readIssueTimeline", issues.readIssueTimeline(issueId)),
        readIssueReferences: (issueId: IssueId) =>
          exposeProjectPersistenceFailure(
            "readIssueReferences",
            issues.readIssueReferences(issueId),
          ),
      };
    });
  }),
);

export default ProjectObjectLive;
