import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  IdempotencyFingerprint,
  type IdempotencyFingerprint as IdempotencyFingerprintType,
} from "../../application/catalog/catalog-rpc.ts";
import {
  CatalogCursorInvalid,
  type CatalogReader,
  CatalogRecordCorrupt,
  type CatalogState,
  type CatalogStateError,
  CatalogStateUnavailable,
  type ListWorkspacesRequest,
  type RetainedWorkspaceCreation,
  type WorkspacePage,
} from "../../application/catalog/catalog.ts";
import { WorkspaceId } from "../../domain/entity-id.ts";
import type {
  IdempotencyKey,
  IdempotencyPrincipal,
} from "../../domain/idempotency.ts";
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

function parseWorkspaceRow(row: WorkspaceRow): Option.Option<WorkspaceType> {
  return Schema.decodeUnknownOption(Workspace)({
    id: row.id,
    name: row.name,
    lifecycle: row.lifecycle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const WorkspaceCursorState = Schema.Struct({
  name: WorkspaceName,
  workspaceId: WorkspaceId,
});

type WorkspaceCursorState = typeof WorkspaceCursorState.Type;

function decodeCursor(cursor: WorkspaceCursorType): Option.Option<WorkspaceCursorState> {
  const decoded = Encoding.decodeBase64UrlString(cursor);
  return Result.isSuccess(decoded)
    ? Schema.decodeUnknownOption(Schema.fromJsonString(WorkspaceCursorState))(decoded.success)
    : Option.none();
}

function encodeCursor(workspace: WorkspaceType): WorkspaceCursorType {
  return WorkspaceCursor.make(Encoding.encodeBase64Url(JSON.stringify({
    name: workspace.name,
    workspaceId: workspace.id,
  })));
}

function parseStoredWorkspace(input: unknown): Option.Option<WorkspaceType> {
  if (typeof input !== "string") {
    return Option.none();
  }
  try {
    return Schema.decodeUnknownOption(Workspace)(JSON.parse(input));
  } catch {
    return Option.none();
  }
}

/** SQLite-backed implementation of Catalog persistence primitives. */
export class CatalogSqliteState implements
  CatalogState<SqlClient.SqlClient>, CatalogReader<SqlClient.SqlClient> {
  /** Read one bounded active Workspace page using opaque keyset mechanics. */
  listWorkspaces(
    request: ListWorkspacesRequest,
  ): Effect.Effect<
    WorkspacePage,
    CatalogCursorInvalid | CatalogStateError,
    SqlClient.SqlClient
  > {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const requestedCursor = Option.fromNullishOr(request.cursor);
      const cursor = Option.flatMap(requestedCursor, decodeCursor);
      if (Option.isSome(requestedCursor) && Option.isNone(cursor)) {
        return yield* Effect.fail(new CatalogCursorInvalid());
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
      const workspaces: Array<WorkspaceType> = [];
      for (const row of found.slice(0, request.limit)) {
        const workspace = parseWorkspaceRow(row);
        if (Option.isNone(workspace)) {
          return yield* Effect.fail(new CatalogRecordCorrupt({ cause: row }));
        }
        workspaces.push(workspace.value);
      }
      const last = workspaces[workspaces.length - 1];
      const nextCursor = found.length > request.limit && last !== undefined
        ? Option.some(encodeCursor(last))
        : Option.none<WorkspaceCursorType>();
      return {
        workspaces,
        cursor: requestedCursor,
        nextCursor,
        limit: request.limit,
      };
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new CatalogStateUnavailable({ cause }))),
    );
  }

  /** Read one parsed Workspace by immutable ID. */
  readWorkspace(
    workspaceId: WorkspaceType["id"],
  ): Effect.Effect<Option.Option<WorkspaceType>, CatalogStateError, SqlClient.SqlClient> {
    return this.findWorkspace(workspaceId);
  }

  /** Run Catalog policy atomically against this SQLite client. */
  transaction<A, E>(
    effect: Effect.Effect<A, E, SqlClient.SqlClient>,
  ): Effect.Effect<A, E | CatalogStateError, SqlClient.SqlClient> {
    return SqlClient.SqlClient.use((sql) => sql.withTransaction(effect)).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new CatalogStateUnavailable({ cause }))),
    );
  }

  /** Find a retained creation result for one principal-scoped key. */
  findIdempotency(
    principal: IdempotencyPrincipal,
    key: IdempotencyKey,
  ): Effect.Effect<
    Option.Option<RetainedWorkspaceCreation>,
    CatalogStateError,
    SqlClient.SqlClient
  > {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const retained = (yield* sql<IdempotencyRow>`
        SELECT fingerprint, workspace_json
        FROM catalog_idempotency
        WHERE principal_key = ${principal}
          AND idempotency_key = ${key}
      `)[0];
      if (retained === undefined) return Option.none();
      const fingerprint = Schema.decodeUnknownOption(IdempotencyFingerprint)(retained.fingerprint);
      const workspace = parseStoredWorkspace(retained.workspace_json);
      if (Option.isNone(fingerprint) || Option.isNone(workspace)) {
        return yield* Effect.fail(new CatalogRecordCorrupt({ cause: retained }));
      }
      return Option.some({
        fingerprint: fingerprint.value,
        workspace: workspace.value,
      });
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new CatalogStateUnavailable({ cause }))),
    );
  }

  /** Persist a new Workspace and its replay record in the current transaction. */
  insertCreation(
    workspace: WorkspaceType,
    principal: IdempotencyPrincipal,
    key: IdempotencyKey,
    fingerprint: IdempotencyFingerprintType,
  ): Effect.Effect<void, CatalogStateError, SqlClient.SqlClient> {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO workspaces
          (id, name, lifecycle, created_at, updated_at, archived_at)
        VALUES
          (${workspace.id}, ${workspace.name}, 'active', ${workspace.createdAt}, ${workspace.updatedAt}, NULL)
      `;
      yield* sql`
        INSERT INTO catalog_idempotency
          (principal_key, idempotency_key, fingerprint, workspace_json, created_at)
        VALUES
          (${principal}, ${key}, ${fingerprint}, ${JSON.stringify(workspace)}, ${workspace.createdAt})
      `;
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new CatalogStateUnavailable({ cause }))),
    );
  }

  /** Find one parsed Workspace record by immutable ID. */
  findWorkspace(
    workspaceId: WorkspaceType["id"],
  ): Effect.Effect<Option.Option<WorkspaceType>, CatalogStateError, SqlClient.SqlClient> {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const row = (yield* sql<WorkspaceRow>`
        SELECT id, name, lifecycle, created_at, updated_at, archived_at
        FROM workspaces
        WHERE id = ${workspaceId}
      `)[0];
      if (row === undefined) return Option.none();
      const workspace = parseWorkspaceRow(row);
      return Option.isSome(workspace)
        ? workspace
        : yield* Effect.fail(new CatalogRecordCorrupt({ cause: row }));
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new CatalogStateUnavailable({ cause }))),
    );
  }

  /** Persist one application-approved Workspace rename. */
  updateWorkspaceName(
    workspace: WorkspaceType,
  ): Effect.Effect<void, CatalogStateError, SqlClient.SqlClient> {
    return SqlClient.SqlClient.use((sql) => sql`
      UPDATE workspaces
      SET name = ${workspace.name}, updated_at = ${workspace.updatedAt}
      WHERE id = ${workspace.id}
    `).pipe(
      Effect.asVoid,
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new CatalogStateUnavailable({ cause }))),
    );
  }
}
