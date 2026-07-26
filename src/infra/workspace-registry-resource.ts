import * as Cloudflare from "alchemy/Cloudflare";
import type { WorkspaceRegistryRpc } from "../application/workspace-registry/workspace-registry-rpc.ts";

/** Alchemy resource identifier for the singleton Workspace Registry Durable Object. */
export class WorkspaceRegistryObject extends Cloudflare.DurableObject<
  WorkspaceRegistryObject,
  WorkspaceRegistryRpc
>()("WorkspaceRegistryObject") {}
