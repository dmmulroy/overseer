import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  AgentSession,
  AgentSessionId,
  AuthenticatedPrincipal,
  HarnessName,
  type RequestId,
} from "../../domain/actor.ts";
import { ProblemResponse } from "./problem-response.ts";

const admitHumanMutationRequest = Effect.fn("Gateway.admitHumanMutationRequest")(function* (
  request: HttpServerRequest,
  allowedOrigin: URL,
  requestId: RequestId,
): Effect.fn.Return<
  MutationAdmission | HttpServerResponse.HttpServerResponse,
  never,
  ProblemResponse
> {
  if (request.headers.origin !== allowedOrigin.origin) {
    const problems = yield* ProblemResponse;
    return problems.render({
      code: "origin_not_allowed",
      detail: "The request Origin is not allowed for this stage.",
      requestId,
    });
  }
  return MutationAdmission.HumanMutation();
});

const admitAgentMutationRequest = Effect.fn("Gateway.admitAgentMutationRequest")(function* (
  request: HttpServerRequest,
  requestId: RequestId,
): Effect.fn.Return<AgentSession | HttpServerResponse.HttpServerResponse, never, ProblemResponse> {
  const problems = yield* ProblemResponse;
  const sessionId = request.headers["overseer-session-id"];

  if (sessionId === undefined) {
    return problems.render({
      code: "agent_session_required",
      detail: "Agent mutations require Overseer-Session-Id.",
      requestId,
    });
  }

  const parsedSessionId = Schema.decodeUnknownOption(AgentSessionId)(sessionId);
  const harness = request.headers["overseer-harness"];
  const parsedHarness =
    harness === undefined
      ? Option.none<HarnessName>()
      : Schema.decodeUnknownOption(HarnessName)(harness);

  if (Option.isNone(parsedSessionId) || (harness !== undefined && Option.isNone(parsedHarness))) {
    return problems.render({
      code: "agent_session_invalid",
      detail: "Agent-session metadata must be bounded visible ASCII.",
      requestId,
    });
  }
  return AgentSession.make({
    sessionId: parsedSessionId.value,
    harness: parsedHarness,
  });
});

/** Successful admission of a human or Agent mutation request. */
export type MutationAdmission = Data.TaggedEnum<{
  HumanMutation: Record<never, never>;
  AgentMutation: { readonly agentSession: AgentSession };
}>;

/** Construct and exhaustively match successful mutation admission results. */
export const MutationAdmission = Data.taggedEnum<MutationAdmission>();

/** Admit an unsafe request and return its parsed Agent session attribution when present. */
export const admitMutationRequest = Effect.fn("Gateway.admitMutationRequest")(function* (
  request: HttpServerRequest,
  principal: AuthenticatedPrincipal,
  allowedOrigin: URL,
  requestId: RequestId,
): Effect.fn.Return<
  MutationAdmission | HttpServerResponse.HttpServerResponse,
  never,
  ProblemResponse
> {
  if (principal._tag === "HumanPrincipal") {
    return yield* admitHumanMutationRequest(request, allowedOrigin, requestId);
  }
  const admitted = yield* admitAgentMutationRequest(request, requestId);
  return HttpServerResponse.isHttpServerResponse(admitted)
    ? admitted
    : MutationAdmission.AgentMutation({ agentSession: admitted });
});
