import * as Cloudflare from "alchemy/Cloudflare";
import { ProjectObject } from "./project-resource.ts";
import { WorkspaceRegistryObject } from "./workspace-registry-resource.ts";

/** Effect-native Gateway Worker hosting the Workspace Registry object. */
export class Gateway extends Cloudflare.Worker<
  Gateway,
  {},
  ProjectObject | WorkspaceRegistryObject
>()("Gateway") {}
