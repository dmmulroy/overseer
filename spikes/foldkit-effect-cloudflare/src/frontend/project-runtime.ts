import { Option } from "effect";
import { Runtime } from "foldkit";
import { makeProjectManagedResources } from "./project-managed-resources";
import {
  ProjectModel,
  SocketConnecting,
} from "./project-state";
import type { OpenProjectSocket } from "./project-socket";
import { updateProject } from "./project-update";
import { projectView } from "./project-view";

/** Compose the throwaway Foldkit runtime around an injected Project socket adapter. */
export function makeProjectRuntime(
  container: HTMLElement,
  openProjectSocket: OpenProjectSocket,
) {
  return Runtime.makeElement({
    Model: ProjectModel,
    init: () => [{
      activeProjectId: Option.some("project-spike"),
      socketState: SocketConnecting(),
      echoedValue: "",
    }, []],
    update: updateProject,
    view: projectView,
    container,
    managedResources: makeProjectManagedResources(openProjectSocket),
    devTools: false,
    slow: false,
  });
}
