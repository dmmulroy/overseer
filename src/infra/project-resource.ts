import * as Cloudflare from "alchemy/Cloudflare";
import type { ProjectRpc } from "../application/project/project-rpc.ts";

/** Alchemy resource identifier for one Project Durable Object class. */
export class ProjectObject extends Cloudflare.DurableObject<ProjectObject, ProjectRpc>()(
  "ProjectObject",
) {}
