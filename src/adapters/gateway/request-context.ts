import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
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
): Effect.fn.Return<void | HttpServerResponse.HttpServerResponse, never, ProblemResponse> {
  if (request.headers.origin !== allowedOrigin.origin) {
    const problems = yield* ProblemResponse;
    return problems.render({
      code: "origin_not_allowed",
      detail: "The request Origin is not allowed for this stage.",
      requestId,
    });
  }
});

const admitAgentMutationRequest = Effect.fn("Gateway.admitAgentMutationRequest")(function* (
  request: HttpServerRequest,
  requestId: RequestId,
): Effect.fn.Return<void | HttpServerResponse.HttpServerResponse, never, ProblemResponse> {
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
});

/** Admit an unsafe request after enforcing human Origin or Agent-session headers. */
export const admitMutationRequest = Effect.fn("Gateway.admitMutationRequest")(function* (
  request: HttpServerRequest,
  principal: AuthenticatedPrincipal,
  allowedOrigin: URL,
  requestId: RequestId,
): Effect.fn.Return<void | HttpServerResponse.HttpServerResponse, never, ProblemResponse> {
  return yield* AuthenticatedPrincipal.match(principal, {
    HumanPrincipal: () => admitHumanMutationRequest(request, allowedOrigin, requestId),
    AgentDeploymentPrincipal: () => admitAgentMutationRequest(request, requestId),
  });
});
