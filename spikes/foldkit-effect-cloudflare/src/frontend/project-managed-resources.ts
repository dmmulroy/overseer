import { Effect, Option, Schema } from "effect";
import { ManagedResource } from "foldkit";
import {
  ConnectedProjectSocket,
  DisconnectedProjectSocket,
  FailedProjectSocket,
  type ProjectMessage,
} from "./project-message";
import type { ProjectModel } from "./project-state";
import type {
  OpenProjectSocket,
  ProjectSocket,
} from "./project-socket";

const ActiveProjectSocket = ManagedResource.tag<ProjectSocket>()(
  "ActiveProjectSocket",
);

/** Build the model-driven Project socket lifecycle around an application-owned adapter. */
export function makeProjectManagedResources(openProjectSocket: OpenProjectSocket) {
  return ManagedResource.make<ProjectModel, ProjectMessage>()((entry) => ({
    projectSocket: entry(
      Schema.Option(Schema.Struct({ projectId: Schema.String })),
      {
        resource: ActiveProjectSocket,
        modelToMaybeRequirements: (model) =>
          Option.map(model.activeProjectId, (projectId) => ({ projectId })),
        acquire: openProjectSocket,
        release: (socket) => Effect.sync(socket.close),
        onAcquired: () => ConnectedProjectSocket(),
        onReleased: () => DisconnectedProjectSocket(),
        onAcquireError: (error) => FailedProjectSocket({
          message: error instanceof Error
            ? error.message
            : "The Project socket could not be opened.",
        }),
      },
    ),
  }));
}
