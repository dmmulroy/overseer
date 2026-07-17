import { Match } from "effect";
import type { Command } from "foldkit";
import { FetchEcho } from "./project-http";
import type { ProjectMessage } from "./project-message";
import {
  SocketConnected,
  SocketDisconnected,
  SocketFailed,
  type ProjectModel,
} from "./project-state";

/** Pure Foldkit update function; transport outcomes arrive only as Messages. */
export function updateProject(
  model: ProjectModel,
  message: ProjectMessage,
): readonly [ProjectModel, ReadonlyArray<Command.Command<ProjectMessage>>] {
  return Match.value(message).pipe(
    Match.withReturnType<
      readonly [ProjectModel, ReadonlyArray<Command.Command<ProjectMessage>>]
    >(),
    Match.tagsExhaustive({
      RequestedEcho: ({ value }) => [model, [FetchEcho({ value })]],
      SucceededEcho: ({ value }) => [{ ...model, echoedValue: value }, []],
      FailedEcho: () => [model, []],
      ConnectedProjectSocket: () => [
        { ...model, socketState: SocketConnected() },
        [],
      ],
      DisconnectedProjectSocket: () => [
        { ...model, socketState: SocketDisconnected() },
        [],
      ],
      FailedProjectSocket: ({ message: failureMessage }) => [
        { ...model, socketState: SocketFailed({ message: failureMessage }) },
        [],
      ],
    }),
  );
}
