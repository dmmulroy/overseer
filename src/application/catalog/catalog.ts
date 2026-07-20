import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  CatalogCommand,
  CatalogOutcome,
  type CatalogOutcome as CatalogOutcomeType,
  CatalogRead,
  type CatalogRead as CatalogReadRequest,
  type CatalogRpc,
  IdempotencyFingerprint,
  type IdempotencyFingerprint as IdempotencyFingerprintType,
} from "./catalog-rpc.ts";
import type { WorkspaceId } from "../../domain/entity-id.ts";
import type {
  IdempotencyKey,
  IdempotencyPrincipal,
} from "../../domain/idempotency.ts";
import type { WorkspaceCursor } from "../../domain/pagination.ts";
import {
  Workspace,
  type Workspace as WorkspaceType,
  type WorkspaceName,
  WorkspaceTimestamp,
} from "../../domain/workspace.ts";

/** Inputs for an idempotent Workspace creation operation. */
export type CreateWorkspaceInput = {
  readonly name: WorkspaceName;
  readonly principalKey: IdempotencyPrincipal;
  readonly idempotencyKey: IdempotencyKey;
};

/** Inputs selecting one bounded Workspace collection page. */
export type ListWorkspacesInput = {
  readonly cursor: Option.Option<WorkspaceCursor>;
  readonly limit: number;
};

/** Time capability owned by the singleton Catalog composition root. */
export type CatalogClock = {
  readonly now: () => Date;
};

/** Entity-ID capability owned by the singleton Catalog composition root. */
export type WorkspaceIds = {
  readonly next: (now: Date) => WorkspaceId;
};

/** Retained successful creation used for idempotent replay. */
export type RetainedWorkspaceCreation = {
  readonly fingerprint: IdempotencyFingerprintType;
  readonly workspace: WorkspaceType;
};

/** A persisted Catalog record could not be decoded. */
export class CatalogRecordCorrupt extends Schema.TaggedErrorClass<CatalogRecordCorrupt>()(
  "CatalogRecordCorrupt",
  { cause: Schema.Defect() },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "A persisted Catalog record is corrupt";
}

/** Catalog persistence could not complete an operation. */
export class CatalogStateUnavailable extends Schema.TaggedErrorClass<CatalogStateUnavailable>()(
  "CatalogStateUnavailable",
  { cause: Schema.Defect() },
) {
  /** Stable safe diagnostic message. */
  override readonly message = "Catalog persistence is unavailable";
}

/** Persistence failures handled by Catalog application policy. */
export type CatalogStateError = CatalogRecordCorrupt | CatalogStateUnavailable;

/** Transactional persistence primitives required by Catalog command policy. */
export type CatalogState<R> = {
  readonly transaction: <A, E>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | CatalogStateError, R>;
  readonly findIdempotency: (
    principal: IdempotencyPrincipal,
    key: IdempotencyKey,
  ) => Effect.Effect<Option.Option<RetainedWorkspaceCreation>, CatalogStateError, R>;
  readonly insertCreation: (
    workspace: WorkspaceType,
    principal: IdempotencyPrincipal,
    key: IdempotencyKey,
    fingerprint: IdempotencyFingerprintType,
  ) => Effect.Effect<void, CatalogStateError, R>;
  readonly findWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Option.Option<WorkspaceType>, CatalogStateError, R>;
  readonly updateWorkspaceName: (
    workspace: WorkspaceType,
  ) => Effect.Effect<void, CatalogStateError, R>;
};

type Outcome<Tag extends CatalogOutcomeType["_tag"]> = Extract<
  CatalogOutcomeType,
  { readonly _tag: Tag }
>;
type CatalogFailure = Outcome<
  "CatalogProtocolInvalid" | "CatalogRecordCorrupt" | "CatalogStateUnavailable"
>;
/** Outcomes possible when listing one Workspace page. */
export type ListWorkspacesOutcome =
  | Outcome<"WorkspaceCollection" | "CursorInvalid">
  | CatalogFailure;
/** Outcomes possible when reading one Workspace. */
export type ReadWorkspaceOutcome = Outcome<"WorkspaceFound" | "WorkspaceNotFound"> | CatalogFailure;
/** Outcomes possible when creating one Workspace. */
export type CreateWorkspaceOutcome =
  | Outcome<"WorkspaceCreated" | "IdempotencyKeyReused">
  | CatalogFailure;
/** Outcomes possible when renaming one Workspace. */
export type RenameWorkspaceOutcome =
  | Outcome<"WorkspaceRenamed" | "WorkspaceNotFound">
  | CatalogFailure;

/** Workspace catalog operations used by the Gateway. */
export type Catalog = {
  readonly listWorkspaces: (
    input: ListWorkspacesInput,
  ) => Effect.Effect<ListWorkspacesOutcome>;
  readonly readWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<ReadWorkspaceOutcome>;
  readonly createWorkspace: (
    input: CreateWorkspaceInput,
  ) => Effect.Effect<CreateWorkspaceOutcome>;
  readonly renameWorkspace: (
    workspaceId: WorkspaceId,
    name: WorkspaceName,
  ) => Effect.Effect<RenameWorkspaceOutcome>;
};

function safeErrorType(input: unknown): string {
  return typeof input === "object" && input !== null && "_tag" in input &&
      typeof input._tag === "string"
    ? input._tag
    : typeof input;
}

function invalidOutcome(): Outcome<"CatalogProtocolInvalid"> {
  return CatalogOutcome.cases.CatalogProtocolInvalid.make({});
}

function narrowListOutcome(outcome: CatalogOutcomeType): ListWorkspacesOutcome {
  const keep = (value: ListWorkspacesOutcome): ListWorkspacesOutcome => value;
  const invalid = (): ListWorkspacesOutcome => invalidOutcome();
  return CatalogOutcome.match(outcome, {
    WorkspaceCollection: keep,
    CursorInvalid: keep,
    CatalogProtocolInvalid: keep,
    CatalogRecordCorrupt: keep,
    CatalogStateUnavailable: keep,
    WorkspaceFound: invalid,
    WorkspaceCreated: invalid,
    WorkspaceRenamed: invalid,
    WorkspaceNotFound: invalid,
    IdempotencyKeyReused: invalid,
  });
}

function narrowReadOutcome(outcome: CatalogOutcomeType): ReadWorkspaceOutcome {
  const keep = (value: ReadWorkspaceOutcome): ReadWorkspaceOutcome => value;
  const invalid = (): ReadWorkspaceOutcome => invalidOutcome();
  return CatalogOutcome.match(outcome, {
    WorkspaceFound: keep,
    WorkspaceNotFound: keep,
    CatalogProtocolInvalid: keep,
    CatalogRecordCorrupt: keep,
    CatalogStateUnavailable: keep,
    WorkspaceCollection: invalid,
    CursorInvalid: invalid,
    WorkspaceCreated: invalid,
    WorkspaceRenamed: invalid,
    IdempotencyKeyReused: invalid,
  });
}

function narrowCreateOutcome(outcome: CatalogOutcomeType): CreateWorkspaceOutcome {
  const keep = (value: CreateWorkspaceOutcome): CreateWorkspaceOutcome => value;
  const invalid = (): CreateWorkspaceOutcome => invalidOutcome();
  return CatalogOutcome.match(outcome, {
    WorkspaceCreated: keep,
    IdempotencyKeyReused: keep,
    CatalogProtocolInvalid: keep,
    CatalogRecordCorrupt: keep,
    CatalogStateUnavailable: keep,
    WorkspaceCollection: invalid,
    CursorInvalid: invalid,
    WorkspaceFound: invalid,
    WorkspaceRenamed: invalid,
    WorkspaceNotFound: invalid,
  });
}

function narrowRenameOutcome(outcome: CatalogOutcomeType): RenameWorkspaceOutcome {
  const keep = (value: RenameWorkspaceOutcome): RenameWorkspaceOutcome => value;
  const invalid = (): RenameWorkspaceOutcome => invalidOutcome();
  return CatalogOutcome.match(outcome, {
    WorkspaceRenamed: keep,
    WorkspaceNotFound: keep,
    CatalogProtocolInvalid: keep,
    CatalogRecordCorrupt: keep,
    CatalogStateUnavailable: keep,
    WorkspaceCollection: invalid,
    CursorInvalid: invalid,
    WorkspaceFound: invalid,
    WorkspaceCreated: invalid,
    IdempotencyKeyReused: invalid,
  });
}

/** Build the Catalog application service from an explicit RPC capability. */
export function makeCatalog(rpc: CatalogRpc): Catalog {
  return {
    listWorkspaces: Effect.fn("Catalog.listWorkspaces")(function* (input) {
      const outcome = yield* rpc.read(CatalogRead.cases.ListWorkspaces.make(
        Option.match(input.cursor, {
          onNone: () => ({ limit: input.limit }),
          onSome: (cursor) => ({ cursor, limit: input.limit }),
        }),
      ));
      return narrowListOutcome(outcome);
    }),
    readWorkspace: Effect.fn("Catalog.readWorkspace")(function* (workspaceId) {
      const outcome = yield* rpc.read(
        CatalogRead.cases.ReadWorkspace.make({ workspaceId }),
      );
      return narrowReadOutcome(outcome);
    }),
    createWorkspace: Effect.fn("Catalog.createWorkspace")(function* (input) {
      const outcome = yield* rpc.command(CatalogCommand.cases.CreateWorkspace.make({
        name: input.name,
        principalKey: input.principalKey,
        idempotencyKey: input.idempotencyKey,
      }));
      return narrowCreateOutcome(outcome);
    }),
    renameWorkspace: Effect.fn("Catalog.renameWorkspace")(function* (workspaceId, name) {
      const outcome = yield* rpc.command(CatalogCommand.cases.RenameWorkspace.make({
        workspaceId,
        name,
      }));
      return narrowRenameOutcome(outcome);
    }),
  };
}

/** A Workspace page cursor could not be decoded. */
export class CatalogCursorInvalid extends Schema.TaggedErrorClass<CatalogCursorInvalid>()(
  "CatalogCursorInvalid",
  {},
) {
  /** Stable safe diagnostic message. */
  override readonly message = "The Workspace page cursor is invalid";
}

/** Parsed Workspace page returned by persistence. */
export type WorkspacePage = {
  readonly workspaces: ReadonlyArray<WorkspaceType>;
  readonly cursor: Option.Option<WorkspaceCursor>;
  readonly nextCursor: Option.Option<WorkspaceCursor>;
  readonly limit: number;
};

/** Parsed RPC request for one bounded Workspace page. */
export type ListWorkspacesRequest = Extract<
  CatalogReadRequest,
  { readonly _tag: "ListWorkspaces" }
>;

/** Read persistence seam used by the singleton Catalog application. */
export type CatalogReader<R> = {
  readonly listWorkspaces: (
    request: ListWorkspacesRequest,
  ) => Effect.Effect<WorkspacePage, CatalogCursorInvalid | CatalogStateError, R>;
  readonly readWorkspace: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<Option.Option<WorkspaceType>, CatalogStateError, R>;
};

/** Build the read policy executed inside the singleton Catalog object. */
export function makeCatalogReadHandler<R>(
  state: CatalogReader<R>,
): (request: CatalogReadRequest) => Effect.Effect<CatalogOutcomeType, never, R> {
  return Effect.fn("Catalog.read")(function* (request) {
    if (request._tag === "ListWorkspaces") {
      const result = yield* Effect.result(state.listWorkspaces(request));
      if (Result.isSuccess(result)) {
        return CatalogOutcome.cases.WorkspaceCollection.make({
          workspaces: result.success.workspaces,
          cursor: Option.getOrNull(result.success.cursor),
          nextCursor: Option.getOrNull(result.success.nextCursor),
          limit: result.success.limit,
        });
      }
      switch (result.failure._tag) {
        case "CatalogCursorInvalid":
          return CatalogOutcome.cases.CursorInvalid.make({});
        case "CatalogRecordCorrupt":
          yield* Effect.logError(result.failure.message).pipe(
            Effect.annotateLogs({
              cause_type: safeErrorType(result.failure.cause),
              operation: "list_workspaces",
            }),
          );
          return CatalogOutcome.cases.CatalogRecordCorrupt.make({});
        case "CatalogStateUnavailable":
          yield* Effect.logError(result.failure.message).pipe(
            Effect.annotateLogs({
              cause_type: safeErrorType(result.failure.cause),
              operation: "list_workspaces",
            }),
          );
          return CatalogOutcome.cases.CatalogStateUnavailable.make({});
      }
    }
    const result = yield* Effect.result(state.readWorkspace(request.workspaceId));
    if (Result.isFailure(result)) {
      yield* Effect.logError(result.failure.message).pipe(
        Effect.annotateLogs({
          cause_type: safeErrorType(result.failure.cause),
          operation: "read_workspace",
        }),
      );
      return result.failure._tag === "CatalogRecordCorrupt"
        ? CatalogOutcome.cases.CatalogRecordCorrupt.make({})
        : CatalogOutcome.cases.CatalogStateUnavailable.make({});
    }
    return Option.isSome(result.success)
      ? CatalogOutcome.cases.WorkspaceFound.make({ workspace: result.success.value })
      : CatalogOutcome.cases.WorkspaceNotFound.make({});
  });
}

/** Build the command policy executed inside the singleton Catalog object. */
export function makeCatalogCommandHandler<R>(
  state: CatalogState<R>,
  clock: CatalogClock,
  workspaceIds: WorkspaceIds,
): (request: typeof CatalogCommand.Type) => Effect.Effect<CatalogOutcomeType, never, R> {
  return Effect.fn("Catalog.command")(function* (request) {
    const result = yield* Effect.result(state.transaction(Effect.gen(function* () {
      if (request._tag === "CreateWorkspace") {
        const fingerprint = IdempotencyFingerprint.make(
          `POST\n/api/workspaces\n${JSON.stringify({ name: request.name })}`,
        );
        const retained = yield* state.findIdempotency(
          request.principalKey,
          request.idempotencyKey,
        );
        if (Option.isSome(retained)) {
          return retained.value.fingerprint === fingerprint
            ? CatalogOutcome.cases.WorkspaceCreated.make({
                workspace: retained.value.workspace,
                replayed: true,
              })
            : CatalogOutcome.cases.IdempotencyKeyReused.make({});
        }

        const now = clock.now();
        const timestamp = WorkspaceTimestamp.make(now.toISOString());
        const workspace = Workspace.make({
          id: workspaceIds.next(now),
          name: request.name,
          lifecycle: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* state.insertCreation(
          workspace,
          request.principalKey,
          request.idempotencyKey,
          fingerprint,
        );
        return CatalogOutcome.cases.WorkspaceCreated.make({
          workspace,
          replayed: false,
        });
      }

      const current = yield* state.findWorkspace(request.workspaceId);
      if (Option.isNone(current)) {
        return CatalogOutcome.cases.WorkspaceNotFound.make({});
      }
      if (current.value.name === request.name) {
        return CatalogOutcome.cases.WorkspaceRenamed.make({ workspace: current.value });
      }
      const workspace = Workspace.make({
        ...current.value,
        name: request.name,
        updatedAt: WorkspaceTimestamp.make(clock.now().toISOString()),
      });
      yield* state.updateWorkspaceName(workspace);
      return CatalogOutcome.cases.WorkspaceRenamed.make({ workspace });
    })));

    if (Result.isSuccess(result)) return result.success;
    yield* Effect.logError(result.failure.message).pipe(
      Effect.annotateLogs({
        cause_type: safeErrorType(result.failure.cause),
        operation: request._tag === "CreateWorkspace"
          ? "create_workspace"
          : "rename_workspace",
      }),
    );
    return result.failure._tag === "CatalogRecordCorrupt"
      ? CatalogOutcome.cases.CatalogRecordCorrupt.make({})
      : CatalogOutcome.cases.CatalogStateUnavailable.make({});
  });
}
