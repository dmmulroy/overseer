import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { CommandAttribution } from "../../domain/actor.ts";
import { type IssueId, makeTimelineEventId } from "../../domain/entity-id.ts";
import type { IdempotencyKey } from "../../domain/idempotency.ts";
import {
  advanceIssueTimestamp,
  Issue,
  IssueStateChangedTimelineEvent,
  IssueTimestamp,
  type TimelinePosition,
} from "../../domain/issue.ts";
import {
  IssueNotFound,
  type ProjectIdempotencyKeyReused,
  type ProjectPersistenceError,
} from "./issue-discovery.ts";
import { UlidGeneratorService } from "../ulid-generator.ts";

/** Input shared by named close and reopen target-state actions. */
export type SteerIssueStateInput = {
  readonly issueId: IssueId;
  readonly idempotencyKey: IdempotencyKey;
  readonly attribution: CommandAttribution;
};

/** Current Issue returned by a target-state action and its replay status. */
export type SteerIssueStateResult = {
  readonly issue: Issue;
  readonly replayed: boolean;
};

/** Values persisted atomically for one real Issue state transition. */
export type InsertIssueStateChangeInput = {
  readonly issue: Issue;
  readonly event: IssueStateChangedTimelineEvent;
  readonly position: TimelinePosition;
  readonly idempotencyKey: IdempotencyKey;
};

/** Transactional Project state required by Issue close and reopen actions. */
export type IssueSteeringState = {
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProjectPersistenceError, R>;
  readonly findRecordedIssueSteering: (
    key: IdempotencyKey,
  ) => Effect.Effect<Option.Option<Issue>, ProjectIdempotencyKeyReused | ProjectPersistenceError>;
  readonly findIssue: (
    issueId: IssueId,
  ) => Effect.Effect<Option.Option<Issue>, ProjectPersistenceError>;
  readonly allocateTimelinePosition: (
    issueId: IssueId,
  ) => Effect.Effect<TimelinePosition, ProjectPersistenceError>;
  readonly insertIssueStateChange: (
    input: InsertIssueStateChangeInput,
  ) => Effect.Effect<void, ProjectPersistenceError>;
  readonly insertIssueStateNoChange: (
    issue: Issue,
    idempotencyKey: IdempotencyKey,
  ) => Effect.Effect<void, ProjectPersistenceError>;
};

/** Effect service for transactional Issue steering state. */
export class IssueSteeringStateService extends Context.Service<
  IssueSteeringStateService,
  IssueSteeringState
>()("@overseer/application/IssueSteeringState") {}

/** Project-local named close and reopen actions. */
export type IssueSteering = {
  readonly closeIssue: (
    input: SteerIssueStateInput,
  ) => Effect.Effect<
    SteerIssueStateResult,
    IssueNotFound | ProjectIdempotencyKeyReused | ProjectPersistenceError
  >;
  readonly reopenIssue: (
    input: SteerIssueStateInput,
  ) => Effect.Effect<
    SteerIssueStateResult,
    IssueNotFound | ProjectIdempotencyKeyReused | ProjectPersistenceError
  >;
};

/** Effect service for Project-local Issue close and reopen actions. */
export class IssueSteeringService extends Context.Service<IssueSteeringService, IssueSteering>()(
  "@overseer/application/IssueSteering",
) {}

/** Construct Issue steering policy from transactional state and Entity ID allocation. */
export const make = Effect.gen(function* () {
  const state = yield* IssueSteeringStateService;
  const ulids = yield* UlidGeneratorService;

  const setIssueState = Effect.fn("IssueSteering.setIssueState")(function* (
    input: SteerIssueStateInput,
    targetState: "open" | "closed",
  ) {
    return yield* state.transaction(
      Effect.gen(function* () {
        const replay = yield* state.findRecordedIssueSteering(input.idempotencyKey);
        if (Option.isSome(replay)) return { issue: replay.value, replayed: true };

        const current = yield* state.findIssue(input.issueId);
        if (Option.isNone(current)) return yield* new IssueNotFound({ issueId: input.issueId });
        if (current.value.state === targetState) {
          yield* state.insertIssueStateNoChange(current.value, input.idempotencyKey);
          return { issue: current.value, replayed: false };
        }

        const candidate = IssueTimestamp.make(DateTime.formatIso(yield* DateTime.now));
        const issue = Issue.make({
          ...current.value,
          state: targetState,
          updatedAt: advanceIssueTimestamp(current.value.updatedAt, candidate),
        });
        const event = IssueStateChangedTimelineEvent.make({
          id: makeTimelineEventId(yield* ulids.next()),
          kind: targetState === "closed" ? "issue_closed" : "issue_reopened",
          sourceIssueId: issue.id,
          actor: input.attribution.actor,
          agentSession: input.attribution.agentSession,
          createdAt: issue.updatedAt,
        });
        yield* state.insertIssueStateChange({
          issue,
          event,
          position: yield* state.allocateTimelinePosition(issue.id),
          idempotencyKey: input.idempotencyKey,
        });
        return { issue, replayed: false };
      }),
    );
  });

  return IssueSteeringService.of({
    closeIssue: Effect.fn("IssueSteering.closeIssue")((input) => setIssueState(input, "closed")),
    reopenIssue: Effect.fn("IssueSteering.reopenIssue")((input) => setIssueState(input, "open")),
  });
});

/** Production Project-local Issue steering policy layer. */
export const layer = Layer.effect(IssueSteeringService, make);
