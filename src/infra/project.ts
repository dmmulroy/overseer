import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { layer as migrationLayer } from "../adapters/project-sqlite/project-migrations.ts";
import { layer as sqliteStateLayer } from "../adapters/project-sqlite/project-sqlite-state.ts";
import { layer as ulidGeneratorLayer } from "../application/ulid-generator.ts";
import {
  type IssueCursorInvalid,
  IssueDiscoveryService,
  type IssueNotFound,
  layer as issueDiscoveryLayer,
  type ProjectIdempotencyKeyReused,
  ProjectPersistenceUnavailable,
  ProjectStoredRecordCorrupt,
  type ProjectPersistenceError,
} from "../application/issues/issue-discovery.ts";
import {
  CreateIssueRpcInput,
  CreateIssueRpcResult,
  IssueReferencesRpcResult,
  IssueRevisionsRpcResult,
  ListIssuesRpcInput,
  ListIssuesRpcResult,
  IssueTimelineRpcResult,
  ProjectRecordCorrupt,
  ProjectRpcCallFailed,
  ProjectStateUnavailable,
} from "../application/project/project-rpc.ts";
import type { IssueId } from "../domain/entity-id.ts";
import { Issue, type IssueNumber } from "../domain/issue.ts";
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
  effect: Effect.Effect<A, IssueCursorInvalid | ProjectPersistenceError>,
): Effect.Effect<A, IssueCursorInvalid | ProjectRecordCorrupt | ProjectStateUnavailable>;
function exposeProjectPersistenceFailure<A>(
  operation: string,
  effect: Effect.Effect<
    A,
    IssueCursorInvalid | IssueNotFound | ProjectIdempotencyKeyReused | ProjectPersistenceError
  >,
): Effect.Effect<
  A,
  | IssueCursorInvalid
  | IssueNotFound
  | ProjectIdempotencyKeyReused
  | ProjectRecordCorrupt
  | ProjectStateUnavailable
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
        createIssue: (input) =>
          Schema.decodeUnknownEffect(CreateIssueRpcInput)(input).pipe(
            Effect.orDie,
            Effect.flatMap((decoded) =>
              exposeProjectPersistenceFailure("createIssue", issues.createIssue(decoded)),
            ),
            Effect.flatMap((result) =>
              Schema.encodeEffect(CreateIssueRpcResult)(result).pipe(Effect.orDie),
            ),
          ),
        listIssues: (input) =>
          Schema.decodeUnknownEffect(ListIssuesRpcInput)(input).pipe(
            Effect.mapError(
              (cause) => new ProjectRpcCallFailed({ operation: "listIssues", cause }),
            ),
            Effect.flatMap((decoded) =>
              exposeProjectPersistenceFailure("listIssues", issues.listIssues(decoded)),
            ),
            Effect.flatMap((page) =>
              Schema.encodeEffect(ListIssuesRpcResult)(page).pipe(
                Effect.mapError(
                  (cause) => new ProjectRpcCallFailed({ operation: "listIssues", cause }),
                ),
              ),
            ),
          ),
        readIssue: (issueId: IssueId) =>
          exposeProjectPersistenceFailure("readIssue", issues.readIssue(issueId)).pipe(
            Effect.flatMap((issue) => Schema.encodeEffect(Issue)(issue).pipe(Effect.orDie)),
          ),
        readIssueByNumber: (number: IssueNumber) =>
          exposeProjectPersistenceFailure(
            "readIssueByNumber",
            issues.readIssueByNumber(number),
          ).pipe(Effect.flatMap((issue) => Schema.encodeEffect(Issue)(issue).pipe(Effect.orDie))),
        readIssueRevisions: (issueId: IssueId) =>
          exposeProjectPersistenceFailure(
            "readIssueRevisions",
            issues.readIssueRevisions(issueId),
          ).pipe(
            Effect.flatMap((revisions) =>
              Schema.encodeEffect(IssueRevisionsRpcResult)(revisions).pipe(Effect.orDie),
            ),
          ),
        readIssueTimeline: (issueId: IssueId) =>
          exposeProjectPersistenceFailure(
            "readIssueTimeline",
            issues.readIssueTimeline(issueId),
          ).pipe(
            Effect.flatMap((timeline) =>
              Schema.encodeEffect(IssueTimelineRpcResult)(timeline).pipe(Effect.orDie),
            ),
          ),
        readIssueReferences: (issueId: IssueId) =>
          exposeProjectPersistenceFailure(
            "readIssueReferences",
            issues.readIssueReferences(issueId),
          ).pipe(
            Effect.flatMap((references) =>
              Schema.encodeEffect(IssueReferencesRpcResult)(references).pipe(Effect.orDie),
            ),
          ),
      };
    });
  }),
);

export default ProjectObjectLive;
