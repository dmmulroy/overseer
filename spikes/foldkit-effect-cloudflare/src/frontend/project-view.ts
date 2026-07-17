import { Button } from "@foldkit/ui";
import { html, type Html } from "foldkit/html";
import { RequestedEcho, type ProjectMessage } from "./project-message";
import type { ProjectModel } from "./project-state";

/** Minimal headless UI proof that exercises `@foldkit/ui` without production styling. */
export function projectView(model: ProjectModel): Html {
  const h = html<ProjectMessage>();
  return h.main([], [
    h.p([], [`socket=${model.socketState._tag}`]),
    h.p([], [`echo=${model.echoedValue}`]),
    Button.view<ProjectMessage>({
      onClick: RequestedEcho({ value: "foldkit" }),
      toView: (attributes) => h.button(
        attributes.button,
        ["Run typed HTTP probe"],
      ),
    }),
  ]);
}
