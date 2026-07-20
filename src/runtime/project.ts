import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

type ProjectObjectShape = Readonly<Record<never, never>>;

/** Per-Project Durable Object identifier reserved for Project persistence. */
export class ProjectObject extends Cloudflare.DurableObject<
  ProjectObject,
  ProjectObjectShape
>()(
  "ProjectObject",
) {}

/** Alchemy V2 implementation layer for the binding-only Project object. */
const ProjectObjectLive = ProjectObject.make(
  Effect.succeed(Effect.succeed({})),
);

export default ProjectObjectLive;
