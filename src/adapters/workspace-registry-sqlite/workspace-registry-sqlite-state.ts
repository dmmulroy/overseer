import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  IdempotencyFingerprint,
  WorkspaceRegistryPersistenceUnavailable,
  WorkspaceRegistryStateService,
  WorkspaceRegistryStoredRecordCorrupt,
} from "../../application/workspace-registry/workspace-registry.ts";
import { WorkspaceRegistryCursorInvalid } from "../../application/workspace-registry/workspace-registry-rpc.ts";
import { WorkspaceId } from "../../domain/entity-id.ts";
import {
  WorkspaceCursor,
  type WorkspaceCursor as WorkspaceCursorType,
} from "../../domain/pagination.ts";
import {
  Workspace,
  type Workspace as WorkspaceType,
  WorkspaceName,
} from "../../domain/workspace.ts";

type WorkspaceRow = {
  readonly id: unknown;
  readonly name: unknown;
  readonly lifecycle: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly archived_at: unknown;
};

type IdempotencyRow = {
  readonly fingerprint: unknown;
  readonly workspace_json: unknown;
};

const WorkspaceCursorState = Schema.Struct({
  name: WorkspaceName,
  workspaceId: WorkspaceId,
});

const WorkspaceRowSchema = Schema.Struct({
  id: Workspace.fields.id,
  name: Workspace.fields.name,
  lifecycle: Workspace.fields.lifecycle,
  created_at: Workspace.fields.createdAt,
  updated_at: Workspace.fields.updatedAt,
  archived_at: Schema.Null,
}).pipe(
  Schema.decodeTo(
    Schema.toType(Workspace),
    SchemaTransformation.transform({
      decode: (row) => ({
        id: row.id,
        name: row.name,
        lifecycle: row.lifecycle,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
      encode: (workspace) => ({
        id: workspace.id,
        name: workspace.name,
        lifecycle: workspace.lifecycle,
        created_at: workspace.createdAt,
        updated_at: workspace.updatedAt,
        archived_at: null,
      }),
    }),
  ),
);

const WorkspaceJson = Schema.fromJsonString(Workspace);
const WorkspaceCursorJson = Schema.fromJsonString(WorkspaceCursorState);

type WorkspaceCursorState = typeof WorkspaceCursorState.Type;

function parseWorkspaceRow(
  row: WorkspaceRow,
): Effect.Effect<WorkspaceType, WorkspaceRegistryStoredRecordCorrupt> {
  return Schema.decodeUnknownEffect(WorkspaceRowSchema)(row).pipe(
    Effect.mapError(
      (cause) =>
        new WorkspaceRegistryStoredRecordCorrupt({
          recordType: "workspace",
          cause,
        }),
    ),
  );
}

function decodeCursor(cursor: WorkspaceCursorType): Option.Option<WorkspaceCursorState> {
  const decoded = Encoding.decodeBase64UrlString(cursor);
  return Result.isSuccess(decoded)
    ? Schema.decodeUnknownOption(WorkspaceCursorJson)(decoded.success)
    : Option.none();
}

function encodeCursor(workspace: WorkspaceType): WorkspaceCursorType {
  const state = WorkspaceCursorState.make({
    name: workspace.name,
    workspaceId: workspace.id,
  });
  return WorkspaceCursor.make(
    Encoding.encodeBase64Url(Schema.encodeSync(WorkspaceCursorJson)(state)),
  );
}

/** Construct SQLite-backed Workspace Registry persistence. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const findWorkspace = Effect.fn("WorkspaceRegistrySqliteState.findWorkspace")(
    function* (workspaceId) {
      const row = (yield* sql<WorkspaceRow>`
          SELECT id, name, lifecycle, created_at, updated_at, archived_at
          FROM workspaces
          WHERE id = ${workspaceId}
        `)[0];
      if (row === undefined) return Option.none();
      return Option.some(yield* parseWorkspaceRow(row));
    },
    Effect.catchTag("SqlError", (cause) =>
      Effect.fail(
        new WorkspaceRegistryPersistenceUnavailable({
          operation: "findWorkspace",
          cause,
        }),
      ),
    ),
  );

  return WorkspaceRegistryStateService.of({
    transaction: Effect.fn("WorkspaceRegistrySqliteState.transaction")(
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        sql.withTransaction(effect).pipe(
          Effect.catchTag("SqlError", (cause) =>
            Effect.fail(
              new WorkspaceRegistryPersistenceUnavailable({
                operation: "transaction",
                cause,
              }),
            ),
          ),
        ),
    ),
    listWorkspaces: Effect.fn("WorkspaceRegistrySqliteState.listWorkspaces")(
      function* (request) {
        const requestedCursor = Option.fromNullishOr(request.cursor);
        const cursor = Option.flatMap(requestedCursor, decodeCursor);
        if (Option.isSome(requestedCursor) && Option.isNone(cursor)) {
          return yield* new WorkspaceRegistryCursorInvalid();
        }
        const pageSize = request.limit + 1;
        const found = Option.isSome(cursor)
          ? yield* sql<WorkspaceRow>`
                SELECT id, name, lifecycle, created_at, updated_at, archived_at
                FROM workspaces
                WHERE lifecycle = 'active'
                  AND (name > ${cursor.value.name}
                    OR (name = ${cursor.value.name} AND id > ${cursor.value.workspaceId}))
                ORDER BY name ASC, id ASC
                LIMIT ${pageSize}
              `
          : yield* sql<WorkspaceRow>`
                SELECT id, name, lifecycle, created_at, updated_at, archived_at
                FROM workspaces
                WHERE lifecycle = 'active'
                ORDER BY name ASC, id ASC
                LIMIT ${pageSize}
              `;
        const parsed: Array<WorkspaceType> = [];
        for (const row of found) {
          parsed.push(yield* parseWorkspaceRow(row));
        }
        const workspaces = parsed.slice(0, request.limit);
        const last = workspaces[workspaces.length - 1];
        const nextCursor =
          parsed.length > request.limit && last !== undefined
            ? Option.some(encodeCursor(last))
            : Option.none<WorkspaceCursorType>();
        return {
          workspaces,
          cursor: requestedCursor,
          nextCursor,
          limit: request.limit,
        };
      },
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(
          new WorkspaceRegistryPersistenceUnavailable({
            operation: "listWorkspaces",
            cause,
          }),
        ),
      ),
    ),
    findIdempotency: Effect.fn("WorkspaceRegistrySqliteState.findIdempotency")(
      function* (scope, key) {
        const retained = (yield* sql<IdempotencyRow>`
            SELECT fingerprint, workspace_json
            FROM workspace_registry_idempotency
            WHERE scope = ${scope}
              AND idempotency_key = ${key}
          `)[0];
        if (retained === undefined) return Option.none();
        const stored = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            fingerprint: IdempotencyFingerprint,
            workspace: WorkspaceJson,
          }),
        )({
          fingerprint: retained.fingerprint,
          workspace: retained.workspace_json,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceRegistryStoredRecordCorrupt({
                recordType: "idempotency",
                cause,
              }),
          ),
        );
        return Option.some(stored);
      },
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(
          new WorkspaceRegistryPersistenceUnavailable({
            operation: "findIdempotency",
            cause,
          }),
        ),
      ),
    ),
    insertCreation: Effect.fn("WorkspaceRegistrySqliteState.insertCreation")(
      function* (workspace, scope, key, fingerprint) {
        yield* sql`
            INSERT INTO workspaces
              (id, name, lifecycle, created_at, updated_at, archived_at)
            VALUES
              (${workspace.id}, ${workspace.name}, 'active', ${workspace.createdAt}, ${workspace.updatedAt}, NULL)
          `;
        yield* sql`
            INSERT INTO workspace_registry_idempotency
              (scope, idempotency_key, fingerprint, workspace_json, created_at)
            VALUES
              (${scope}, ${key}, ${fingerprint}, ${Schema.encodeSync(WorkspaceJson)(workspace)}, ${workspace.createdAt})
          `;
      },
      Effect.mapError(
        (cause) =>
          new WorkspaceRegistryPersistenceUnavailable({
            operation: "insertCreation",
            cause,
          }),
      ),
    ),
    findWorkspace,
    updateWorkspaceName: Effect.fn("WorkspaceRegistrySqliteState.updateWorkspaceName")(
      (workspace) =>
        sql`
            UPDATE workspaces
            SET name = ${workspace.name}, updated_at = ${workspace.updatedAt}
            WHERE id = ${workspace.id}
          `.pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) =>
              new WorkspaceRegistryPersistenceUnavailable({
                operation: "updateWorkspaceName",
                cause,
              }),
          ),
        ),
    ),
  });
});

/** SQLite-backed Workspace Registry persistence layer. */
export const layer = Layer.effect(WorkspaceRegistryStateService, make);
